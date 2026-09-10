const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the real route handlers with an isolated database, never production.
function setup() {
  const rows = [];
  const routes = {};
  const card = { id: 1, closing_day: 28, due_day: 5 };
  const db = {
    async get(sql, params) {
      if (sql.includes('FROM categories')) return { id: 1 };
      if (sql.includes('FROM credit_cards')) return card;
      return rows.find(row => row.id === Number(params[0]));
    },
    async all(sql, params) {
      if (sql.includes('WHERE installment_id =')) return rows.filter(row => row.installment_id === params[0]);
      return rows.filter(row => row.credit_card_id === Number(params[0]) && !row.is_paid);
    },
    async run(sql, params) {
      if (sql.includes('INSERT INTO transactions')) {
        const columns = sql.match(/transactions\s*\(([^)]+)\)/)[1].split(',').map(s => s.trim());
        const row = { id: rows.length + 1 };
        columns.forEach((column, i) => { row[column] = params[i]; });
        rows.push(row);
        return { lastInsertRowid: row.id };
      }
      if (sql.includes('UPDATE transactions')) {
        const columns = sql.match(/SET ([\s\S]+?)WHERE/)[1].split(',').filter(s => s.includes('?')).map(s => s.split('=')[0].trim());
        const row = rows.find(row => row.id === Number(params.at(-1)));
        columns.forEach((column, i) => { row[column] = params[i]; });
      }
    },
    async transaction(fn) { return fn(db); },
  };
  const app = { use() {} };
  for (const method of ['get', 'post', 'put', 'delete']) app[method] = (url, handler) => { routes[`${method} ${url}`] = handler; };
  const express = Object.assign(() => app, { json: () => () => {}, static: () => () => {} });
  const context = {
    require(name) {
      if (name === 'express') return express;
      if (name === 'cors') return () => () => {};
      if (name === 'dotenv') return { config() {} };
      if (name === './db') return db;
      return require(name);
    },
    module: { exports: {} }, process: { env: {} }, __dirname: path.join(__dirname, '..'), console,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8'), context);
  return {
    rows,
    async call(route, body = {}, id = 1) {
      const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.value = value; return this; } };
      await routes[route]({ body, params: { id }, query: {} }, res);
      assert.ok(res.code < 400, JSON.stringify(res.value));
      return res.value;
    },
  };
}

const purchase = { type: 'expense', amount: 120, description: 'Mercado', category_id: 1, date: '2026-09-10', credit_card_id: 1 };

test('card purchase retains its date when created and edited repeatedly', async () => {
  const app = setup();
  const row = await app.call('post /api/transactions', purchase);
  assert.equal(row.date, '2026-09-10');
  assert.equal(row.is_paid, 0);
  for (let i = 0; i < 2; i++) {
    await app.call('put /api/transactions/:id', { date: '2026-09-10', description: 'Mercado atualizado' });
    assert.equal(row.date, '2026-09-10');
  }
  await app.call('put /api/transactions/:id', { date: '2026-09-11' });
  await app.call('put /api/transactions/:id', { amount: 130 });
  assert.equal(row.date, '2026-09-11');
});

test('bank purchase retains its date and paid status', async () => {
  const app = setup();
  const row = await app.call('post /api/transactions', { ...purchase, credit_card_id: null, bank_id: 1 });
  assert.equal(row.date, purchase.date);
  assert.equal(row.is_paid, 1);
});

test('installments start on purchase date and clamp short months', async () => {
  const app = setup();
  await app.call('post /api/transactions', { ...purchase, date: '2028-01-31', installments: 3 });
  assert.deepEqual(app.rows.map(row => row.date), ['2028-01-31', '2028-02-29', '2028-03-31']);
  assert.equal(app.rows.reduce((sum, row) => sum + row.amount, 0), 120);
  await app.call('put /api/transactions/:id', { date: '2026-09-10' });
  assert.deepEqual(app.rows.map(row => row.date), ['2026-09-10', '2026-10-10', '2026-11-10']);
});

test('invoice grouping respects closing day without rewriting purchase dates', async () => {
  const app = setup();
  for (const date of ['2026-09-10', '2026-09-28', '2026-09-29', '2026-12-29']) {
    await app.call('post /api/transactions', { ...purchase, date });
  }
  const result = await app.call('get /api/credit-cards/:id/future-invoices');
  const invoices = JSON.parse(JSON.stringify(result.future_invoices));
  assert.deepEqual(invoices.map(invoice => invoice.monthKey), ['2026-09', '2026-10', '2027-01']);
  assert.deepEqual(invoices.map(invoice => invoice.total), [240, 120, 120]);
  assert.equal(invoices[0].transactions[0].date, purchase.date);
  assert.equal(invoices[0].cutoffDate, '2026-09-28');
  assert.equal(invoices[0].dueDate, '2026-10-05');
});
