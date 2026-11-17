import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { main, prepareManifest, runBatch } from '../scripts/run_batch.mjs';

const credentials = { username: 'batch-fixture', password: 'not-a-live-password-1234' };
const authorization = 'Basic ' + Buffer.from(credentials.username + ':' + credentials.password).toString('base64');
const policy = '2026-10-29.v2';
const facts = { loan: { principal: '9007199254740993.01' }, fees: [] };

async function fixture(t: any, behavior: { policy?: string; fail?: boolean; cleanupFails?: boolean; broken?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'loancheck-batch-test-'));
  const observed = { requests: 0, sessions: 0, uploads: 0, deletes: 0, upgrades: 0, confirms: [] as any[], starts: [] as any[] };
  const server = createServer(async (req, res) => {
    observed.requests++;
    assert.equal(req.headers.authorization, authorization);
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/sessions') {
      observed.sessions++;
      res.statusCode = 201;
      res.end(JSON.stringify({ session_token: `fixture-session-secret-${observed.sessions}`, websocket_path: '/ws' }));
    } else if (req.url === '/api/documents') {
      assert.match(req.headers['x-session-token'] as string, /^fixture-session-secret-/);
      assert.equal(req.headers['content-type'], 'application/pdf');
      let input = ''; for await (const part of req) input += part;
      assert.equal(input, '%PDF-fixture');
      observed.uploads++; res.statusCode = 201; res.end(JSON.stringify({ document_id: 'document-fixture' }));
    } else if (req.url === '/api/sessions/current') {
      assert.match(req.headers['x-session-token'] as string, /^fixture-session-secret-/);
      observed.deletes++;
      res.statusCode = behavior.cleanupFails ? 500 : 200;
      res.end('{}');
    } else { res.statusCode = 404; res.end('{}'); }
  });
  const websocket = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    assert.equal(req.headers.authorization, authorization);
    assert.equal(req.url, '/ws'); observed.upgrades++;
    websocket.handleUpgrade(req, socket, head, ws => websocket.emit('connection', ws));
  });
  websocket.on('connection', ws => {
    ws.on('message', raw => {
      const command = JSON.parse(raw.toString());
      const send = (type: string, data: any) => ws.send(JSON.stringify({ type, request_id: command.request_id, data }));
      if (command.type === 'session.authenticate') {
        assert.match(command.token, /^fixture-session-secret-/); send('session.ready', {}); return;
      }
      if (command.type === 'case.start') {
        observed.starts.push(command);
        if (behavior.broken) { ws.close(); return; }
        if (behavior.fail) { send('task.error', { code: 'MODEL_INVALID_JSON' }); return; }
        send('task.progress', { stage: 'extract_case' });
        send('case.review', { case_id: 'fixture-case', revision: 0, facts, questions: [], conflicts: [] });
        send('task.completed', {});
      } else if (command.type === 'case.confirm') {
        observed.confirms.push(command);
        send('case.calculation_unavailable', { code: 'MISSING_FIELDS' });
        send('case.checked', { calculation: null, rules: [] });
        send('report.warning', { code: 'MODEL_NOT_CONFIGURED' });
        send('report.result', { report: { grading_policy: behavior.policy ?? policy, generation: { mode: 'template' },
          facts: command.facts, calculation: null, session_token: 'fixture-session-secret-1' } });
        send('task.completed', {});
      }
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address === 'object');
  const baseURL = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    for (const client of websocket.clients) client.terminate();
    await new Promise<void>(resolve => websocket.close(() => resolve()));
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  });
  async function manifest(samples: any[], mode = 'pipeline') {
    const path = join(dir, 'manifest.json');
    await writeFile(path, JSON.stringify({ version: 1, base_url: baseURL, mode,
      target_revision: 'a'.repeat(40), grading_policy: policy, samples }));
    return { path, prepared: await prepareManifest(path) };
  }
  return { dir, observed, manifest };
}

test('batch defaults to offline validation and resolves documents relative to the manifest', async t => {
  const f = await fixture(t);
  await writeFile(join(f.dir, 'sample.pdf'), '%PDF-fixture');
  const input = await f.manifest([{ id: 'S2-01', documents: [{ path: 'sample.pdf', role: 'contract' }] }], 'extract');
  assert.equal(input.prepared.samples[0]!.documents[0]!.bytes.toString(), '%PDF-fixture');
  assert.equal(await main(['--manifest', input.path]), 0);
  assert.equal(f.observed.requests, 0);
  assert.equal(f.observed.upgrades, 0);
});

