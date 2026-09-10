const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the real route handlers with an isolated database, never production.
function setup(today = '2026-10-10T12:00:00Z') {
  const rows = [];
  const routes = {};
  const card = { id: 1, closing_day: 28, due_day: 5 };
  const selectUnpaid = (sql, params) => rows.filter(row =>
    row.credit_card_id === Number(params[0]) && !row.is_paid &&
    (!sql.includes('date < ?') || row.date < params[1]));
  const db = {
    async get(sql, params) {
      if (sql.includes('FROM categories')) return { id: 1 };
      if (sql.includes('FROM credit_cards')) return card;
      if (sql.includes('FROM banks')) return { id: 1 };
      if (sql.includes('SUM(amount)')) return { total: selectUnpaid(sql, params).reduce((sum, row) => sum + row.amount, 0) };
      return rows.find(row => row.id === Number(params[0]));
    },
    async all(sql, params) {
      if (sql.includes('WHERE installment_id =')) return rows.filter(row => row.installment_id === params[0]);
      return selectUnpaid(sql, params);
    },
    async run(sql, params) {
      if (sql.includes('INSERT INTO transactions')) {
        const columns = sql.match(/transactions\s*\(([^)]+)\)/)[1].split(',').map(s => s.trim());
        const row = { id: rows.length + 1 };
        const values = sql.match(/VALUES\s*\(([^)]+)\)/)[1].split(',').map(s => s.trim());
        let index = 0;
        columns.forEach((column, i) => { row[column] = values[i] === '?' ? params[index++] : (values[i] === '1' ? 1 : values[i].replace(/'/g, '')); });
        rows.push(row);
        return { lastInsertRowid: row.id };
      }
      if (sql.includes('SET is_paid = 1')) {
        selectUnpaid(sql, params).forEach(row => { row.is_paid = 1; });
        return;
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
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [today])); }
    },
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
    async call(route, body = {}, id = 1, query = {}) {
      const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.value = value; return this; } };
      await routes[route]({ body, params: { id }, query }, res);
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

test('invoice month is the next calendar month without rewriting purchase dates', async () => {
  const app = setup();
  for (const date of ['2026-09-10', '2026-09-28', '2026-09-29', '2026-12-29']) {
    await app.call('post /api/transactions', { ...purchase, date });
  }
  const result = await app.call('get /api/credit-cards/:id/future-invoices');
  const invoices = JSON.parse(JSON.stringify(result.future_invoices));
  assert.deepEqual(invoices.map(invoice => invoice.monthKey), ['2026-10', '2027-01']);
  assert.deepEqual(invoices.map(invoice => invoice.total), [360, 120]);
  assert.equal(invoices[0].transactions[0].date, purchase.date);
  assert.equal(invoices[0].cutoffDate, '2026-10-28');
  assert.equal(invoices[0].dueDate, '2026-11-05');
});


test('September purchase is excluded from September and billed in October', async () => {
  const app = setup();
  await app.call('post /api/transactions', purchase);
  const september = await app.call('get /api/credit-cards/:id/invoice', {}, 1, { month: '2026-09' });
  assert.equal(september.total, 0);
  const october = await app.call('get /api/credit-cards/:id/invoice', {}, 1, { month: '2026-10' });
  assert.equal(october.total, 120);
  assert.equal(october.transactions[0].date, '2026-09-10');
});

test('payment settles only the displayed invoice, leaving next-month purchases unpaid', async () => {
  const app = setup();
  await app.call('post /api/transactions', purchase);
  await app.call('post /api/transactions', { ...purchase, date: '2026-10-01' });
  const invoice = await app.call('get /api/credit-cards/:id/invoice');
  assert.equal(invoice.total, 120);
  const payment = await app.call('post /api/credit-cards/:id/pay', { bank_id: 1, date: '2026-10-10' });
  assert.equal(payment.total_paid, invoice.total);
  assert.equal(app.rows[0].is_paid, 1);
  assert.equal(app.rows[1].is_paid, 0);
  assert.equal(app.rows[0].date, '2026-09-10');
  assert.equal(app.rows[2].amount, 120);
  assert.equal((await app.call('get /api/credit-cards/:id/invoice')).total, 0);
});

test('installments and overdue balances follow the same invoice and payment rules', async () => {
  const app = setup();
  await app.call('post /api/transactions', { ...purchase, installments: 3 });
  await app.call('post /api/transactions', { ...purchase, date: '2026-08-10', installments: 3 });
  const future = await app.call('get /api/credit-cards/:id/future-invoices');
  assert.deepEqual(Array.from(future.future_invoices, invoice => invoice.monthKey), ['2026-09', '2026-10', '2026-11', '2026-12']);
  const invoice = await app.call('get /api/credit-cards/:id/invoice');
  assert.equal(invoice.total, 120);
  const payment = await app.call('post /api/credit-cards/:id/pay', { bank_id: 1 });
  assert.equal(payment.total_paid, invoice.total);
  assert.equal(app.rows.filter(row => row.credit_card_id && row.is_paid).length, 3);
  assert.equal(app.rows.filter(row => row.credit_card_id && !row.is_paid).length, 3);
});
