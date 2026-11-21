#!/usr/bin/env node
// Batch transport only: expected answers are never sent to extraction or generated here.
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const mimeTypes = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
const roles = new Set(['disclosure', 'contract', 'schedule', 'other']);
const hash = value => createHash('sha256').update(value).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function requireValue(condition, message) { if (!condition) throw new Error(message); }

export async function prepareManifest(manifestPath) {
  const bytes = await readFile(manifestPath);
  const manifest = JSON.parse(bytes.toString('utf8'));
  requireValue(manifest.version === 1, 'manifest.version must be 1');
  const base = new URL(manifest.base_url);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  requireValue(base.protocol === 'https:' || (local && base.protocol === 'http:'), 'Use HTTPS (HTTP is allowed only on loopback for offline tests)');
  requireValue(!base.username && !base.password && !base.search && !base.hash && base.pathname === '/', 'base_url must be an origin without credentials, query, or path');
  requireValue(/^[a-f0-9]{40}$/i.test(manifest.target_revision ?? ''), 'target_revision must be a full 40-character commit hash');
  requireValue(typeof manifest.grading_policy === 'string' && manifest.grading_policy.length > 0, 'grading_policy is required');
  requireValue(['extract', 'pipeline'].includes(manifest.mode), 'mode must be extract or pipeline');
  requireValue(manifest.export_pdf === undefined || (typeof manifest.export_pdf === 'boolean' && manifest.mode === 'pipeline'), 'export_pdf is supported in pipeline mode');
  requireValue(Array.isArray(manifest.samples) && manifest.samples.length > 0, 'samples must be a non-empty array');
  const ids = new Set(), prepared = [];
  for (const sample of manifest.samples) {
    requireValue(typeof sample.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(sample.id) && !ids.has(sample.id), 'Sample ids must be unique safe filenames');
    ids.add(sample.id);
    requireValue(sample.text === undefined || typeof sample.text === 'string', `${sample.id}: text must be a string`);
    requireValue(sample.context === undefined || object(sample.context), `${sample.id}: context must be an object`);
    const documents = [];
    requireValue(sample.documents === undefined || Array.isArray(sample.documents), `${sample.id}: documents must be an array`);
    requireValue((sample.documents ?? []).length <= 5, `${sample.id}: at most five documents`);
    for (const document of sample.documents ?? []) {
      requireValue(typeof document.path === 'string' && roles.has(document.role), `${sample.id}: each document needs path and role`);
      const path = resolve(dirname(resolve(manifestPath)), document.path);
      const mime = mimeTypes[extname(path).toLowerCase()];
      requireValue(mime, `${sample.id}: unsupported document type`);
      const content = await readFile(path);
      requireValue(content.length > 0 && content.length <= 10 * 1024 * 1024, `${sample.id}: document must be between 1 byte and 10 MiB`);
      documents.push({ path, role: document.role, mime, bytes: content, sha256: hash(content) });
    }
    requireValue(documents.length || sample.text?.trim(), `${sample.id}: provide documents or text`);
    requireValue(!(sample.confirmation && sample.confirmed_facts_file), `${sample.id}: choose only one confirmation source`);
    let confirmedFacts, factsHash;
    if (manifest.mode === 'pipeline') {
      requireValue(sample.confirmation === 'extracted' || typeof sample.confirmed_facts_file === 'string', `${sample.id}: pipeline requires confirmation=extracted or confirmed_facts_file`);
      if (sample.confirmed_facts_file) {
        const facts = await readFile(resolve(dirname(resolve(manifestPath)), sample.confirmed_facts_file));
        confirmedFacts = JSON.parse(facts.toString('utf8'));
        requireValue(object(confirmedFacts), `${sample.id}: confirmed facts must be a complete CaseFacts object`);
        factsHash = hash(facts);
      }
    }
    prepared.push({ ...sample, documents, confirmedFacts, factsHash });
  }
  return { ...manifest, base_url: base.origin, samples: prepared, manifest_sha256: hash(bytes) };
}

function redactor(secrets) {
  return function redact(value) {
    if (typeof value === 'string') {
      for (const secret of secrets) if (secret) value = value.split(secret).join('[REDACTED]');
      return value;
    }
    if (Array.isArray(value)) return value.map(redact);
    if (!object(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
      /^(session_token|token|authorization|password|api_key|apiKey|secret)$/i.test(key) ? '[REDACTED]' : redact(item)]));
  };
}

