import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { config } from '../src/config.ts';
import { createBackend } from '../src/server.ts';

const directory = await mkdtemp(join(tmpdir(), 'full-loan-smoke-'));
const imageMode = process.argv.includes('--image');
const materials = [
  { role: 'disclosure', text: `SYNTHETIC TEST DOCUMENT. Cost Disclosure. Lender: Example Bank. Direct bank lending, not an internet-assisted loan. Borrower is not a student. Purpose: personal consumption. Contract principal: 10000 yuan. Actual disbursement: 10000 yuan. Start date: 2026-09-01. Twelve monthly equal installments, each principal-and-interest payment: 888.49 yuan. Disclosed nominal annual total financing cost: 12%. Loan interest nominal annual rate: 12%. Interest payee: Example Bank. All required disclosure items are present: principal, item, collection method, standard, payee. Contingent default costs and payees are disclosed. Marketing: repay as agreed.` },
  { role: 'contract', text: `SYNTHETIC TEST DOCUMENT. Contract clause seven. In addition to the monthly principal-and-interest payment of 888.49 yuan, the borrower pays Example Platform a service fee of 50 yuan EVERY MONTH, for all twelve periods. This is a normal performance cost, not contingent. The fee is NOT included in the 888.49 yuan payment, NOT included in the actual disbursement, NOT listed in the cost disclosure, and NOT included in its disclosed annual total financing cost.` },
];
for (const [index, material] of materials.entries()) {
  const generated = spawnSync(config.python, ['-c', 'import pymupdf,sys;d=pymupdf.open();p=d.new_page();p.insert_textbox((40,40,550,780),sys.argv[2],fontsize=11);d.save(sys.argv[1]);d.close()', join(directory, index + '.pdf'), material.text]);
  assert.equal(generated.status, 0);
  if (imageMode && index === 0) {
    const rendered = spawnSync(config.python, ['-c', 'import pymupdf,sys;d=pymupdf.open(sys.argv[1]);d[0].get_pixmap(matrix=pymupdf.Matrix(1.5,1.5)).save(sys.argv[2]);d.close()', join(directory, '0.pdf'), join(directory, '0.png')]);
    assert.equal(rendered.status, 0);
  }
}
const backend = await createBackend();
try {
  backend.server.listen(0, '127.0.0.1'); await once(backend.server, 'listening');
  const address = backend.server.address(); assert(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const session = await (await fetch(base + '/api/sessions', { method: 'POST' })).json() as { session_token: string };
  const documents = [];
  for (const [index, material] of materials.entries()) {
    const image = imageMode && index === 0;
    const response = await fetch(base + '/api/documents', { method: 'POST', headers: { Authorization: `Bearer ${session.session_token}`, 'Content-Type': image ? 'image/png' : 'application/pdf' }, body: await readFile(join(directory, index + (image ? '.png' : '.pdf'))) });
    assert.equal(response.status, 201);
    const uploaded = await response.json() as { document_id: string };
    documents.push({ document_id: uploaded.document_id, role: material.role });
  }
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws');
  const stages: string[] = [], inbox: any[] = [];
  const waiting: (() => void)[] = [];
  ws.on('message', raw => { const event = JSON.parse(raw.toString()); inbox.push(event); stages.push(event.type); for (const wake of waiting.splice(0)) wake(); });
  const wait = async (type: string, id: string): Promise<any> => {
    const deadline = Date.now() + 95000;
    while (true) {
      const error = inbox.find(e => e.request_id === id && ['task.error', 'request.error'].includes(e.type));
      if (error) throw new Error(JSON.stringify(error.data));
      const index = inbox.findIndex(e => e.request_id === id && e.type === type);
      if (index >= 0) return inbox.splice(index, 1)[0].data;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out: ' + type)), Math.max(1, deadline - Date.now()));
        waiting.push(() => { clearTimeout(timer); resolve(); });
      });
    }
  };
  const send = (data: unknown) => ws.send(JSON.stringify(data));
  await once(ws, 'open'); send({ type: 'session.authenticate', request_id: 'auth', token: session.session_token }); await wait('session.ready', 'auth');
  send({ type: 'case.start', request_id: 'start', documents, context: { is_student: false, purpose: '普通消费' } });
  const review = await wait('case.review', 'start'); await wait('task.completed', 'start');
  assert.equal(review.facts.loan.principal.replace(/\.0+$/, ''), '10000');
  assert.equal(review.facts.loan.disbursed.replace(/\.0+$/, ''), '10000');
  assert.equal(review.facts.loan.term_periods, 12);
  if (imageMode) assert(review.evidence.some((e: any) => e.source_type === 'vision_transcript'));
  const fee = review.facts.fees.find((f: any) => f.contingent === false);
  assert(fee, 'Missing normal service fee');
  assert.equal(fee.amount.replace(/\.0+$/, ''), '50');
  // Simulate a user correction and verify that the confirmed value reaches the calculation and report.
  fee.amount = '55';
  send({ type: 'case.confirm', request_id: 'confirm', case_id: review.case_id, expected_revision: review.revision, facts: review.facts });
  const result = await wait('report.result', 'confirm'); await wait('task.completed', 'confirm');
  assert.equal(result.report.generation.mode, 'ai', JSON.stringify(result.report.generation));
  assert.equal(result.report.calculation.summary.total_additional_fees, '660');
  assert.equal(result.report.rules.find((r: any) => r.rule_id === 'R03').status, 'triggered');
  assert(result.report.corrections.some((c: any) => c.field.endsWith('.amount') && c.after === '55'));
  send({ type: 'case.get', request_id: 'snapshot', case_id: review.case_id });
  const snapshot = await wait('case.snapshot', 'snapshot');
  assert.equal(snapshot.revision, 1); assert.equal(snapshot.history.length, 1); assert(snapshot.report);
  console.log(JSON.stringify({ ok: true, model: config.model, generation: result.report.generation, documents: documents.length, image_mode: imageMode,
    corrected_fee_total: result.report.calculation.summary.total_additional_fees, triggered: result.report.rules.filter((r: any) => r.status === 'triggered').map((r: any) => r.rule_id),
    report_summary: result.report.narrative.summary, events: [...new Set(stages)] }));
} finally { await backend.close(); await rm(directory, { recursive: true, force: true }); }
