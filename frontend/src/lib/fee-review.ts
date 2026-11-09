import type { CaseFacts, Evidence, Correction } from '../types/audit.ts';
import type { FeePrefill } from '../../../shared/fee-prefill.ts';

type Fee = CaseFacts['fees'][number];
/** Display priority follows unresolved cash-flow inputs, keeping source order on ties. */
export function feeNeedsAprReview(fee: Fee): boolean {
  return fee.contingent !== true && (fee.contingent === null || fee.included_in_cashflows === null ||
    fee.amount === null || fee.timing === 'unknown' || (fee.timing === 'specific_period' && fee.period === null));
}
export function feeEvidence(feeId: string, source: CaseFacts, evidence: Evidence[]): Evidence[] {
  const index = source.fees.findIndex(fee => fee.id === feeId);
  if (index < 0) return [];
  return evidence.filter(item => {
    const field = item.field.replace(/^facts\./, '');
    return field.startsWith(`fees[${index}].`) || field.startsWith(`fees.${index}.`);
  });
}
export function prefillBasis(facts: CaseFacts, feeId: string): string {
  const fee = facts.fees.find(item => item.id === feeId);
  return JSON.stringify([facts.loan.disbursed, facts.loan.principal, facts.loan.period_payment, facts.loan.repay_method, facts.loan.nominal_apr, facts.loan.term_periods, facts.loan.periods_per_year,
    facts.repayments, facts.fees.map(item => [item.id,item.amount,item.timing,item.period,item.name,item.contingent]), fee?.name]);
}
/** Clear automatic assertions when their monetary basis changes; retain explicit edits. */
export function invalidateFeePrefills(before: CaseFacts, after: CaseFacts, prefills: FeePrefill[], edited: Set<string>): CaseFacts {
  return { ...after, fees: after.fees.map(fee => {
    const automatic = prefills.find(item => item.fee_id === fee.id);
    const previous = before.fees.find(item => item.id === fee.id);
    return automatic && !edited.has(fee.id) && previous?.included_in_cashflows === automatic.value &&
      fee.included_in_cashflows === automatic.value && prefillBasis(before,fee.id) !== prefillBasis(after,fee.id)
      ? { ...fee, included_in_cashflows: null } : fee;
  }) };
}

/** An explicit empty server list distinguishes adopted suggestions from manual edits. */
export function manualFeeEdits(current: { facts: CaseFacts; manual_fee_ids?: string[]; corrections: Correction[] }): Set<string> {
  if (current.manual_fee_ids !== undefined) return new Set(current.manual_fee_ids);
  return new Set(current.corrections.flatMap(item => {
    const match = /^fees\[(\d+)\]\.included_in_cashflows$/.exec(item.field);
    if (!match) return [];
    const feeId = item.fee_id ?? current.facts.fees[Number(match[1])]?.id;
    return feeId && current.facts.fees.some(fee => fee.id === feeId) ? [feeId] : [];
  }));
}
