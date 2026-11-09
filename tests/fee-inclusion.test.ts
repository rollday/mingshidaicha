import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { CaseModel } from '../src/case-model.ts';
import { config } from '../src/config.ts';
import { caseFactsSchema, type CaseExtraction } from '../src/domain.ts';

const defaultQuote = '每期还款总额1121.69元，已包含管理费120元、保障费88元。';
function fixture(quote = defaultQuote, overrides: Record<string, unknown> = {}): CaseExtraction {
  const facts = caseFactsSchema.parse({
    loan: { principal: '20000', disbursed: '20000', term_periods: 24, periods_per_year: 12,
      repay_method: 'equal_installment', period_payment: '1121.69' },
    fees: [{ id: 'a', name: '管理费', amount: '120', timing: 'per_period', included_in_cashflows: true, contingent: false },
      { id: 'b', name: '保障费', amount: '88', timing: 'per_period', included_in_cashflows: true, contingent: false }],
    ...overrides,
  });
  const amounts: [string, string | null][] = [
    ['loan.principal', facts.loan.principal], ['loan.disbursed', facts.loan.disbursed], ['loan.period_payment', facts.loan.period_payment],
    ...facts.fees.map((fee, index): [string, string | null] => [`fees[${index}].amount`, fee.amount]),
  ];
  return { facts, evidence: [
    ...amounts.filter((entry): entry is [string, string] => entry[1] !== null).map(([field, amount], index) => ({
      id: `amount-${index}`, field, document_id: 'd', page: 1, quote: `${field}：${amount}元`,
    })),
    ...facts.fees.map((_, index) => ({ id: `included-${index}`, field: `fees[${index}].included_in_cashflows`, document_id: 'd', page: 1, quote })),
  ], questions: [], conflicts: [] };
}
async function extract(output: CaseExtraction, source?: string) {
  const model = new CaseModel({ ...config, apiKey: undefined });
  model.json = async () => structuredClone(output);
  return model.extract([{ id: 'd', role: 'contract', pages: [{ page: 1,
    text: source ?? output.evidence.map(item => item.quote).join('\n') }] }], undefined, new AbortController().signal, () => {});
}
const statuses = (output: CaseExtraction) => output.facts.fees.map(fee => fee.included_in_cashflows);

test('explicit all-in amount preserves included recurring fees', async () => {
  assert.deepEqual(statuses(await extract(fixture())), [true, true]);
  const reverse = fixture('管理费120元已包含在每期还款总额1121.69元中。保障费88元已计入每期还款总额1121.69元中。');
  assert.deepEqual(statuses(await extract(reverse)), [true, true]);
});

test('collection timing and unrelated total amounts cannot establish inclusion', async () => {
  for (const quote of [
    '管理费120元、保障费88元与每期本息一并扣划，每期本息913.69元。',
    '管理费120元、保障费88元统一代扣。',
    '每期还款总额1121.69元。明示年化已包含管理费120元、保障费88元。',
    '每期还款总额1121.69元，含其他费用10元。备注：管理费120元、保障费88元。',
    '每期还款总额1121.69元，含其他费用10元，备注：管理费120元、保障费88元。',
    '每期还款总额1121.69元，包含贷款管理费120元、其他保障费88元。',
  ]) {
    const result = await extract(fixture(quote));
    assert.deepEqual(statuses(result), [null, null], quote);
    assert.equal(result.questions.filter(question => question.field.endsWith('.included_in_cashflows')).length, 2);
  }
});

test('inclusion must match the selected payment and exact fee amounts', async () => {
  for (const quote of [
    '每期还款总额913.69元，含管理费120元、保障费88元。',
    '每期还款总额1121.69元，含管理费1200元、保障费880元。',
  ]) assert.deepEqual(statuses(await extract(fixture(quote))), [null, null]);
  const aggregate = fixture('每期还款总额150元，含管理费120元、保障费88元。');
  aggregate.facts.loan.period_payment = '150';
  aggregate.evidence.find(item => item.field === 'loan.period_payment')!.quote = '每期还款额150元';
  assert.deepEqual(statuses(await extract(aggregate)), [null, null]);
});

test('negations, conditions and conflicting evidence do not support true', async () => {
  for (const quote of [
    '每期还款总额1121.69元，不包含管理费120元、保障费88元。',
    '每期还款总额1121.69元，未计入管理费120元、保障费88元。',
    '如果每期还款总额1121.69元，含管理费120元、保障费88元。',
  ]) assert.deepEqual(statuses(await extract(fixture(quote))), [null, null]);
  const conflicting = fixture();
  conflicting.evidence.push({ id: 'negative', field: 'fees[0].included_in_cashflows', document_id: 'd', page: 1, quote: '管理费120元未计入每期还款额。' });
  assert.deepEqual(statuses(await extract(conflicting)), [null, true]);
  const declared = fixture();
  declared.conflicts.push({ field: 'loan.period_payment', description: '还款总额冲突', evidence_ids: ['included-0'] });
  assert.deepEqual(statuses(await extract(declared)), [null, null]);
});

