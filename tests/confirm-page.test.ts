import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMoneyText, parsePercentText, percentDraft } from '../frontend/src/lib/money-input.ts';
import { booleanFact, feeBlockers, feeGaps, feeVerdict, routeQuestion, setBooleanFact } from '../frontend/src/lib/fee-decision.ts';
import type { CaseFacts } from '../src/domain.ts';

const s2 = (): CaseFacts => ({
  borrower: { is_student: false, purpose: '日常消费' },
  lender: { name: '某示例银行', type: 'bank', licensed: null, internet_consumer_loan: null, internet_assisted: null },
  loan: { principal: '10000', disbursed: '10000', term_periods: 12, periods_per_year: 12, repay_method: 'equal_installment', period_payment: '888.49', nominal_apr: '0.12', start_date: '2026-09-01' },
  repayments: [],
  fees: [{ id: 'f1', name: '分期服务费', amount: '50', timing: 'per_period', period: null, payee: '某平台', payee_type: 'platform', in_disclosure: false, included_in_cashflows: null, included_in_disclosed_cost: false, contingent: false }],
  disclosure: { present: true, quoted_apr: '0.12', quoted_method: 'nominal', items_complete: true, contingent_disclosed: null },
  funds_to: 'borrower',
  marketing_phrases: [],
});

test('money and rate drafts accept what people paste and never invent a number', () => {
  assert.equal(parseMoneyText('10,000'), '10000');
  assert.equal(parseMoneyText('1.2万'), '12000');
  assert.equal(parseMoneyText('￥888.49'), '888.49');
  assert.equal(parseMoneyText('10000元'), '10000');
  assert.equal(parseMoneyText('abc'), null);
  assert.equal(parseMoneyText(''), null);
  assert.equal(parsePercentText('12%'), '0.12');
  assert.equal(parsePercentText('12.5'), '0.125');
  assert.equal(parsePercentText('一二'), null);
  assert.equal(percentDraft('1.111266'), '111.1266');
  assert.equal(percentDraft(null), '');
});

test('fee gaps name the exact missing item instead of letting the backend answer MISSING_FIELDS', () => {
  const facts = s2();
  const gaps = feeGaps(facts);
  assert.equal(gaps.length, 1);
  assert.match(gaps[0]!, /「分期服务费」还没选/);
  facts.fees[0]!.included_in_cashflows = false;
  assert.deepEqual(feeGaps(facts), []);
  facts.fees[0]!.amount = null;
  assert.match(feeGaps(facts)[0]!, /还差金额/);
  facts.fees[0]!.amount = '50';
  facts.fees[0]!.timing = 'specific_period';
  assert.match(feeGaps(facts).find(item => /收取期数/.test(item))!, /收取期数/);
  facts.fees[0]!.contingent = null;
  assert.match(feeGaps(facts)[0]!, /违约/);
});

test('unknown answers stay submittable; only a completely empty fee blocks', () => {
  const unknown = s2();
  assert.deepEqual(feeBlockers(unknown), []);
  assert.equal(feeGaps(unknown).length, 1);

  const blank = s2();
  blank.fees = [{ id: 'blank', name: '待确认费用', amount: null, timing: 'unknown', period: null, payee: null, payee_type: 'unknown', in_disclosure: null, included_in_cashflows: null, included_in_disclosed_cost: null, contingent: false }];
  assert.match(feeBlockers(blank)[0]!, /第 1 项费用还没填任何内容/);
  assert.deepEqual(feeGaps(blank), []);

  const duplicated = s2();
  duplicated.fees.push({ ...duplicated.fees[0]! });
  assert.match(feeBlockers(duplicated)[0]!, /同一个编号/);
});

test('the fee sentence compares against the amount the reader is looking at', () => {
  const facts = s2();
  facts.fees[0]!.included_in_cashflows = false;
  const extra = feeVerdict(facts.fees[0]!, facts);
  assert.match(extra.sentence, /这笔钱另收/);
  assert.match(extra.sentence, /每期还款额 888\.49 元/);
  facts.fees[0]!.included_in_cashflows = true;
  assert.match(feeVerdict(facts.fees[0]!, facts).sentence, /已经算在/);
  facts.fees[0]!.timing = 'upfront';
  facts.fees[0]!.included_in_cashflows = false;
  assert.match(feeVerdict(facts.fees[0]!, facts).sentence, /实际到账额 10,000\.00 元/);
  facts.fees[0]!.contingent = true;
  assert.match(feeVerdict(facts.fees[0]!, facts).sentence, /不参与年化/);
});

test('questions with a source quote are checked against the source, not asked back', () => {
  const evidence = [{ id: 'e1', field: 'lender.licensed', document_id: 'd1', page: 2, quote: '许可证编号' }];
  assert.equal(routeQuestion('lender.licensed', evidence).kind, 'self-check');
  assert.equal(routeQuestion('facts.lender.licensed', evidence).kind, 'self-check');
  assert.equal(routeQuestion('lender.licensed', []).kind, 'boolean');
  assert.equal(routeQuestion('disclosure.quoted_apr', []).kind, 'note');
  const facts = s2();
  assert.equal(booleanFact(facts, 'lender.licensed'), null);
  assert.equal(setBooleanFact(facts, 'lender.licensed', true).lender.licensed, true);
  assert.equal(setBooleanFact(facts, 'disclosure.quoted_method', true), facts);
});
