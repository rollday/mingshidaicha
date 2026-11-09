import assert from 'node:assert/strict';
import test from 'node:test';
import { caseFactsSchema, type CaseExtraction, type Evidence } from '../src/domain.ts';
import { CaseWorkflow, caseDifferences, remapFeeEvidence } from '../src/cases.ts';
import { config } from '../src/config.ts';
import { AppError } from '../src/errors.ts';
import { invalidateFeePrefills, manualFeeEdits } from '../frontend/src/lib/fee-review.ts';

function fixture(): CaseExtraction {
  const facts = caseFactsSchema.parse({
    loan: { principal: '20000', disbursed: '18871', period_payment: '913.69', nominal_apr: '0.09',
      term_periods: 24, periods_per_year: 12, repay_method: 'equal_installment' },
    fees: [['服务费', '600', 'upfront'], ['咨询费', '499', 'upfront'], ['资料费', '30', 'upfront'],
      ['担保费', '120', 'per_period'], ['平台费', '88', 'per_period']].map(([name, amount, timing], i) => ({
      id: `f${i}`, name, amount, timing, contingent: false,
    })),
  });
  const quotes: [string, string][] = [
    ['loan.principal', '借款本金20000元。'], ['loan.disbursed', '实际到账18871元。'],
    ['loan.period_payment', '每期本息913.69元。'], ['loan.nominal_apr', '月利率0.75%。'],
    ['loan.term_periods', '共24期。'], ['loan.periods_per_year', '按月还款。'], ['loan.repay_method', '采用等额本息。'],
  ];
  for (const [index, fee] of facts.fees.entries()) {
    quotes.push([`fees[${index}].amount`, `${fee.name}${fee.amount}元。`]);
    quotes.push([`fees[${index}].included_in_cashflows`, index < 3
      ? '扣除服务费600元、咨询费499元、资料费30元后，实际到账18871元。'
      : '担保费120元、平台费88元与每期本息一并扣划。']);
  }
  return { facts, evidence: quotes.map(([field, quote], i) => ({ id: `e${i}`, field, quote, document_id: 'text', page: 1 })),
    questions: facts.fees.map((_, i) => ({ field: `fees[${i}].included_in_cashflows`, question: '费用是否已包含？' })), conflicts: [] };
}

async function start() {
  const workflow = new CaseWorkflow({ ...config, apiKey: undefined });
  const extraction = fixture();
  workflow.model.json = async () => structuredClone(extraction);
  let id = '';
  await workflow.execute({ type: 'case.start', request_id: 'start', documents: [], text: extraction.evidence.map(e => e.quote).join('\n') },
    new AbortController().signal, (type, value: any) => { if (type === 'case.review') id = value.case_id; }, () => undefined);
  workflow.model.json = async () => { throw new AppError('MODEL_NOT_CONFIGURED', 'test template'); };
  return { workflow, id };
}

test('source-backed extraction prefills five synthetic v2 fees and reports the correct cashflows', async () => {
  const { workflow, id } = await start(), record = workflow.get(id);
  assert.deepEqual(record.facts.fees.map(f => f.included_in_cashflows), [true, true, true, false, false]);
  assert.equal(record.extraction.questions.length, 0);
  assert.equal(workflow.view(record).fee_prefills?.length, 5);
  await workflow.execute({ type: 'case.confirm', request_id: 'confirm', case_id: id, expected_revision: 0, facts: record.facts },
    new AbortController().signal, () => {}, () => undefined);
  assert.equal(record.report!.calculation!.summary.total_cost, '8049.56');
  assert.match(record.report!.calculation!.calculation.nominal_apr!, /^0\.36739117/);
  assert.equal(record.report!.fee_prefills!.length, 5);
  assert.deepEqual(record.report!.corrections, []);
  const changed = structuredClone(record.facts); changed.fees[4]!.included_in_cashflows = null;
  await workflow.execute({ type: 'case.confirm', request_id: 'manual', case_id: id, expected_revision: 1, facts: changed },
    new AbortController().signal, () => {}, () => undefined);
  assert.equal(record.report!.calculation, null);
  assert.equal(record.report!.calculation_error!.code, 'MISSING_FIELDS');
  assert.deepEqual(record.report!.corrections, [{ field: 'fees[4].included_in_cashflows', before: false, after: null, fee_id: 'f4', fee_name: '平台费' }]);
  assert.equal(record.report!.fee_prefills!.length, 5);
});