test('batch sends both gateway and session authentication, isolates samples, and does not grade template/partial reports as failures', async t => {
  const f = await fixture(t);
  await writeFile(join(f.dir, 'sample.pdf'), '%PDF-fixture');
  const { prepared } = await f.manifest([
    { id: 'A', documents: [{ path: 'sample.pdf', role: 'contract' }], confirmation: 'extracted' },
    { id: 'B', text: 'fixture text', confirmation: 'extracted', expected_values: { forbidden: 'GOLD-NEVER-SENT' } },
  ]);
  const output = join(f.dir, 'output');
  const result = await runBatch(prepared, { output, credentials, timeout: 1000 });
  assert.equal(result.completed, 2);
  assert.equal(f.observed.sessions, 2); assert.equal(f.observed.deletes, 2); assert.equal(f.observed.uploads, 1);
  assert(f.observed.starts.every(command => !JSON.stringify(command).includes('GOLD-NEVER-SENT')));
  assert.equal(result.results[0]!.generation_mode, 'template');
  assert.equal(result.results[0]!.calculation_available, false);
  assert.equal(result.results[0]!.calculation_error, 'MISSING_FIELDS');
  const report = JSON.parse(await readFile(join(output, 'A/report.json'), 'utf8'));
  assert.equal(report.report.facts.loan.principal, '9007199254740993.01');
  const metadata = JSON.parse(await readFile(join(output, 'run.json'), 'utf8'));
  assert.equal(metadata.target_revision_verified_by_runner, false);
  const contents: string[] = [];
  for (const sample of ['A', 'B']) for (const name of await readdir(join(output, sample))) contents.push(await readFile(join(output, sample, name), 'utf8'));
  for (const value of [credentials.password, authorization, 'fixture-session-secret-1', 'fixture-session-secret-2']) {
    assert(!contents.join('\n').includes(value));
  }
  await assert.rejects(runBatch(prepared, { output, credentials }), { code: 'EEXIST' });
});

test('review-only mode never confirms extracted facts; independent confirmed facts are used only after extraction', async t => {
  const f = await fixture(t);
  const extract = await f.manifest([{ id: 'review', text: 'fixture' }], 'extract');
  await runBatch(extract.prepared, { output: join(f.dir, 'review-output'), credentials, timeout: 1000 });
  assert.equal(f.observed.confirms.length, 0);
  const independent = { loan: { principal: '123.45' }, fees: [] };
  await writeFile(join(f.dir, 'confirmed.json'), JSON.stringify(independent));
  const pipeline = await f.manifest([{ id: 'confirmed', text: 'fixture', confirmed_facts_file: 'confirmed.json' }]);
  await runBatch(pipeline.prepared, { output: join(f.dir, 'confirmed-output'), credentials, timeout: 1000 });
  assert.deepEqual(f.observed.confirms[0].facts, independent);
  assert(!JSON.stringify(f.observed.starts).includes('123.45'));
});

test('policy mismatch and upstream task errors remain failed samples and still delete sessions', async t => {
  for (const behavior of [{ policy: 'different' }, { fail: true }, { broken: true }]) {
    const f = await fixture(t, behavior);
    const { prepared } = await f.manifest([{ id: 'failure', text: 'fixture', confirmation: 'extracted' }]);
    const result = await runBatch(prepared, { output: join(f.dir, 'output'), credentials, timeout: 1000 });
    assert.equal(result.completed, 0);
    assert.equal(f.observed.deletes, 1);
    assert.match(result.results[0]!.error!, /GRADING_POLICY_MISMATCH|MODEL_INVALID_JSON|WS_CLOSED/);
  }
});

test('cleanup failure stops the batch rather than accumulating server sessions', async t => {
  const f = await fixture(t, { cleanupFails: true });
  const { prepared } = await f.manifest(['A', 'B'].map(id => ({ id, text: 'fixture', confirmation: 'extracted' })));
  const result = await runBatch(prepared, { output: join(f.dir, 'output'), credentials, timeout: 1000 });
  assert.equal(result.attempted, 1); assert.equal(result.results[0]!.cleanup, 'failed');
});

test('invalid manifests cannot use credential URLs, duplicate ids, or implicitly confirm model output', async t => {
  const f = await fixture(t);
  await assert.rejects(f.manifest([{ id: 'A', text: 'fixture' }]), /pipeline requires/);
  await assert.rejects(f.manifest([{ id: '../A', text: 'fixture' }], 'extract'), /safe filenames/);
  await assert.rejects(f.manifest([{ id: 'A', text: 'fixture' }, { id: 'A', text: 'fixture' }], 'extract'), /safe filenames/);
  await assert.rejects(f.manifest([{ id: 123, text: 'fixture' }], 'extract'), /safe filenames/);
  const { path } = await f.manifest([{ id: 'valid', text: 'fixture' }], 'extract');
  const contents = JSON.parse(await readFile(path, 'utf8'));
  contents.base_url = 'https://username:password@example.invalid/';
  await writeFile(path, JSON.stringify(contents));
  await assert.rejects(prepareManifest(path), /without credentials/);
  assert.equal(f.observed.requests, 0);
});
