import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { CaseClient } from '../frontend/src/lib/case-client.ts';

type SocketEvent = { version: 1; type: string; request_id: string; timestamp: string; data?: any };
class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static sockets: MockWebSocket[] = [];
  readyState = MockWebSocket.CONNECTING;
  onopen: ((event: any) => void) | null = null;
  onmessage: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onclose: ((event: any) => void) | null = null;
  sent: string[] = [];
  readonly url: string;
  constructor(url: string) { this.url = url; MockWebSocket.sockets.push(this); }
  send(value: string) { this.sent.push(value); }
  open() { this.readyState = MockWebSocket.OPEN; this.onopen?.({}); }
  message(event: SocketEvent) { this.onmessage?.({ data: JSON.stringify(event) }); }
  close() { if (this.readyState !== 3) { this.readyState = 3; this.onclose?.({}); } }
  serverClose() { this.close(); }
  authenticate() {
    const auth = JSON.parse(this.sent.at(-1)!);
    this.message({ version: 1, type: 'session.ready', request_id: auth.request_id, timestamp: '' });
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function eventually(predicate: () => boolean, message: string, timeoutMs = 1500) {
  return new Promise<void>((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (predicate()) return resolve();
      if (Date.now() - started >= timeoutMs) return reject(new Error(message));
      setTimeout(poll, 5);
    };
    poll();
  });
}
function setup(t: TestContext, fetchImpl: typeof fetch = async input => {
  if (String(input).startsWith('/api/samples')) return json([]);
  if (String(input).startsWith('/api/sessions')) return json({ session_id: 's1', session_token: 'token-s1', websocket_path: '/ws', expires_in_seconds: 900 });
  return json({ document_id: 'doc1' });
}) {
  const oldFetch = globalThis.fetch;
  const oldWS = globalThis.WebSocket;
  const oldLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  MockWebSocket.sockets = [];
  globalThis.fetch = fetchImpl;
  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { protocol: 'http:', host: 'mock.test' } });
  const client = new CaseClient();
  t.after(() => {
    client.dispose();
    globalThis.fetch = oldFetch;
    globalThis.WebSocket = oldWS;
    if (oldLocation) Object.defineProperty(globalThis, 'location', oldLocation);
    else Reflect.deleteProperty(globalThis, 'location');
  });
  return client;
}
async function connect(client: CaseClient) {
  const opening = client.open();
  await eventually(() => MockWebSocket.sockets.length === 1, 'initial socket was not created');
  const socket = MockWebSocket.sockets[0]!;
  socket.open(); socket.authenticate();
  await opening;
  return socket;
}

test('retries each failed reconnect with bounded backoff and remains meaningfully offline', async t => {
  const client = setup(t);
  const first = await connect(client);
  first.serverClose();
  await eventually(() => MockWebSocket.sockets.length === 2, 'first reconnect was not scheduled', 2500);
  const second = MockWebSocket.sockets[1]!;
  second.onerror?.({}); second.serverClose();
  await eventually(() => MockWebSocket.sockets.length === 3, 'second reconnect was not scheduled', 3500);
  const third = MockWebSocket.sockets[2]!;
  third.onerror?.({}); third.serverClose();
  await eventually(() => MockWebSocket.sockets.length === 4, 'third reconnect was not scheduled', 5500);
  const fourth = MockWebSocket.sockets[3]!;
  fourth.onerror?.({}); fourth.serverClose();
  await eventually(() => client.state.error?.code === 'RECONNECT_EXHAUSTED', 'retry exhaustion was not reported');
  assert.equal(client.state.connection, 'offline');
  assert.match(client.state.error!.message, /多次尝试/);
  await new Promise(resolve => setTimeout(resolve, 4500));
  assert.equal(MockWebSocket.sockets.length, 4, 'retry budget must not create another socket');
});

test('cancel during upload prevents case.start even when the HTTP upload resolves late', async t => {
  const upload = deferred<Response>();
  const client = setup(t, async input => {
    if (String(input).startsWith('/api/samples')) return json([]);
    if (String(input).startsWith('/api/sessions')) return json({ session_id: 's1', session_token: 'token-s1', websocket_path: '/ws', expires_in_seconds: 900 });
    return upload.promise;
  });
  const socket = await connect(client);
  const file = new File(['loan'], 'loan.pdf', { type: 'application/pdf' });
  const starting = client.start([{ file, role: 'contract' }], '', null, '');
  client.cancel();
  upload.resolve(json({ document_id: 'late-doc' }));
  await starting;
  assert.equal(client.state.busy, false);
  assert.equal(socket.sent.some(value => JSON.parse(value).type === 'case.start'), false);
});

