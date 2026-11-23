/** Deterministic fee-total arithmetic from confirmed facts, used only when the
 * reconciled ledger is unavailable. Never estimates unknown amounts or terms. */
export type FeeTotalEstimate = { total: string; basis: string };

export function estimateFeeTotal(
  fee: { amount: string | null; timing: string; contingent: boolean | null },
  termPeriods: number | null,
): FeeTotalEstimate | null {
  if (fee.contingent !== false || fee.amount === null || !/^\d+(?:\.\d+)?$/.test(fee.amount)) return null;
  if (fee.timing === 'upfront' || fee.timing === 'at_maturity') {
    return { total: fee.amount, basis: '单次收取，未完成对账' };
  }
  if (fee.timing !== 'per_period' || termPeriods === null || !Number.isInteger(termPeriods) || termPeriods < 1 || termPeriods > 600) return null;
  const [whole = '0', fraction = ''] = fee.amount.split('.');
  const digits = BigInt(whole + fraction) * BigInt(termPeriods);
  const places = fraction.length;
  const text = digits.toString().padStart(places + 1, '0');
  const total = places ? text.slice(0, -places) + '.' + text.slice(-places) : text;
  return { total, basis: `${termPeriods} 期 × 单次金额，未完成对账` };
}
