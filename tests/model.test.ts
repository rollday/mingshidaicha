import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { config } from '../src/config.ts';
import { ModelClient } from '../src/model.ts';

async function fakeModel(value: unknown, finish = 'stop') {
  const server = createServer(async (req, res) => {
    for await (const _chunk of req) { /* drain */ }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: ' + JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 0, model: 'test', choices: [{ index: 0, delta: { content: JSON.stringify(value) }, finish_reason: finish }] }) + '\n\ndata: [DONE]\n\n');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address === 'object');
  const model = new ModelClient({ ...config, apiKey: 'test-only', baseURL: `http://127.0.0.1:${address.port}/v1` });
  return { model, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

test('fabricated quotations are rejected even if the JSON schema is valid', async t => {
  const f = await fakeModel({ calculation: null, evidence: [{ field: 'loan', quote: '材料没有写的数字', page: null }], missing_fields: [], notes: [] });
  t.after(f.close);
  await assert.rejects(f.model.extract('本金1000元', new AbortController().signal, () => {}), { code: 'UNSUPPORTED_EVIDENCE' });
});

test('an unrelated true quote cannot justify an extracted amount', async t => {
  const f = await fakeModel({
    calculation: { timing: 'periodic', disbursements: [{ amount: '9999', period: 0 }], repayments: [{ amount: '1100', period: 12 }] },
    evidence: [{ field: 'calculation.disbursements[0].amount', quote: '本金1000元', page: null }], missing_fields: [], notes: [],
  });
  t.after(f.close);
  await assert.rejects(f.model.extract('本金1000元', new AbortController().signal, () => {}), { code: 'MISSING_EVIDENCE' });
});

test('a token-limited response is not accepted as a complete extraction', async t => {
  const f = await fakeModel({ calculation: null, evidence: [], missing_fields: ['本金'], notes: [] }, 'length');
  t.after(f.close);
  await assert.rejects(f.model.extract('贷款材料', new AbortController().signal, () => {}), { code: 'MODEL_INCOMPLETE' });
});

test('upstream request is abortable and exposes only a cancellation code', async t => {
  const requested = Promise.withResolvers<void>();
  const server = createServer(async (req, res) => {
    for await (const _chunk of req) { /* drain */ }
    res.writeHead(200, { 'content-type': 'text/event-stream' }); res.flushHeaders(); requested.resolve();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address === 'object');
  t.after(() => { server.closeAllConnections(); return new Promise<void>(resolve => server.close(() => resolve())); });
  const client = new ModelClient({ ...config, apiKey: 'test-only', baseURL: `http://127.0.0.1:${address.port}/v1` });
  const abort = new AbortController();
  const pending = assert.rejects(client.extract('贷款材料', abort.signal, () => {}), { code: 'TASK_CANCELLED' });
  await requested.promise; abort.abort(); await pending;
});