test('missing, malformed or duplicate-name attribution stays unknown', async () => {
  const missing = fixture();
  missing.evidence = missing.evidence.filter(item => !item.field.endsWith('.included_in_cashflows'));
  assert.deepEqual(statuses(await extract(missing)), [null, null]);
  const malformed = fixture();
  malformed.evidence.filter(item => item.id.startsWith('included')).forEach(item => { item.field = 'fees[0x].included_in_cashflows'; });
  assert.deepEqual(statuses(await extract(malformed)), [null, null]);
  const duplicate = fixture();
  duplicate.facts.fees[1]!.name = '管理费';
  assert.deepEqual(statuses(await extract(duplicate)), [null, null]);
  const prefixed = fixture();
  prefixed.evidence.forEach(item => { item.field = `facts.${item.field}`; });
  assert.deepEqual(statuses(await extract(prefixed)), [true, true]);
});

test('example and non-applicable context before or after inclusion cannot establish true', async () => {
  for (const context of ['以下仅为示例：', '例如：', '举例说明：', '仅供参考：', '不适用于本合同：', '假定：']) {
    for (const quote of [context + defaultQuote, defaultQuote + context]) {
      assert.deepEqual(statuses(await extract(fixture(quote))), [null, null], quote);
    }
  }
  for (const quote of [
    '示例：扣除服务费600元、咨询费499元、资料费30元后，实际到账18871元。',
    '扣除服务费600元、咨询费499元、资料费30元后，实际到账18871元。以上仅供示意。',
  ]) assert.deepEqual(statuses(await extract(upfront(quote))), [null, null, null]);
});

test('a matching total cannot hide contradictory totals in inclusion evidence', async () => {
  for (const quote of [
    defaultQuote + '每期还款总额913.69元。',
    '每期还款总额913.69元。' + defaultQuote,
  ]) assert.deepEqual(statuses(await extract(fixture(quote))), [null, null]);
  const separateEvidence = fixture();
  separateEvidence.evidence.push({ id: 'different-total', field: 'fees[0].included_in_cashflows', document_id: 'd', page: 1, quote: '每期还款总额913.69元，含管理费120元。' });
  assert.deepEqual(statuses(await extract(separateEvidence)), [null, true]);
  assert.deepEqual(statuses(await extract(fixture(defaultQuote + '每月还款合计1121.690元。'))), [true, true]);
  assert.deepEqual(statuses(await extract(upfront('扣除服务费600元、咨询费499元、资料费30元后，实际到账18871元。实际到账19000元。'))), [null, null, null]);
});

test('existing source quote and amount validation precede the inclusion guard', async () => {
  await assert.rejects(extract(fixture(), '原文中没有这些摘录'), { code: 'UNSUPPORTED_EVIDENCE' });
  const missingAmount = fixture();
  missingAmount.evidence = missingAmount.evidence.filter(item => item.field !== 'loan.period_payment');
  const result = await extract(missingAmount);
  assert.equal(result.facts.loan.period_payment, null);
  assert.deepEqual(statuses(result), [null, null]);
});

test('unsupported schedules and timing remain unknown; false and null are retained', async () => {
  const schedule = fixture();
  schedule.facts.repayments = [{ period: 1, amount: '1121.69' }];
  assert.deepEqual(statuses(await extract(schedule)), [null, null]);
  const timing = fixture();
  timing.facts.fees.forEach(fee => { fee.timing = 'at_maturity'; });
  assert.deepEqual(statuses(await extract(timing)), [null, null]);
  const unchanged = fixture();
  unchanged.facts.fees[0]!.included_in_cashflows = false;
  unchanged.facts.fees[1]!.included_in_cashflows = null;
  assert.deepEqual(statuses(await extract(unchanged)), [false, null]);
});

function upfront(quote = '本金20000元，扣除服务费600元、咨询费499元、资料费30元后，实际到账18871元。') {
  return fixture(quote, {
    loan: { principal: '20000', disbursed: '18871', term_periods: 24, periods_per_year: 12, repay_method: 'equal_installment', period_payment: '913.69' },
    fees: [['服务费', '600'], ['咨询费', '499'], ['资料费', '30']].map(([name, amount], index) => ({
      id: `upfront-${index}`, name, amount, timing: 'upfront', included_in_cashflows: true, contingent: false,
    })),
  });
}

test('named fees already deducted from the selected net receipt remain included', async () => {
  assert.deepEqual(statuses(await extract(upfront())), [true, true, true]);
  assert.deepEqual(statuses(await extract(upfront('借款本金20000元，放款时扣除服务费600元、咨询费499元、资料费30元，实际到账18871元。'))), [true, true, true]);
  assert.deepEqual(statuses(await extract(upfront('实际到账18871元，已扣除服务费600元、咨询费499元、资料费30元。'))), [true, true, true]);
});

