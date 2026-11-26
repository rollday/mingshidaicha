import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  contractPrincipal,
  describeCorrectionObject,
  evidenceForFields,
  feeDisplayTotal,
  feeTotalView,
  includedFeePhrase,
  isUndisclosedIncludedFee,
  isUndisclosedSeparateFee,
  periodPaymentView,
  receivedAmount,
  undisclosedIncludedFees,
  undisclosedSeparateFees,
  undisclosedSeparateTotal,
} from '../frontend/src/lib/report-display.ts';

const fee = (overrides: Record<string, unknown> = {}) => ({
  id: 'f1', name: '服务费', amount: '80', timing: 'per_period', period: null,
  payee: null, payee_type: 'unknown', in_disclosure: false, included_in_cashflows: false,
  included_in_disclosed_cost: false, contingent: false, ...overrides,
}) as any;

const facts = (overrides: Record<string, unknown> = {}) => ({
  borrower: {}, lender: {}, loan: {
    principal: '10000', disbursed: null, term_periods: 12, periods_per_year: 12,
    repay_method: 'equal_installment', period_payment: '900', nominal_apr: '0.12', start_date: null,
  },
  repayments: [], fees: [], disclosure: {}, funds_to: 'borrower', marketing_phrases: [],
  ...overrides,
}) as any;

test('表外且另付只收未披露且未并入还款的正常费用', () => {
  const separate = fee();
  const included = fee({ id: 'f2', included_in_cashflows: true });
  const contingent = fee({ id: 'f3', contingent: true });
  assert.equal(isUndisclosedSeparateFee(separate), true);
  assert.equal(isUndisclosedSeparateFee(included), false);
  assert.equal(isUndisclosedSeparateFee(contingent), false);
  assert.equal(isUndisclosedIncludedFee(included), true);
  assert.deepEqual(undisclosedSeparateFees([separate, included, contingent]).map((item) => item.id), ['f1']);
  assert.deepEqual(undisclosedIncludedFees([separate, included]).map((item) => item.id), ['f2']);
  assert.equal(undisclosedSeparateTotal([separate, included], new Map([['f1', { total: '960' }]]), 12), '960');
  assert.equal(undisclosedSeparateTotal([included], new Map(), 12), null);
});

test('每期实付只在固定每期且金额全已知时成立', () => {
  assert.deepEqual(periodPaymentView(facts()), {
    kind: 'fixed', amount: '900', label: '每月',
    note: '按合同固定每期还款展示，不再把首期当成所有期次。',
  });

  const equalPrincipal = facts({
    repayments: [{ amount: '1000', period: 1 }],
    loan: { ...facts().loan, repay_method: 'equal_principal', period_payment: '900' },
  });
  assert.deepEqual(periodPaymentView(equalPrincipal), {
    kind: 'first', amount: '1000', label: '首笔还款',
    note: '只代表材料里的第一笔；还款方式不是固定每期，后续每期以还款计划为准。',
  });

  const equalPrincipalNoSchedule = facts({
    loan: { ...facts().loan, repay_method: 'equal_principal', period_payment: '900' },
  });
  assert.deepEqual(periodPaymentView(equalPrincipalNoSchedule), {
    kind: 'first', amount: '900', label: '每期约定',
    note: '合同写的是每期还本息；还款方式不是固定每期，这个金额不代表实际首笔或所有期次。',
  });

  const unknownFee = facts({ fees: [fee({ included_in_cashflows: null })] });
  assert.deepEqual(periodPaymentView(unknownFee), {
    kind: 'contract-pending', amount: '900', label: '每月约定',
    note: '有费用金额或计入方式待确认，暂不计算每期实付合计。',
  });

  const firstOnly = facts({
    repayments: [{ amount: '1000', period: 1 }],
    loan: { ...facts().loan, period_payment: null, repay_method: 'schedule' },
  });
  assert.deepEqual(periodPaymentView(firstOnly), {
    kind: 'first', amount: '1000', label: '首笔还款（材料中的第一笔）',
    note: '材料里的第一笔不能代表所有期次。',
  });

  const none = facts({ loan: { ...facts().loan, period_payment: null }, repayments: [] });
  assert.deepEqual(periodPaymentView(none), {
    kind: 'none', amount: null, label: '每月', note: '材料未提供可展示的每期还款金额。',
  });
});

