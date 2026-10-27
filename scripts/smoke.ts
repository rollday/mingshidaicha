import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { config } from '../src/config.ts';
import { createBackend } from '../src/server.ts';

// Explicitly opt-in: sends this generated, non-personal sample to the configured model.
const directory = await mkdtemp(join(tmpdir(), 'loan-smoke-'));
const pdfPath = join(directory, 'synthetic.pdf');
const generated = spawnSync(config.python, ['-c', `import pymupdf,sys
d=pymupdf.open();p=d.new_page();p.insert_textbox((50,50,540,300),"SYNTHETIC TEST DATA.\\nDisbursement: 1000 yuan at period 0.\\nRepayment: 1100 yuan at period 1.\\nOne period per year. Total 1 repayment. No fees.\\nDisclosed simple annual rate: 10%.",fontsize=11);d.save(sys.argv[1]);d.close()`, pdfPath]);
assert.equal(generated.status, 0, 'Could not create test PDF');
const backend = await createBackend();
try {
  backend.server.listen(0, '127.0.0.1'); await once(backend.server, 'listening');
  const address = backend.server.address(); assert(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  const session = await (await fetch(url + '/api/sessions', { method: 'POST' })).json() as { session_token: string };
  const uploaded = await fetch(url + '/api/documents', { method: 'POST', headers: { Authorization: `Bearer ${session.session_token}`, 'Content-Type': 'application/pdf' }, body: await readFile(pdfPath) });
  assert.equal(uploaded.status, 201);
  const document = await uploaded.json() as { document_id: string };
  const ws = new WebSocket(url.replace('http:', 'ws:') + '/ws');
  const received: string[] = [];
  const done = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Smoke test timed out')), 95000);
    ws.on('error', reject);
    ws.on('message', raw => {
      const event = JSON.parse(raw.toString()); received.push(event.type);
      if (event.type === 'task.error' || event.type === 'request.error') { clearTimeout(timeout); reject(new Error(JSON.stringify(event.data))); }
      if (event.type === 'session.ready') ws.send(JSON.stringify({ type: 'audit.document', request_id: 'document', document_id: document.document_id }));
      if (event.type === 'audit.review') {
        if (!event.data.calculation) { clearTimeout(timeout); reject(new Error('Model requires missing fields: ' + JSON.stringify(event.data.missing_fields))); return; }
        // This script is the confirming client for its own synthetic data.
        const calculation = event.data.calculation;
        assert.equal(calculation.disbursements[0].amount.replace(/\.0+$/, ''), '1000');
        assert.equal(calculation.repayments[0].amount.replace(/\.0+$/, ''), '1100');
        assert.equal(calculation.periods_per_year, 1);
        ws.send(JSON.stringify({ type: 'audit.calculate', request_id: 'calculate', input: calculation }));
      }
      if (event.type === 'audit.result') {
        assert.equal(event.data.simple_apr, '0.1');
        clearTimeout(timeout); resolve();
      }
    });
  });
  await once(ws, 'open'); ws.send(JSON.stringify({ type: 'session.authenticate', request_id: 'authenticate', token: session.session_token }));
  await done;
  console.log(JSON.stringify({ ok: true, model: config.model, stages: [...new Set(received)], verified_simple_apr: '0.1', sample: 'generated synthetic PDF' }));
} finally { await backend.close(); await rm(directory, { recursive: true, force: true }); }