function connect(url, authorization, timeout, onEvent) {
  const ws = new WebSocket(url, { headers: { Authorization: authorization }, handshakeTimeout: timeout, followRedirects: false });
  const pending = new Map();
  let fatal;
  const fail = error => {
    fatal = error;
    for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(error); }
    pending.clear();
  };
  ws.on('error', () => fail(new Error('WS_CONNECTION_ERROR')));
  ws.on('close', () => fail(new Error('WS_CLOSED')));
  ws.on('unexpected-response', (_request, response) => {
    fail(new Error(`WS_HTTP_${response.statusCode}`));
    response.resume(); ws.terminate();
  });
  ws.on('message', raw => {
    let event;
    try { event = JSON.parse(raw.toString()); onEvent(event); }
    catch { fail(new Error('WS_INVALID_EVENT')); ws.terminate(); return; }
    const waiter = pending.get(event.request_id);
    if (!waiter) return;
    waiter.events.push(event);
    if (['request.error', 'task.error'].includes(event.type)) {
      clearTimeout(waiter.timer); pending.delete(event.request_id);
      const code = event.data?.code;
      waiter.reject(new Error(typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? code : 'REMOTE_TASK_ERROR'));
    } else if (event.type === waiter.until) {
      clearTimeout(waiter.timer); pending.delete(event.request_id); waiter.resolve(waiter.events);
    }
  });
  const opened = new Promise((resolveOpen, rejectOpen) => {
    const timer = setTimeout(() => { ws.terminate(); rejectOpen(new Error('WS_OPEN_TIMEOUT')); }, timeout);
    const stop = () => { clearTimeout(timer); rejectOpen(fatal ?? new Error('WS_CONNECTION_ERROR')); };
    ws.once('open', () => { clearTimeout(timer); ws.off('error', stop); ws.off('close', stop); resolveOpen(); });
    ws.once('error', stop); ws.once('close', stop);
  });
  return {
    opened,
    request(command, until = 'task.completed') {
      if (fatal) return Promise.reject(fatal);
      const request_id = randomUUID();
      return new Promise((resolveRequest, reject) => {
        const timer = setTimeout(() => { pending.delete(request_id); reject(new Error('WS_TASK_TIMEOUT')); }, timeout);
        pending.set(request_id, { until, timer, resolve: resolveRequest, reject, events: [] });
        ws.send(JSON.stringify({ ...command, request_id }), error => { if (error) fail(new Error('WS_SEND_ERROR')); });
      });
    },
    close() { fail(new Error('CLIENT_CLOSED')); ws.terminate(); },
  };
}

