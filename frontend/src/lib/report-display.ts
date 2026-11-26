import type { AuditReport, CaseFacts, Evidence } from '../types/audit.ts';
import { decimalSum, money } from './format.ts';
import { estimateFeeTotal } from '../../../shared/fee-total.ts';

export type ReportFee = CaseFacts['fees'][number];
type Summary = NonNullable<AuditReport['calculation']>['summary'];
type FeeTotalLookup = ReadonlyMap<string, { total: string }>;

/** 表外 = 未列入明示表；另付 = 未并入到账或还款额。只有两者同时成立才是「表外且另付」。 */
export function isUndisclosedSeparateFee(fee: ReportFee): boolean {
  return fee.contingent === false && fee.in_disclosure === false && fee.included_in_cashflows === false;
}

/** 未列入明示表、但已经并入到账或还款额的费用；不能叫多收，也不能再重复计入另付。 */
export function isUndisclosedIncludedFee(fee: ReportFee): boolean {
  return fee.contingent === false && fee.in_disclosure === false && fee.included_in_cashflows === true;
}

export function undisclosedSeparateFees(fees: readonly ReportFee[]): ReportFee[] {
  return fees.filter(isUndisclosedSeparateFee);
}

export function undisclosedIncludedFees(fees: readonly ReportFee[]): ReportFee[] {
  return fees.filter(isUndisclosedIncludedFee);
}

/** 单笔费用的展示合计：只认已对账合计或可解释的估算；次数无法确定时不把单次金额当合计。 */
export function feeTotalView(
  fee: ReportFee,
  totals: FeeTotalLookup,
  termPeriods: number | null,
): { total: string | null; basis: string | null } {
  const total = totals.get(fee.id)?.total;
  if (total) return { total, basis: null };
  const estimate = estimateFeeTotal(fee, termPeriods);
  if (!estimate) return { total: null, basis: null };
  return { total: estimate.total, basis: estimate.basis };
}

/** 未披露但已计入的费用，按其实际计入位置描述；放款时收取的是从到账里扣，不是并入还款额。 */
export function includedFeePlacement(fee: ReportFee): 'disbursement' | 'repayment' {
  return fee.timing === 'upfront' ? 'disbursement' : 'repayment';
}

export function includedFeePhrase(fee: ReportFee): string {
  return includedFeePlacement(fee) === 'disbursement' ? '已经从实际到账里扣掉' : '已经并入还款额';
}

export function feeDisplayTotal(
  fee: ReportFee,
  totals: FeeTotalLookup,
  termPeriods: number | null,
): string | null {
  return feeTotalView(fee, totals, termPeriods).total;
}

/** 只汇总「表外且另付」的正常费用；未披露但已并入还款的费用不重复算。 */
export function undisclosedSeparateTotal(
  fees: readonly ReportFee[],
  totals: FeeTotalLookup,
  termPeriods: number | null,
): string | null {
  return decimalSum(undisclosedSeparateFees(fees).map((fee) => feeDisplayTotal(fee, totals, termPeriods)));
}

/** 只有到账金额才能叫「到手」；合同本金单独展示，不得兜底。 */
type SummaryAmounts = Pick<Summary, 'disbursed' | 'principal'>;

export function receivedAmount(summary: SummaryAmounts | null | undefined, loan: CaseFacts['loan']): string | null {
  return summary?.disbursed ?? loan.disbursed ?? null;
}

export function contractPrincipal(summary: SummaryAmounts | null | undefined, loan: CaseFacts['loan']): string | null {
  return loan.principal ?? summary?.principal ?? null;
}

/** 费用金额或是否并入还款未知时，不能给出确定的「每期实付」合计。 */
export function hasUnknownFeeAmount(fees: readonly ReportFee[]): boolean {
  return fees.some((fee) =>
    fee.contingent === null
    || (fee.contingent === false && (fee.included_in_cashflows === null || fee.amount === null)),
  );
}

export type PeriodPaymentView = {
  kind: 'fixed' | 'first' | 'contract-pending' | 'none';
  amount: string | null;
  label: string;
  note: string;
};