test('upfront deduction requires matching selected receipt and sufficient aggregate deduction', async () => {
  for (const quote of [
    '扣除服务费600元、咨询费499元、资料费30元后，实际到账20000元。',
    '尚未扣除服务费600元、咨询费499元、资料费30元后，实际到账18871元。',
    '放款同日收取服务费600元、咨询费499元、资料费30元，实际到账18871元。',
    '扣除其他费1129元，备注：服务费600元、咨询费499元、资料费30元后，实际到账18871元。',
  ]) assert.deepEqual(statuses(await extract(upfront(quote))), [null, null, null], quote);
  const tooLarge = upfront();
  tooLarge.facts.loan.principal = '19999.99';
  tooLarge.evidence.find(item => item.field === 'loan.principal')!.quote = '本金19999.99元';
  assert.deepEqual(statuses(await extract(tooLarge)), [null, null, null]);
});

test('exact decimal aggregates and normalized source amounts avoid float drift', async () => {
  const small = fixture('每期还款总额0.3元，含管理费0.1元、保障费0.2元。');
  small.facts.loan.period_payment = '0.3';
  small.facts.fees[0]!.amount = '0.1'; small.facts.fees[1]!.amount = '0.2';
  for (const [field, amount] of [['loan.period_payment', '0.3'], ['fees[0].amount', '0.1'], ['fees[1].amount', '0.2']]) {
    small.evidence.find(item => item.field === field)!.quote = `${amount}元`;
  }
  assert.deepEqual(statuses(await extract(small)), [true, true]);
  assert.deepEqual(statuses(await extract(fixture('每期还款总额１，１２１．６９元，已包含管理费１２０．００元、保障费８８元。'))), [true, true]);
});

test('extracted upfront inclusion preserves equivalent Python cashflows', async () => {
  const included = (await extract(upfront())).facts;
  const separate = structuredClone(included);
  separate.loan.disbursed = '20000';
  separate.fees.forEach(fee => { fee.included_in_cashflows = false; });
  const process = spawnSync('.venv/bin/python', ['-c',
    'import json,sys\nfrom python.loan_plan import calculate_loan\na,b=map(calculate_loan,json.load(sys.stdin))\nassert a["calculation"]["cashflows"]==b["calculation"]["cashflows"]\nassert a["summary"]["total_cost"]==b["summary"]["total_cost"]\nprint("equivalent")'],
  { input: JSON.stringify([included, separate]), encoding: 'utf8' });
  assert.equal(process.status, 0, process.stderr || process.error?.message || 'Python process did not complete');
  assert.match(process.stdout, /equivalent/);
});

test('ambiguous extraction blocks Python until user confirms additional recurring fees', async () => {
  const output = upfront();
  output.facts.loan.disbursed = '20000';
  output.evidence.find(item => item.field === 'loan.disbursed')!.quote = '实际到账20000元';
  output.facts.fees.forEach(fee => { fee.included_in_cashflows = false; });
  output.facts.fees.push(...fixture().facts.fees);
  for (const [index, fee] of output.facts.fees.entries()) {
    if (index < 3) continue;
    output.evidence.push(
      { id: `recurring-amount-${index}`, field: `fees[${index}].amount`, document_id: 'd', page: 1, quote: `${fee.name}${fee.amount}元` },
      { id: `recurring-inclusion-${index}`, field: `fees[${index}].included_in_cashflows`, document_id: 'd', page: 1,
        quote: '管理费120元、保障费88元与每期本息913.69元一并扣划。' });
  }
  const extracted = (await extract(output)).facts;
  assert.deepEqual(extracted.fees.map(fee => fee.included_in_cashflows), [false, false, false, null, null]);
  const process = spawnSync('.venv/bin/python', ['-c',
    'import json,sys\nfrom decimal import Decimal\nfrom python.loan_plan import calculate_loan\nfrom python.calculation import CalculationError\nf=json.load(sys.stdin)\ntry:\n calculate_loan(f)\nexcept CalculationError as e:\n assert "fees[3].included_in_cashflows" in e.details["fields"]\nelse:\n raise AssertionError("ambiguous fees must block calculation")\nfor fee in f["fees"]: fee["included_in_cashflows"]=False\nr=calculate_loan(f)\nassert abs(Decimal(r["calculation"]["nominal_apr"])-Decimal("0.36739117")) < Decimal("0.00000001")\nassert r["calculation"]["cashflows"][0]["amount"]=="18871"\nprint("confirmed")'],
  { input: JSON.stringify(extracted), encoding: 'utf8' });
  assert.equal(process.status, 0, process.stderr || process.error?.message || 'Python process did not complete');
  assert.match(process.stdout, /confirmed/);
});
