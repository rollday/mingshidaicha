import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { config } from '../src/config.ts';
import { createBackend } from '../src/server.ts';
import { calculationSchema } from '../src/contracts.ts';

type Event = { type: string; request_id: string | null; data: any };
async function harness() {
  const backend = await createBackend({ ...config, apiKey: undefined, port: 0 });
  backend.server.listen(0, '127.0.0.1'); await once(backend.server, 'listening');
  const address = backend.server.address();
  assert(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  const session = await (await fetch(url + '/api/sessions', { method: 'POST' })).json() as { session_token: string };
  const ws = new WebSocket(url.replace('http:', 'ws:') + '/ws');
  const inbox: Event[] = []; const waiters: (() => void)[] = [];
  ws.on('message', raw => { inbox.push(JSON.parse(raw.toString())); for (const wake of waiters.splice(0)) wake(); });
  await once(ws, 'open');
  async function event(type: string, id: string) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const index = inbox.findIndex(e => e.type === type && e.request_id === id);
      if (index >= 0) return inbox.splice(index, 1)[0]!;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { const i = waiters.indexOf(wake); if (i >= 0) waiters.splice(i, 1); reject(new Error('Timed out: ' + type)); }, Math.max(1, deadline - Date.now()));
        const wake = () => { clearTimeout(timer); resolve(); }; waiters.push(wake);
      });
    }
    throw new Error('Timed out: ' + type);
  }
  return { backend, url, session, ws, event, send: (data: unknown) => ws.send(JSON.stringify(data)) };
}
const input = {
  timing: 'periodic', periods_per_year: 1,
  disbursements: [{ amount: '1000', period: 0 }], repayments: [{ amount: '1100', period: 1 }],
  quoted_apr: '0.1', quoted_method: 'simple',
};

test('WS requires authentication, isolates sessions, and returns Python decimal results', async t => {
  const h = await harness(); t.after(() => h.backend.close());
  h.send({ type: 'audit.calculate', request_id: 'unauth', input });
  assert.equal((await h.event('request.error', 'unauth')).data.code, 'UNAUTHORIZED');
  h.send({ type: 'session.authenticate', request_id: 'auth', token: h.session.session_token });
  await h.event('session.ready', 'auth');
  h.send({ type: 'audit.calculate', request_id: 'calc', input });
  const result = (await h.event('audit.result', 'calc')).data;
  assert.equal(result.simple_apr, '0.1');
  assert.equal(result.comparison.exceeds_tolerance, false);
  await h.event('task.completed', 'calc');
  h.send({ type: 'audit.calculate', request_id: 'calc', input });
  assert.equal((await h.event('request.error', 'calc')).data.code, 'DUPLICATE_REQUEST');
  h.send({ type: 'audit.document', request_id: 'foreign-doc', document_id: '00000000-0000-4000-8000-000000000001' });
  assert.equal((await h.event('task.error', 'foreign-doc')).data.code, 'DOCUMENT_NOT_FOUND');
});

test('origin checks and upload authentication reject invalid requests', async t => {
  const h = await harness(); t.after(() => h.backend.close());
  assert.equal((await fetch(h.url + '/api/sessions', { method: 'POST', headers: { Origin: 'https://untrusted.invalid' } })).status, 403);
  assert.equal((await fetch(h.url + '/api/documents', { method: 'POST', body: 'bad' })).status, 401);
  const response = await fetch(h.url + '/api/documents', { method: 'POST', headers: { Authorization: `Bearer ${h.session.session_token}`, 'Content-Type': 'application/pdf' }, body: 'not a pdf' });
  assert.equal(response.status, 422);
  const proxyAuth = await fetch(h.url + '/api/documents', { method: 'POST', headers: { Authorization: 'Basic dGVzdDp0ZXN0', 'X-Session-Token': h.session.session_token, 'Content-Type': 'application/pdf' }, body: 'not a pdf' });
  assert.equal(proxyAuth.status, 422);
  const badProxyAuth = await fetch(h.url + '/api/documents', { method: 'POST', headers: { Authorization: 'Basic dGVzdDp0ZXN0', 'X-Session-Token': 'wrong', 'Content-Type': 'application/pdf' }, body: 'not a pdf' });
  assert.equal(badProxyAuth.status, 401);
  const health = await (await fetch(h.url + '/api/health')).json() as Record<string, unknown>;
  assert.equal(health.model_configured, false);
  assert.equal(JSON.stringify(health).includes('apiKey'), false);
});

test('financial schema refuses float amounts and unknown fields', () => {
  assert.equal(calculationSchema.safeParse({ ...input, repayments: [{ amount: 1100.1, period: 1 }] }).success, false);
  assert.equal(calculationSchema.safeParse({ ...input, python_path: '/etc/passwd' }).success, false);
});

test('OpenAI streaming extraction goes through WS review before calculation', async t => {
  const extracted = {
    calculation: input,
    evidence: [
      { field: 'calculation.disbursements[0].amount', quote: '到账1000元', page: null },
      { field: 'calculation.repayments[0].amount', quote: '还款1100元', page: null },
    ], missing_fields: [], notes: [],
  };
  const mock = createServer(async (req, res) => {
    assert.equal(req.url, '/v1/chat/completions');
    let body = ''; for await (const chunk of req) body += chunk;
    assert.equal(JSON.parse(body).stream, true);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const text = JSON.stringify(extracted);
    for (const content of [text.slice(0, 40), text.slice(40)]) {
      res.write('data: ' + JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', created: 0, model: 'test', choices: [{ index: 0, delta: { content }, finish_reason: null }] }) + '\n\n');
    }
    res.end('data: ' + JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', created: 0, model: 'test', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
  });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  const mockAddress = mock.address(); assert(mockAddress && typeof mockAddress === 'object');
  const backend = await createBackend({ ...config, apiKey: 'test-only', baseURL: `http://127.0.0.1:${mockAddress.port}/v1` });
  t.after(async () => { await backend.close(); await new Promise<void>(resolve => mock.close(() => resolve())); });
  backend.server.listen(0, '127.0.0.1'); await once(backend.server, 'listening');
  const address = backend.server.address(); assert(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  const session = await (await fetch(url + '/api/sessions', { method: 'POST' })).json() as { session_token: string };
  const ws = new WebSocket(url.replace('http:', 'ws:') + '/ws');
  const events: Event[] = [];
  const done = new Promise<void>((resolve, reject) => {
    ws.on('message', raw => {
      const e: Event = JSON.parse(raw.toString()); events.push(e);
      if (e.type === 'task.error') reject(new Error(JSON.stringify(e.data)));
      if (e.type === 'session.ready') ws.send(JSON.stringify({ type: 'audit.extract', request_id: 'extract', text: '到账1000元，一年后还款1100元。' }));
      if (e.type === 'task.completed') resolve();
    });
  });
  await once(ws, 'open'); ws.send(JSON.stringify({ type: 'session.authenticate', request_id: 'auth', token: session.session_token }));
  await done;
  assert.equal(events.find(e => e.type === 'audit.review')?.data.requires_confirmation, true);
  assert.equal(events.some(e => e.type === 'audit.result'), false);
  assert.equal(events.some(e => e.type === 'model.progress'), true);
});