/** 固定每期、金额全已知才显示「每期实付」；其他情况最多展示首笔约定/首笔材料金额。 */
export function periodPaymentView(facts: CaseFacts): PeriodPaymentView {
  const payment = facts.loan.period_payment;
  const periodLabel = facts.loan.periods_per_year === 12 ? '每月' : '每期';
  const unknownFee = hasUnknownFeeAmount(facts.fees);

  if (payment !== null && facts.loan.repay_method === 'equal_installment') {
    if (!unknownFee) {
      return { kind: 'fixed', amount: payment, label: periodLabel, note: '按合同固定每期还款展示，不再把首期当成所有期次。' };
    }
    return { kind: 'contract-pending', amount: payment, label: `${periodLabel}约定`, note: '有费用金额或计入方式待确认，暂不计算每期实付合计。' };
  }

  if (payment !== null) {
    const first = facts.repayments[0]?.amount ?? null;
    if (first !== null) {
      return { kind: 'first', amount: first, label: '首笔还款', note: '只代表材料里的第一笔；还款方式不是固定每期，后续每期以还款计划为准。' };
    }
    return { kind: 'first', amount: payment, label: '每期约定', note: '合同写的是每期还本息；还款方式不是固定每期，这个金额不代表实际首笔或所有期次。' };
  }

  const first = facts.repayments[0]?.amount ?? null;
  if (first !== null) {
    return { kind: 'first', amount: first, label: '首笔还款（材料中的第一笔）', note: '材料里的第一笔不能代表所有期次。' };
  }

  return { kind: 'none', amount: null, label: periodLabel, note: '材料未提供可展示的每期还款金额。' };
}

/** 按字段名匹配原文依据，兼容 evidence.field 带 facts. 前缀。 */
export function evidenceForFields(evidence: readonly Evidence[], fields: readonly string[]): Evidence[] {
  const normalized = fields.map((field) => field.replace(/^facts\./, ''));
  return evidence.filter((item) => {
    const field = item.field.replace(/^facts\./, '');
    return normalized.some((candidate) => field === candidate || field.startsWith(`${candidate}.`));
  });
}

const valueLabels: Record<string, string> = {
  bank: '银行', consumer_finance: '消费金融公司', microloan: '小额贷款公司', platform: '平台', other: '其他',
  equal_installment: '等额本息', equal_principal: '等额本金', interest_only: '先息后本', bullet: '到期一次还本付息', schedule: '按还款计划',
  nominal: '名义年化', effective: '实际年化', simple: '单利', xirr: 'XIRR',
  upfront: '放款时收取', per_period: '每期收取', at_maturity: '到期收取', specific_period: '指定期收取',
  borrower: '借款人', training_provider: '培训机构', third_party: '第三方', unknown: '待确认',
};

const feeFieldLabels: Record<string, string> = {
  name: '名称', amount: '金额', timing: '发生时间', payee: '收取主体', payee_type: '收取主体类型',
  in_disclosure: '列在明示表', included_in_cashflows: '是否已含在到账或还款额中',
  included_in_disclosed_cost: '计入明示年化', contingent: '或有费用', period: '指定期次',
};

const repaymentFieldLabels: Record<string, string> = {
  amount: '还款金额', date: '还款日期', period: '期次',
};

/** 更正记录里的对象按费用/还款字段展示，不输出 id 和原始 JSON。 */
export function describeCorrectionObject(value: Record<string, unknown>, field: string): string {
  const labels = field.startsWith('repayments') ? repaymentFieldLabels : feeFieldLabels;
  const pairs = Object.entries(labels)
    .filter(([key]) => key in value && value[key] !== null && value[key] !== undefined)
    .map(([key, label]) => {
      const item = value[key];
      const shown = typeof item === 'boolean'
        ? (item ? '是' : '否')
        : typeof item === 'string'
          ? (valueLabels[item] ?? (/^(?:-?\d+(?:\.\d+)?)$/.test(item) && /amount|principal|disbursed|payment/i.test(key) ? money(item) : item))
          : String(item);
      return `${label} ${shown}`;
    });
  return pairs.length ? pairs.join('；') : '待确认';
}