test('prefill adoption is revalidated on the server and stale client assertions do not mutate the case', async () => {
  const { workflow, id } = await start(), record = workflow.get(id);
  const stale = structuredClone(record.facts); stale.loan.period_payment = '999';
  await assert.rejects(workflow.execute({ type: 'case.confirm', request_id: 'bad', case_id: id, expected_revision: 0,
    facts: stale, prefill_fee_ids: ['f3', 'f4'] }, new AbortController().signal, () => {}, () => undefined), { code: 'PREFILL_STALE' });
  assert.equal(record.revision, 0); assert.equal(record.facts.loan.period_payment, '913.69');
  assert.equal(record.history.length, 0);
  await workflow.execute({ type: 'case.confirm', request_id: 'good', case_id: id, expected_revision: 0,
    facts: record.facts, prefill_fee_ids: ['f3', 'f4'] }, new AbortController().signal, () => {}, () => undefined);
  assert.equal(record.revision, 1); assert.equal(record.prefill_history.length, 5);
});

test('fee deletion and reordering preserve evidence ownership and only record actual fee edits', () => {
  const original = fixture().facts, changed = structuredClone(original);
  changed.fees = [changed.fees[4]!, changed.fees[3]!]; changed.fees[0]!.amount = '99';
  const differences = caseDifferences(original, changed);
  assert.equal(differences.length, 4);
  assert.deepEqual(differences[0], { field: 'fees[0].amount', before: '88', after: '99', fee_id: 'f4', fee_name: '平台费' });
  assert.ok(differences.slice(1).every(item => item.after === null && ['f0','f1','f2'].includes(item.fee_id!)));
  const evidence: Evidence[] = fixture().evidence;
  const remapped = remapFeeEvidence(evidence, original, changed);
  assert.equal(remapped.find(e => e.id === evidence.find(e => e.field === 'fees[4].amount')!.id)!.field, 'fees[0].amount');
  assert.ok(remapped.find(e => e.id === evidence.find(e => e.field === 'fees[0].amount')!.id)!.field.startsWith('removed_fee.f0.'));
});

test('adopted suggestions remain automatic across a saved snapshot and explicit user overrides remain manual', async () => {
  const workflow = new CaseWorkflow({ ...config, apiKey: undefined });
  const source = fixture();
  source.facts.loan.period_payment = null; source.facts.loan.nominal_apr = null;
  source.facts.loan.disbursed = '20000';
  source.facts.fees = [source.facts.fees[3]!];
  source.evidence = [
    { id: 'principal', field: 'loan.principal', quote: '借款本金20000元。', document_id: 'text', page: 1 },
    { id: 'net', field: 'loan.disbursed', quote: '实际到账20000元。', document_id: 'text', page: 1 },
    { id: 'fee', field: 'fees[0].amount', quote: '每期还款总额1121.69元，含担保费120元。', document_id: 'text', page: 1 },
  ];
  source.questions = []; workflow.model.json = async () => structuredClone(source);
  let id = '';
  await workflow.execute({ type: 'case.start', request_id: 'start', documents: [], text: source.evidence.map(e => e.quote).join('\n') },
    new AbortController().signal, (type, data: any) => { if (type === 'case.review') id = data.case_id; }, () => undefined);
  workflow.model.json = async () => { throw new AppError('MODEL_NOT_CONFIGURED', 'test template'); };
  const record = workflow.get(id), adopted = structuredClone(record.facts);
  adopted.loan.period_payment = '1121.69'; adopted.fees[0]!.included_in_cashflows = true;
  await workflow.execute({ type: 'case.confirm', request_id: 'adopt', case_id: id, expected_revision: 0,
    facts: adopted, prefill_fee_ids: ['f3'] }, new AbortController().signal, () => {}, () => undefined);
  const reopened = workflow.view(record);
  assert.deepEqual(reopened.manual_fee_ids, []);
  assert.equal(reopened.fee_prefills!.length, 1);
  assert.ok(reopened.corrections.some(item => item.field.endsWith('included_in_cashflows')));
  const edited = structuredClone(reopened.facts); edited.loan.period_payment = '900';
  assert.equal(invalidateFeePrefills(reopened.facts, edited, reopened.fee_prefills!, manualFeeEdits(reopened)).fees[0]!.included_in_cashflows, null);
  const manual = structuredClone(record.facts); manual.fees[0]!.included_in_cashflows = false;
  await workflow.execute({ type: 'case.confirm', request_id: 'override', case_id: id, expected_revision: 1,
    facts: manual }, new AbortController().signal, () => {}, () => undefined);
  assert.deepEqual(workflow.view(record).manual_fee_ids, ['f3']);
});
