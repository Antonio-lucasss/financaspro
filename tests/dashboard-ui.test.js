const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup() {
  const nodes = new Map();
  const document = {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', querySelectorAll() { return []; } });
      return nodes.get(id);
    },
    createElement() {
      return { textContent: '', get innerHTML() { return this.textContent.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'); } };
    },
  };
  let chartOptions;
  const context = { document, Intl, Chart: class { constructor(_ctx, config) { chartOptions = config.options; } destroy() {} } };
  vm.createContext(context);
  for (const name of ['ui','charts']) vm.runInContext(fs.readFileSync(path.join(__dirname,`../public/js/${name}.js`),'utf8'),context);
  return { document, context, options: () => chartOptions };
}

test('category buttons and chart segments/legend use the API category id', () => {
  const { context, document, options } = setup();
  const category = { id: 42, type: 'expense', name: 'Mercado', icon: '', color: '#123456', total: 120 };
  const clicks = [];
  context.categories = [category];
  context.onClick = (...args) => clicks.push(args);
  vm.runInContext('UI.renderTopCategories(categories,onClick); ChartsManager.renderCategoryChart(categories,onClick)',context);
  const html = document.getElementById('top-categories-list').innerHTML;
  assert.match(html, /<button type="button"/);
  assert.match(html, /data-category-id="42"/);
  assert.doesNotMatch(html, /undefined/);
  options().onClick({},[{ index: 0 }]);
  options().plugins.legend.onClick({}, { index: 0 });
  assert.deepEqual(clicks, [[42,'Mercado'],[42,'Mercado']]);
});

test('dashboard details show payment, account, installment and pagination with escaped descriptions', () => {
  const { context, document } = setup();
  context.result = { data: [{ date: '2026-09-10', description: '<script>x</script>', category_name: 'Mercado', credit_card_id: 7, installment_number: 2, installments_total: 3, amount: 40, is_paid: 0 }], total: 27, limit: 25, offset: 25 };
  vm.runInContext("UI.renderDashboardTransactions(result,[],[{ id: 7, name: 'Meu cartão' }],()=>{})",context);
  const html = document.getElementById('dashboard-transactions-body').innerHTML;
  for (const text of ['10/09/2026','Meu cartão','2/3','Pendente','&lt;script&gt;']) assert.ok(html.includes(text));
  assert.ok(!html.includes('<script>'));
  assert.match(document.getElementById('dashboard-transactions-pagination').innerHTML, /Página 2 de 2/);
});