test('到手只认实际到账，合同本金单独保留', () => {
  assert.equal(receivedAmount({ disbursed: '9500', principal: '10000' }, { principal: '10000', disbursed: '9000' } as any), '9500');
  assert.equal(receivedAmount(null, { principal: '10000', disbursed: null } as any), null);
  assert.equal(contractPrincipal({ disbursed: '9500', principal: '10000' }, { principal: '10000', disbursed: '9000' } as any), '10000');
  assert.equal(contractPrincipal(null, { principal: '10000', disbursed: null } as any), '10000');
});

test('逐项依据按字段匹配，不共用整表状态', () => {
  const evidence = [
    { id: 'e1', field: 'facts.fees[0].in_disclosure', document_id: 'd', page: 1, quote: '服务费未列入明示表。' },
    { id: 'e2', field: 'disclosure.present', document_id: 'd', page: 2, quote: '已提供明示表。' },
  ];
  assert.deepEqual(evidenceForFields(evidence as any, ['fees[0].in_disclosure']).map((item) => item.id), ['e1']);
  assert.deepEqual(evidenceForFields(evidence as any, ['disclosure.present']).map((item) => item.id), ['e2']);
  assert.deepEqual(evidenceForFields(evidence as any, ['fees[1].in_disclosure']), []);
});

test('更正记录补齐费用计入方式和还款日期', () => {
   const feeText = describeCorrectionObject({ name: '服务费', amount: '80', included_in_cashflows: true }, 'fees[0]');
   assert.match(feeText, /是否已含在到账或还款额中 是/);
   assert.match(feeText, /金额 80\.00 元/);
   assert.doesNotMatch(feeText, /id|JSON/);

   const repaymentText = describeCorrectionObject({ amount: '900', date: '2026-01-01' }, 'repayments[0]');
   assert.match(repaymentText, /还款金额 900\.00 元/);
   assert.match(repaymentText, /还款日期 2026-01-01/);
   assert.doesNotMatch(repaymentText, /id|JSON/);
});

test('收费周期未知时核算合计不拿单次金额顶替', () => {
  const unknownTiming = fee({ timing: 'unknown', amount: '100' });
  assert.equal(feeTotalView(unknownTiming, new Map(), 12).total, null);
  assert.equal(feeDisplayTotal(unknownTiming, new Map(), 12), null);
  assert.equal(undisclosedSeparateTotal([unknownTiming], new Map(), 12), null);

  const upfront = fee({ id: 'f2', timing: 'upfront', amount: '600' });
  assert.deepEqual(feeTotalView(upfront, new Map(), 12), { total: '600', basis: '单次收取，未完成对账' });
  const perPeriod = fee({ id: 'f3', timing: 'per_period', amount: '80' });
  assert.deepEqual(feeTotalView(perPeriod, new Map(), 12), { total: '960', basis: '12 期 × 单次金额，未完成对账' });

  assert.deepEqual(feeTotalView(unknownTiming, new Map([['f1', { total: '500' }]]), 12), { total: '500', basis: null });
});

test('未披露且已计入的费用按实际计入位置描述', () => {
  assert.equal(includedFeePhrase(fee({ timing: 'upfront', included_in_cashflows: true })), '已经从实际到账里扣掉');
  assert.equal(includedFeePhrase(fee({ timing: 'per_period', included_in_cashflows: true })), '已经并入还款额');
  assert.equal(includedFeePhrase(fee({ timing: 'at_maturity', included_in_cashflows: true })), '已经并入还款额');
});
