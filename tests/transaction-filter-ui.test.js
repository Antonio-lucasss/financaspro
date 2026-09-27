const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('transaction filter controls apply combined filters, reset pagination and clear every selection', () => {
  const nodes = new Map();
  const document = { getElementById(id) {
    if (!nodes.has(id)) nodes.set(id,{ value:'', events:{}, addEventListener(name,fn){ this.events[name]=fn; } });
    return nodes.get(id);
  } };
  let calls=0;
  const context={document,transactionFilters:{limit:20,offset:40},loadTransactions(){calls++;}};
  const source=fs.readFileSync(path.join(__dirname,'../public/js/app.js'),'utf8');
  const start=source.indexOf('    // Payment filters apply');
  const end=source.indexOf('    // Allow search on Enter',start);
  assert.ok(start>=0 && end>start);
  vm.runInNewContext(source.slice(start,end),context);
  const values={'filter-bank':'2','filter-category':'4','filter-payment-method':'credit','filter-type':'','filter-start':'2026-09-01','filter-end':'2026-09-30','filter-search':'Mercado'};
  for (const [id,value] of Object.entries(values)) document.getElementById(id).value=value;
  const payment=document.getElementById('filter-payment-method');
  payment.events.change({target:payment});
  assert.equal(document.getElementById('filter-type').value,'expense');
  document.getElementById('btn-filter-apply').events.click();
  assert.deepEqual(JSON.parse(JSON.stringify(context.transactionFilters)),{type:'expense',category_id:'4',bank_id:'2',payment_method:'credit',start_date:'2026-09-01',end_date:'2026-09-30',search:'Mercado',limit:20,offset:0});
  document.getElementById('filter-type').events.change({target:{value:'income'}});
  assert.equal(payment.value,'');
  document.getElementById('btn-filter-clear').events.click();
  for (const id of Object.keys(values)) assert.equal(document.getElementById(id).value,'');
  assert.deepEqual(JSON.parse(JSON.stringify(context.transactionFilters)),{limit:20,offset:0});
  assert.equal(calls,2);
});