export async function runBatch(manifest, { output, credentials, timeout = 180000 }) {
  requireValue(object(credentials) && typeof credentials.username === 'string' && credentials.username.length > 0 &&
    !/[:\r\n]/.test(credentials.username) && typeof credentials.password === 'string' && credentials.password.length > 0 &&
    !/[\r\n]/.test(credentials.password), 'Basic credentials must be supplied through a private JSON file');
  const authorization = 'Basic ' + Buffer.from(credentials.username + ':' + credentials.password).toString('base64');
  const secrets = [authorization, authorization.slice(6), credentials.password];
  const redact = redactor(secrets);
  await mkdir(dirname(resolve(output)), { recursive: true, mode: 0o700 });
  await mkdir(output, { mode: 0o700 }); // Never overwrite an existing run.
  const save = (path, value) => writeFile(path, JSON.stringify(redact(value), null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  const metadata = {
    started_at: new Date().toISOString(), base_url: manifest.base_url,
    target_revision_declared: manifest.target_revision, target_revision_verified_by_runner: false,
    expected_grading_policy: manifest.grading_policy, manifest_sha256: manifest.manifest_sha256,
    runner_sha256: hash(await readFile(fileURLToPath(import.meta.url))), mode: manifest.mode, export_pdf: manifest.export_pdf ?? false,
    samples: manifest.samples.map(s => ({ id: s.id, text_sha256: s.text === undefined ? null : hash(s.text),
      documents: s.documents.map(d => ({ role: d.role, sha256: d.sha256 })),
      confirmation: manifest.mode === 'extract' ? 'none' : s.confirmedFacts ? 'provided_facts' : 'extracted_unreviewed',
      confirmed_facts_sha256: s.factsHash ?? null })),
  };
  await save(resolve(output, 'run.json'), metadata);
  async function http(path, options = {}, token) {
    const response = await fetch(manifest.base_url + path, { ...options, redirect: 'error', signal: AbortSignal.timeout(timeout),
      headers: { ...options.headers, Authorization: authorization, ...(token ? { 'X-Session-Token': token } : {}) } });
    requireValue(response.ok, `HTTP_${response.status}`);
    return response;
  }
  const results = [];
  for (const sample of manifest.samples) {
    const directory = resolve(output, sample.id);
    await mkdir(directory, { mode: 0o700 });
    const logPath = resolve(directory, 'events.jsonl');
    await writeFile(logPath, '', { mode: 0o600, flag: 'wx' });
    const started = Date.now();
    let token, channel;
    const result = { id: sample.id, status: 'failed', cleanup: 'not_needed', started_at: new Date(started).toISOString() };
    try {
      const session = await (await http('/api/sessions', { method: 'POST' })).json();
      requireValue(typeof session.session_token === 'string' && session.session_token, 'INVALID_SESSION_RESPONSE');
      token = session.session_token; secrets.push(token);
      requireValue(session.websocket_path === '/ws', 'INVALID_SESSION_RESPONSE');
      const documents = [];
      for (const document of sample.documents) {
        const uploaded = await (await http('/api/documents', { method: 'POST', headers: { 'Content-Type': document.mime }, body: document.bytes }, token)).json();
        requireValue(typeof uploaded.document_id === 'string', 'INVALID_UPLOAD_RESPONSE');
        documents.push({ document_id: uploaded.document_id, role: document.role });
      }
      const url = new URL('/ws', manifest.base_url); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      channel = connect(url, authorization, timeout, event => appendFileSync(logPath, JSON.stringify(redact(event)) + '\n'));
      await channel.opened;
      await channel.request({ type: 'session.authenticate', token }, 'session.ready');
      const extraction = await channel.request({ type: 'case.start', documents, ...(sample.text ? { text: sample.text } : {}),
        ...(sample.context ? { context: sample.context } : {}) });
      const review = extraction.find(event => event.type === 'case.review')?.data;
      requireValue(review && typeof review.case_id === 'string' && Number.isInteger(review.revision) && object(review.facts), 'MISSING_CASE_REVIEW');
      await save(resolve(directory, 'extracted.json'), review);
      if (manifest.mode === 'pipeline') {
        const events = await channel.request({ type: 'case.confirm', case_id: review.case_id, expected_revision: review.revision,
          facts: sample.confirmedFacts ?? review.facts });
        const checked = events.find(event => event.type === 'case.checked')?.data;
        const report = events.find(event => event.type === 'report.result')?.data;
        requireValue(checked && report?.report, 'MISSING_CHECKED_OR_REPORT');
        await save(resolve(directory, 'checked.json'), checked);
        await save(resolve(directory, 'report.json'), report);
        requireValue(report.report.grading_policy === manifest.grading_policy, 'GRADING_POLICY_MISMATCH');
        result.generation_mode = report.report.generation?.mode ?? null;
        result.calculation_available = Boolean(checked.calculation);
        result.calculation_error = events.find(event => event.type === 'case.calculation_unavailable')?.data?.code ?? null;
        if (manifest.export_pdf) {
          const response = await http('/api/reports/pdf', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ case_id: report.case_id, expected_revision: report.revision }),
          }, token);
          const bytes = Buffer.from(await response.arrayBuffer());
          requireValue(response.headers.get('content-type')?.startsWith('application/pdf') &&
            bytes.subarray(0, 5).toString() === '%PDF-', 'INVALID_REPORT_PDF');
          await writeFile(resolve(directory, 'report.pdf'), bytes, { flag: 'wx', mode: 0o600 });
          result.pdf_sha256 = hash(bytes);
        }
      }
      result.status = 'completed'; // Transport completion, never a grading pass.
    } catch (error) {
      result.error = redact(error.message);
    } finally {
      if (token) {
        try { await (await http('/api/sessions/current', { method: 'DELETE' }, token)).arrayBuffer(); result.cleanup = 'deleted'; }
        catch { result.cleanup = 'failed'; }
      }
      channel?.close();
    }
    result.elapsed_ms = Date.now() - started;
    result.finished_at = new Date().toISOString();
    await save(resolve(directory, 'result.json'), result);
    results.push(result);
    if (result.cleanup === 'failed') break;
  }
  const summary = { finished_at: new Date().toISOString(), planned: manifest.samples.length, attempted: results.length,
    completed: results.filter(r => r.status === 'completed').length, results };
  await save(resolve(output, 'summary.json'), summary);
  return summary;
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) {
    console.log('node scripts/run_batch.mjs --manifest file.json [--execute --basic-auth-file private.json --output new-directory]\nWithout --execute: validate local inputs only; no HTTP or WebSocket requests.');
    return 0;
  }
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    requireValue(['--manifest', '--execute', '--basic-auth-file', '--output'].includes(name), 'Unknown option');
    requireValue(!(name in args), 'Duplicate option');
    if (name === '--execute') args[name] = true;
    else { requireValue(argv[i + 1] && !argv[i + 1].startsWith('--'), 'Missing option value'); args[name] = argv[++i]; }
  }
  requireValue(typeof args['--manifest'] === 'string', '--manifest is required');
  const manifest = await prepareManifest(resolve(args['--manifest']));
  if (!args['--execute']) {
    console.log(JSON.stringify({ mode: 'offline_validation', samples: manifest.samples.length, base_url: manifest.base_url, requests_sent: 0 }));
    return 0;
  }
  requireValue(args['--basic-auth-file'] && args['--output'], 'Execution requires --basic-auth-file and --output');
  const credentialPath = resolve(args['--basic-auth-file']);
  const info = await stat(credentialPath);
  requireValue(info.isFile() && (process.platform === 'win32' || (info.mode & 0o077) === 0), 'Credential file must be private (chmod 600)');
  const credentials = JSON.parse(await readFile(credentialPath, 'utf8'));
  const summary = await runBatch(manifest, { output: resolve(args['--output']), credentials });
  console.log(JSON.stringify({ attempted: summary.attempted, completed: summary.completed, planned: summary.planned }));
  return summary.completed === summary.planned && summary.results.every(r => r.cleanup === 'deleted') ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await main(); }
  catch { console.error('Batch aborted: check manifest, private credential file, and output directory. No credential values are printed.'); process.exitCode = 1; }
}
