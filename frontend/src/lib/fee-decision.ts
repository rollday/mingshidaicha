import type { CaseFacts, Evidence } from '../types/audit.ts';
import type { FeePrefill } from '../../../shared/fee-prefill.ts';
import { money } from './format.ts';

type Fee = CaseFacts['fees'][number];

/** Which amount the reader is being asked to compare the fee against. */
export function feeBasis(facts: CaseFacts, fee: Fee): string {
  if (fee.timing === 'upfront' || (fee.timing === 'specific_period' && fee.period === 0)) {
    return facts.loan.disbursed === null ? '所填实际到账额' : `实际到账额 ${money(facts.loan.disbursed)}`;
  }
  if (facts.loan.repay_method === 'schedule' || facts.repayments.length > 0) return '所填还款计划';
  return facts.loan.period_payment === null ? '所填每期还款额' : `每期还款额 ${money(facts.loan.period_payment)}`;
}

export type FeeVerdict = { tone: 'included' | 'extra' | 'unknown'; sentence: string; detail: string };

/** The agent states what the contract says; the reader only corrects it. */
export function feeVerdict(fee: Fee, facts: CaseFacts, suggestion?: FeePrefill): FeeVerdict {
  const basis = feeBasis(facts, fee);
  if (fee.contingent === true) {
    return { tone: 'included', sentence: '这笔只在逾期、违约等情况下才产生，不参与年化计算。', detail: '不算进正常还款，保留在报告里说明即可。' };
  }
  if (fee.included_in_cashflows === true) {
    return { tone: 'included', sentence: `这笔钱已经算在${basis}里了。`, detail: '不用再单加；改动金额会重算真实年化。' };
  }
  if (fee.included_in_cashflows === false) {
    return { tone: 'extra', sentence: `这笔钱另收，不算在${basis}里。`, detail: '会加进真实年化；改动金额会重算。' };
  }
  if (suggestion) {
    return { tone: 'unknown', sentence: `合同写了这项收费，但没写清算不算在${basis}里。`, detail: suggestion.reason };
  }
  return { tone: 'unknown', sentence: `材料没写清这笔钱算不算在${basis}里。`, detail: '在合同或明示表里找“另收”“一并扣收”“已包含”，找不到就留“不清楚”，报告会写明这一项没核实。' };
}

/** Only entries that are entirely empty or would break the request are blocked. */
export function feeBlockers(facts: CaseFacts): string[] {
  const blockers: string[] = [];
  const counts = new Map<string, number>();
  facts.fees.forEach((fee, index) => {
    counts.set(fee.id, (counts.get(fee.id) ?? 0) + 1);
    const unnamed = !fee.name.trim() || fee.name.trim() === '待确认费用';
    if (unnamed && fee.amount === null && fee.timing === 'unknown') blockers.push(`第 ${index + 1} 项费用还没填任何内容，补上或删掉它。`);
  });
  for (const count of counts.values()) if (count > 1) blockers.push('有两项费用用了同一个编号，删掉重复的那一项。');
  return blockers;
}

/** Remaining unknowns are submitted as-is; the report states them. */
export function feeGaps(facts: CaseFacts): string[] {
  const gaps: string[] = [];
  facts.fees.forEach((fee, index) => {
    const name = fee.name.trim();
    const label = name && name !== '待确认费用' ? `「${name}」` : `第 ${index + 1} 项费用`;
    if ((!name || name === '待确认费用') && fee.amount === null && fee.timing === 'unknown') return;
    if (fee.contingent === null) { gaps.push(`${label}还没选“是否只在违约等情况下产生”。`); return; }
    if (fee.contingent) return;
    if (fee.amount === null) gaps.push(`${label}还差金额。`);
    if (!['upfront', 'per_period', 'at_maturity', 'specific_period'].includes(fee.timing)) gaps.push(`${label}还差收费时间。`);
    if (fee.included_in_cashflows === null) gaps.push(`${label}还没选“算在里面还是另收”。`);
    if (fee.timing === 'specific_period' && fee.period === null) gaps.push(`${label}还差收取期数。`);
  });
  if (facts.loan.repay_method === 'schedule' && facts.repayments.length === 0) gaps.push('还款方式选了“按明确还款计划”，但没有填还款计划明细。');
  return gaps;
}

const BOOLEAN_QUESTIONS: Record<string, true> = {
  'lender.licensed': true, 'lender.internet_consumer_loan': true, 'lender.internet_assisted': true,
  'borrower.is_student': true, 'disclosure.present': true, 'disclosure.items_complete': true,
  'disclosure.contingent_disclosed': true,
};

export type QuestionRoute = { kind: 'boolean' | 'self-check' | 'note'; evidence?: Evidence };

/** Anything the materials can answer is checked against the source, not asked back. */
export function routeQuestion(field: string, evidence: Evidence[]): QuestionRoute {
  const name = field.replace(/^facts\./, '');
  const hit = evidence.find(item => {
    const itemField = item.field.replace(/^facts\./, '');
    return itemField === name || itemField.startsWith(`${name}.`) || name.startsWith(`${itemField}.`) || itemField.startsWith(`${name}[`);
  });
  if (hit) return { kind: 'self-check', evidence: hit };
  if (BOOLEAN_QUESTIONS[name]) return { kind: 'boolean' };
  return { kind: 'note' };
}

export function booleanFact(facts: CaseFacts, field: string): boolean | null {
  switch (field.replace(/^facts\./, '')) {
    case 'lender.licensed': return facts.lender.licensed;
    case 'lender.internet_consumer_loan': return facts.lender.internet_consumer_loan;
    case 'lender.internet_assisted': return facts.lender.internet_assisted;
    case 'borrower.is_student': return facts.borrower.is_student;
    case 'disclosure.present': return facts.disclosure.present;
    case 'disclosure.items_complete': return facts.disclosure.items_complete;
    case 'disclosure.contingent_disclosed': return facts.disclosure.contingent_disclosed;
    default: return null;
  }
}

export function setBooleanFact(facts: CaseFacts, field: string, value: boolean | null): CaseFacts {
  switch (field.replace(/^facts\./, '')) {
    case 'lender.licensed': return { ...facts, lender: { ...facts.lender, licensed: value } };
    case 'lender.internet_consumer_loan': return { ...facts, lender: { ...facts.lender, internet_consumer_loan: value } };
    case 'lender.internet_assisted': return { ...facts, lender: { ...facts.lender, internet_assisted: value } };
    case 'borrower.is_student': return { ...facts, borrower: { ...facts.borrower, is_student: value } };
    case 'disclosure.present': return { ...facts, disclosure: { ...facts.disclosure, present: value } };
    case 'disclosure.items_complete': return { ...facts, disclosure: { ...facts.disclosure, items_complete: value } };
    case 'disclosure.contingent_disclosed': return { ...facts, disclosure: { ...facts.disclosure, contingent_disclosed: value } };
    default: return facts;
  }
}