test('reset ignores a late upload and callbacks from the previous socket', async t => {
  const upload = deferred<Response>();
  let sessionNumber = 0;
  const client = setup(t, async input => {
    const url = String(input);
    if (url.startsWith('/api/samples')) return json([]);
    if (url.startsWith('/api/sessions/current')) return json({ deleted: true });
    if (url.startsWith('/api/sessions')) {
      sessionNumber++;
      return json({ session_id: `s${sessionNumber}`, session_token: `token-s${sessionNumber}`, websocket_path: '/ws', expires_in_seconds: 900 });
    }
    return upload.promise;
  });
  const oldSocket = await connect(client);
  const starting = client.start([{ file: new File(['loan'], 'loan.pdf'), role: 'contract' }], '', null, '');
  const resetting = client.reset();
  await eventually(() => MockWebSocket.sockets.length === 2, 'reset did not open a new socket');
  const newSocket = MockWebSocket.sockets[1]!;
  newSocket.open(); newSocket.authenticate();
  await resetting;
  oldSocket.message({ version: 1, type: 'task.progress', request_id: 'late', timestamp: '', data: { stage: 'old task' } });
  upload.resolve(json({ document_id: 'late-doc' }));
  await starting;
  assert.equal(client.state.connection, 'ready');
  assert.equal(client.state.stage, '');
  assert.equal(client.state.busy, false);
  assert.equal(newSocket.sent.some(value => JSON.parse(value).type === 'case.start'), false);
});

test('a late session response from an older open cannot replace the newer socket', async t => {
  const delayedSession = deferred<Response>();
  let sessionPosts = 0;
  const client = setup(t, async input => {
    const url = String(input);
    if (url.startsWith('/api/samples')) return json([]);
    if (url.startsWith('/api/sessions')) {
      sessionPosts++;
      if (sessionPosts === 1) return delayedSession.promise;
      return json({ session_id: 'new', session_token: 'new-token', websocket_path: '/ws', expires_in_seconds: 900 });
    }
    return json({});
  });
  const olderOpen = client.open();
  await eventually(() => sessionPosts === 1, 'first session request did not start');
  const newerOpen = client.open();
  await eventually(() => MockWebSocket.sockets.length === 1, 'newer open did not create its socket');
  const socket = MockWebSocket.sockets[0]!;
  socket.open(); socket.authenticate();
  await newerOpen;
  delayedSession.resolve(json({ session_id: 'old', session_token: 'old-token', websocket_path: '/old-ws', expires_in_seconds: 900 }));
  await olderOpen;
  assert.equal(MockWebSocket.sockets.length, 1);
  assert.equal(socket.url, 'ws://mock.test/ws');
  assert.equal(client.state.connection, 'ready');
});

test('a revision conflict requests a snapshot without leaving busy stuck or hiding the error', async t => {
  const client = setup(t);
  const socket = await connect(client);
  client.manual(false);
  const command = JSON.parse(socket.sent.at(-1)!);
  socket.message({ version: 1, type: 'case.review', request_id: command.request_id, timestamp: '', data: { case_id: 'case1', revision: 4, report: null } });
  socket.message({ version: 1, type: 'request.error', request_id: command.request_id, timestamp: '', data: { code: 'REVISION_CONFLICT', message: 'case changed' } });
  assert.equal(client.state.busy, false);
  assert.equal(client.state.error?.code, 'REVISION_CONFLICT');
  const get = JSON.parse(socket.sent.at(-1)!);
  assert.equal(get.type, 'case.get');
  socket.message({ version: 1, type: 'case.snapshot', request_id: get.request_id, timestamp: '', data: { case_id: 'case1', revision: 5, report: null } });
  assert.equal(client.state.current?.revision, 5);
  assert.equal(client.state.busy, false);
  assert.equal(client.state.error?.code, 'REVISION_CONFLICT');
});

test('expired authentication can reset into a fresh session and discards prior state', async t => {
  let sessions = 0;
  const client = setup(t, async input => {
    const url = String(input);
    if (url.startsWith('/api/samples')) return json([]);
    if (url.startsWith('/api/sessions/current')) return json({ deleted: true });
    if (url.startsWith('/api/sessions')) {
      sessions++;
      return json({ session_id: `s${sessions}`, session_token: `token-s${sessions}`, websocket_path: '/ws', expires_in_seconds: 900 });
    }
    return json({});
  });
  const opening = client.open();
  await eventually(() => MockWebSocket.sockets.length === 1, 'initial socket was not created');
  const oldSocket = MockWebSocket.sockets[0]!;
  oldSocket.open();
  const oldAuth = JSON.parse(oldSocket.sent[0]!);
  client.update({ stage: 'stale', warning: 'stale warning', busy: true });
  oldSocket.message({ version: 1, type: 'request.error', request_id: oldAuth.request_id, timestamp: '', data: { code: 'SESSION_EXPIRED', message: 'session expired' } });
  await eventually(() => client.state.error?.code === 'SESSION_EXPIRED', 'authentication expiration was not reported');
  await opening;
  const resetting = client.reset();
  await eventually(() => MockWebSocket.sockets.length === 2, 'fresh session socket was not created');
  const freshSocket = MockWebSocket.sockets[1]!;
  freshSocket.open(); freshSocket.authenticate();
  await resetting;
  assert.equal(sessions, 2);
  assert.equal(client.state.connection, 'ready');
  assert.equal(client.state.current, null);
  assert.deepEqual(client.state.parsed, {});
  assert.equal(client.state.stage, '');
  assert.equal(client.state.warning, null);
  assert.equal(client.state.busy, false);
});
