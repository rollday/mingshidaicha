import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { createBackend } from '../src/server.ts';
import { config } from '../src/config.ts';
import { CaseClient, applyEvent, initialState } from '../frontend/src/lib/case-client.ts';
import { decimal, money, percent, triState, shiftDecimal } from '../frontend/src/lib/format.ts';

test('frontend formats decimal strings without float conversion and preserves unknowns', () => {
  assert.equal(money('9007199254740993.995'), '9,007,199,254,740,994.00 元');
  assert.equal(percent('0.123456'), '12.35%');
  assert.equal(decimal('-0.005'), '-0.01');
  assert.equal(money(null), '—'); assert.equal(percent(null), '—');
  assert.equal(triState(null), '待确认'); assert.equal(triState(false), '否');
  assert.equal(shiftDecimal('12.34567890123456789', -2), '0.1234567890123456789');
  assert.equal(shiftDecimal('0.00000000000000000001', 2), '0.000000000000000001');
});

test('frontend stores parsed layouts independently per document and handles partial reports explicitly', () => {
  const layout = { document_id: 'one', page_count: 1, needs_vision: false, pages: [{ page: 1, width: 10, height: 10, text: 'a', blocks: [{ bbox: [1,2,3,4] as [number,number,number,number], text: 'a' }] }] };
  let state = applyEvent(initialState(), { version:1,type:'document.parsed',request_id:'a',timestamp:'',data:layout });
  state = applyEvent(state, { version:1,type:'document.parsed',request_id:'a',timestamp:'',data:{...layout,document_id:'two'} });
  assert.equal(Object.keys(state.parsed).length, 2);
  assert.deepEqual(state.parsed.one?.pages[0]?.blocks[0]?.bbox, [1,2,3,4]);
  state = applyEvent(state, { version:1,type:'case.calculation_unavailable',request_id:'a',timestamp:'',data:{case_id:'a',code:'MISSING_FACTS',message:'missing',missing_fields:['loan.principal']} });
  assert.match(state.warning!, /无法核算/);
});

test('browser client completes a real WS manual review, correction and Python report then resets the session', async t => {
  const backend = await createBackend({ ...config, apiKey: undefined });
  backend.server.listen(0, '127.0.0.1'); await once(backend.server, 'listening');
  const address = backend.server.address(); assert(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const originalFetch = globalThis.fetch, originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { configurable:true, value:{ protocol:'http:',host:`127.0.0.1:${address.port}` } });
  globalThis.fetch = (input, init) => originalFetch(typeof input === 'string' && input.startsWith('/') ? base + input : input, init);
  const client = new CaseClient();
  t.after(async () => { client.dispose(); globalThis.fetch = originalFetch; if (originalLocation) Object.defineProperty(globalThis,'location',originalLocation); else Reflect.deleteProperty(globalThis,'location'); await backend.close(); });
  const wait = (predicate: () => boolean) => new Promise<void>((resolve,reject) => {
    const timer = setTimeout(() => { unsubscribe(); reject(new Error('Client state timed out: '+JSON.stringify(client.state.error))); },10000);
    let unsubscribe = () => {};
    unsubscribe = client.subscribe(() => { if (predicate()) { clearTimeout(timer); queueMicrotask(() => unsubscribe()); resolve(); } });
  });
  await client.open(); assert.equal(client.state.connection,'ready');
  client.demo('50', false);
  await wait(() => client.state.screen === 'confirm' && !client.state.busy);
  assert.equal(client.state.current?.revision,0);
  const facts = structuredClone(client.state.current!.facts); facts.fees[0]!.amount = '55';
  client.confirm(facts);
  await wait(() => client.state.screen === 'report' && !client.state.busy);
  assert.equal(client.state.current?.report?.calculation?.summary.total_additional_fees,'660');
  assert.equal(client.state.current?.report?.generation.mode,'template');
  assert(client.state.current?.report?.corrections.some(item => item.after === '55'));
  await client.reset();
  assert.equal(client.state.connection,'ready'); assert.equal(client.state.current,null);
  assert.deepEqual(client.state.parsed,{});
});
