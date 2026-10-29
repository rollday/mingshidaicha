import assert from 'node:assert/strict';
import { once } from 'node:events';
import { access, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { config } from '../src/config.ts';
import { createBackend } from '../src/server.ts';
import { reportExportSnapshotMatches } from '../src/report-export.ts';

const sample = JSON.parse(readFileSync(new URL('./fixtures/report-pdf-sample.json', import.meta.url), 'utf8')) as any;

async function createSession(url: string) {
  const response = await fetch(`${url}/api/sessions`, { method: 'POST' });
  assert.equal(response.status, 201);
  return await response.json() as { session_token: string };
}

function websocketClient(url: string) {
  const ws = new WebSocket(url.replace('http:', 'ws:') + '/ws');
  const inbox: any[] = [];
  const waiters: (() => void)[] = [];
  ws.on('message', raw => {
    inbox.push(JSON.parse(raw.toString()));
    for (const wake of waiters.splice(0)) wake();
  });
  const event = async (type: string, id: string) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const index = inbox.findIndex(item => item.type === type && item.request_id === id);
      if (index >= 0) return inbox.splice(index, 1)[0]!;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out: ${type}`)), Math.max(1, deadline - Date.now()));
        waiters.push(() => { clearTimeout(timer); resolve(); });
      });
    }
    throw new Error(`Timed out: ${type}`);
  };
  return { ws, event, send: (value: unknown) => ws.send(JSON.stringify(value)) };
}

async function waitForFile(path: string) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try { await access(path); return; }
    catch { await new Promise(resolve => setTimeout(resolve, 20)); }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

test('PDF export uses only the completed report in the requesting session and its exact revision', async t => {
  const settings = { ...config, apiKey: undefined, port: 0 };
  const backend = await createBackend(settings);
  backend.server.listen(0, '127.0.0.1');
  await once(backend.server, 'listening');
  t.after(() => backend.close());
  const address = backend.server.address();
  assert(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  const owner = await createSession(url);
  const other = await createSession(url);
  const client = websocketClient(url);
  await once(client.ws, 'open');
  t.after(() => { if (client.ws.readyState === WebSocket.OPEN) client.ws.close(); });
  client.send({ type: 'session.authenticate', request_id: 'auth', token: owner.session_token });
  await client.event('session.ready', 'auth');

  const headers = { 'Content-Type': 'application/json', 'X-Session-Token': owner.session_token };
  const legacyBody = await fetch(`${url}/api/reports/pdf`, { method: 'POST', headers, body: JSON.stringify({ report: { title: 'legacy request shape' } }) });
  assert.equal(legacyBody.status, 422);
  const badJson = await fetch(`${url}/api/reports/pdf`, { method: 'POST', headers, body: '{' });
  assert.equal(badJson.status, 400);
  const oversized = await fetch(`${url}/api/reports/pdf`, { method: 'POST', headers, body: JSON.stringify({ case_id: 'x'.repeat(5000), expected_revision: 0 }) });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json() as any).error.code, 'REPORT_REQUEST_TOO_LARGE');

  client.send({ type: 'case.start', request_id: 'start-case', documents: [], manual_facts: sample.facts });
  const review = await client.event('case.review', 'start-case');
  await client.event('task.completed', 'start-case');
  const caseId = review.data.case_id as string;
  const request = (token: string, revision: number) => fetch(`${url}/api/reports/pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Session-Token': token },
    body: JSON.stringify({ case_id: caseId, expected_revision: revision }),
  });

  const notReady = await request(owner.session_token, review.data.revision);
  assert.equal(notReady.status, 409);
  assert.equal((await notReady.json() as any).error.code, 'REPORT_NOT_READY');
  const crossSession = await request(other.session_token, review.data.revision);
  assert.equal(crossSession.status, 404);
  assert.equal((await crossSession.json() as any).error.code, 'CASE_NOT_FOUND');

  client.send({ type: 'case.confirm', request_id: 'confirm-case', case_id: caseId, expected_revision: review.data.revision, facts: review.data.facts });
  const completed = await client.event('report.result', 'confirm-case');
  await client.event('task.completed', 'confirm-case');
  const currentRevision = completed.data.revision as number;
  assert.equal(currentRevision, review.data.revision + 1);

  const stale = await request(owner.session_token, review.data.revision);
  assert.equal(stale.status, 409);
  assert.equal((await stale.json() as any).error.code, 'REVISION_CONFLICT');
  const response = await request(owner.session_token, currentRevision);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /application\/pdf/);
  assert.match(response.headers.get('content-disposition') ?? '', /filename="loan-audit-report\.pdf"/);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString('ascii'), '%PDF-');

  const realPython = settings.python;
  const fakeDirectory = await mkdtemp(join(tmpdir(), 'report-pdf-worker-'));
  t.after(() => rm(fakeDirectory, { recursive: true, force: true }));
  const marker = join(fakeDirectory, 'worker-started');
  const fakePython = join(fakeDirectory, 'fake-python');
  const fakeResult = JSON.stringify({ ok: true, result: { pdf_base64: Buffer.from('%PDF-1.4\n%%EOF\n').toString('base64') } });
  await writeFile(fakePython, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started');\nsetTimeout(() => { process.stdout.write(${JSON.stringify(fakeResult)} + '\\n'); process.exit(0); }, 2500);\n`, { mode: 0o755 });

  settings.python = fakePython;
  const inFlight = request(owner.session_token, currentRevision);
  await waitForFile(marker);
  settings.python = realPython;
  client.send({ type: 'case.confirm', request_id: 'reconfirm-during-export', case_id: caseId, expected_revision: currentRevision, facts: review.data.facts });
  const reconfirmed = await client.event('report.result', 'reconfirm-during-export');
  await client.event('task.completed', 'reconfirm-during-export');
  const changedDuringExport = await inFlight;
  assert.equal(changedDuringExport.status, 409);
  assert.equal((await changedDuringExport.json() as any).error.code, 'REVISION_CONFLICT');

  await unlink(marker);
  settings.python = fakePython;
  const exportCancelledByDispose = request(owner.session_token, reconfirmed.data.revision);
  await waitForFile(marker);
  const disposeResponse = await fetch(`${url}/api/sessions/current`, { method: 'DELETE', headers });
  assert.equal(disposeResponse.status, 200);
  const cancelled = await exportCancelledByDispose;
  assert.equal(cancelled.status, 499);
  assert.equal((await cancelled.json() as any).error.code, 'TASK_CANCELLED');
});

test('in-flight export is invalidated when record, revision, status, or report reference changes', () => {
  const report = { public_source_search: { categories: [{ status: 'before' }] } };
  const record = { revision: 4, status: 'completed', report };
  const snapshot = { record, revision: 4, report, reportJson: JSON.stringify(report) };
  assert.equal(reportExportSnapshotMatches(snapshot, record), true);
  assert.equal(reportExportSnapshotMatches(snapshot, { ...record, revision: 5 }), false);
  assert.equal(reportExportSnapshotMatches(snapshot, { ...record, status: 'review' }), false);
  assert.equal(reportExportSnapshotMatches(snapshot, { ...record, report: {} }), false);
  assert.equal(reportExportSnapshotMatches({ ...snapshot, record: {} }, record), false);
  report.public_source_search.categories[0]!.status = 'updated in place';
  assert.equal(reportExportSnapshotMatches(snapshot, record), false);
});
