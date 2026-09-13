const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

// Run the real route SQL against an isolated SQLite fixture (Python standard library).
// No production database, credentials or installed application dependencies are used.
test('transfers move bank balances without inflating reports, including existing transfers', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'financas-transfers-'));
  try {
    const database = path.join(dir, 'test.sqlite');
    const python = `import sqlite3,json,sys
r=json.load(sys.stdin)
c=sqlite3.connect(sys.argv[1]);c.row_factory=sqlite3.Row
if r.get('script'):
 c.executescript(r['sql']);out={}
else:
 q=c.execute(r['sql'],r.get('params',[]));out={'rows':[dict(x) for x in q.fetchall()],'lastInsertRowid':q.lastrowid}
c.commit();print(json.dumps(out))`;
    function query(sql, params = [], script = false) {
      return JSON.parse(execFileSync('python', ['-c', python, database], { input: JSON.stringify({ sql, params, script }), encoding: 'utf8' }));
    }
    query(`
      CREATE TABLE banks(id INTEGER PRIMARY KEY, name TEXT, initial_balance REAL);
      CREATE TABLE categories(id INTEGER PRIMARY KEY, name TEXT, type TEXT, icon TEXT, color TEXT, is_default INTEGER);
      CREATE TABLE transactions(id INTEGER PRIMARY KEY, type TEXT, amount REAL, description TEXT, category_id INTEGER, date TEXT, bank_id INTEGER, credit_card_id INTEGER, is_paid INTEGER, installment_id TEXT, created_at TEXT);
      CREATE TABLE recurring_transactions(id INTEGER PRIMARY KEY, type TEXT, amount REAL, category_id INTEGER, is_active INTEGER, next_due_date TEXT);
      INSERT INTO banks VALUES(1,'Origem',1000),(2,'Destino',100);
      INSERT INTO categories VALUES(1,'Salário','income','', '',0),(2,'Mercado','expense','','',0),(3,'Transferência','both','','',1);
      INSERT INTO transactions(type,amount,description,category_id,date,bank_id,is_paid) VALUES
      ('income',1000,'Salário',1,'2026-09-01',1,1),
      ('expense',100,'Mercado',2,'2026-09-02',1,1),
      ('expense',50,'Movimentação antiga personalizada',3,'2026-09-03',1,1),
      ('income',50,'Movimentação antiga personalizada',3,'2026-09-03',2,1);
    `, [], true);
    const db = {
      async get(sql, params) { return query(sql, params).rows[0] || null; },
      async all(sql, params) { return query(sql, params).rows; },
      async run(sql, params) { return query(sql, params); },
      async transaction(fn) { return fn(db); },
    };
    const routes = {};
    const app = { use() {} };
    for (const method of ['get','post','put','delete']) app[method] = (url, fn) => { routes[method + ' ' + url] = fn; };
    const express = Object.assign(() => app, { json: () => () => {}, static: () => () => {} });
    const context = { module: { exports: {} }, process: { env: {} }, console, __dirname: path.join(__dirname,'..'), require(name) {
      if (name === './db') return db;
      if (name === 'express') return express;
      if (name === 'cors') return () => () => {};
      if (name === 'dotenv') return { config() {} };
      return require(name);
    } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../server.js'),'utf8'),context);
    async function call(route, body = {}, query = {}) {
      const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.value = value; } };
      await routes[route]({ body, query, params: {} },res);
      assert.ok(res.code < 400, JSON.stringify(res.value));
      return res.value;
    }
    async function reports() {
      return {
        summary: await call('get /api/stats/summary', {}, { month: '2026-09' }),
        categories: await call('get /api/stats/by-category', {}, { month: '2026-09' }),
        monthly: await call('get /api/stats/monthly', {}, { year: '2026' }),
        analytics: await call('get /api/stats/analytics', {}, { month: '2026-09' }),
      };
    }
    const before = await reports();
    assert.equal(before.summary.total_expense,100);
    assert.equal(before.summary.total_income,1000);
    const banksBefore = await call('get /api/banks');
    await call('post /api/transfers', { from_bank_id: 1, to_bank_id: 2, amount: 200, date: '2026-09-13', description: 'Reserva' });
    const after = await reports();
    assert.deepEqual(after.summary, before.summary);
    assert.deepEqual(after.categories,before.categories);
    assert.deepEqual(after.monthly,before.monthly);
    for (const key of ['trends','financial_health','projection','expense_composition','alerts']) assert.deepEqual(after.analytics[key],before.analytics[key]);
    const banksAfter = await call('get /api/banks');
    assert.equal(banksAfter[0].balance,banksBefore[0].balance - 200);
    assert.equal(banksAfter[1].balance,banksBefore[1].balance + 200);
    const filtered = await call('get /api/stats/summary', {}, { month: '2026-09', category_id: 3 });
    assert.equal(filtered.total_expense,0);
    assert.equal(filtered.total_income,0);
    assert.equal(query('SELECT COUNT(*) AS n FROM transactions WHERE category_id=3').rows[0].n,4);
  } finally { fs.rmSync(dir,{ recursive: true, force: true }); }
});
