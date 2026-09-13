const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { getPoolConfig } = require('../db-pool-config');

test('Supabase session URLs use transaction pooling without changing credentials or query options', () => {
  const source = 'postgresql://app.project:p%40ss%23word@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=require';
  const config = getPoolConfig(source);
  const before = new URL(source);
  const after = new URL(config.connectionString);
  assert.equal(after.port, '6543');
  for (const key of ['hostname','username','password','pathname','search']) assert.equal(after[key],before[key]);
  assert.equal(config.max,1);
  assert.equal(config.idleTimeoutMillis,1000);
});

test('direct, local and already pooled database URLs are preserved', () => {
  for (const source of [
    'postgresql://user:password@localhost:5432/test',
    'postgresql://user:password@db.project.supabase.co:5432/postgres',
    'postgresql://user:password@aws-0-region.pooler.supabase.com:6543/postgres',
    'postgresql://user:password@pooler.supabase.com.example.org:5432/postgres',
  ]) assert.equal(getPoolConfig(source).connectionString,source);
});

test('API requests are queued at three concurrent calls and failures release their slots', async () => {
  let active = 0;
  let maximum = 0;
  const calls = [];
  const context = {
    URLSearchParams,
    localStorage: { getItem: () => 'test-token', removeItem() {} },
    window: { dispatchEvent() {} }, CustomEvent: class {},
    async fetch(url, options) {
      active++;
      maximum = Math.max(maximum,active);
      calls.push({ url, options });
      await new Promise(resolve => setTimeout(resolve,5));
      active--;
      if (url.endsWith('/network-error')) throw new Error('network error');
      return { ok: !url.endsWith('/server-error'), status: 500, async json() {
        if (url.endsWith('/invalid-json')) throw new Error('invalid json');
        return { error: 'test error', url };
      } };
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/js/api.js'),'utf8') + '\nglobalThis.client = new FinanceAPI();',context);
  const requests = ['/network-error','/server-error','/invalid-json', ...Array.from({length:9},(_,i)=>'/read/'+i)];
  const results = await Promise.allSettled(requests.map(url => context.client._request('GET',url)));
  assert.equal(maximum,3);
  assert.equal(results.filter(r => r.status === 'rejected').length,3);
  assert.equal(results.filter(r => r.status === 'fulfilled').length,9);
  assert.equal(context.client._activeRequests,0);
  assert.equal(context.client._requestQueue.length,0);
  await context.client._request('POST','/write',{ amount:100 });
  assert.equal(calls.filter(c => c.url === '/write').length,1);
  assert.equal(calls.at(-1).options.body,JSON.stringify({amount:100}));
  assert.equal(calls.at(-1).options.headers.Authorization,'Bearer test-token');
});
