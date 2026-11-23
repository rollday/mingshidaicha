import type { AprComparison } from '../src/domain.ts';

export const unavailableComparisonLabels = {
  missing_disclosed_apr: '材料未提供可比较的综合融资成本年化',
  unconfirmed_disclosed_method: '披露年化的计算口径待确认',
  unsupported_cashflow_for_method: '当前现金流未能按披露口径重算',
};

/** A disclosed label the cash flows cannot support under that convention.
 * This is a labeling inconsistency clue, not a rate-error verdict: the writer
 * may cite the alternative rates as references, never as a confirmed gap. */
export function unsupportedDisclosureHint(comparison: {
  unavailable_reason?: string | null; quoted_apr?: string | null;
  nominal_apr?: string | null; effective_apr?: string | null; xirr_apr?: string | null;
}): string | null {
  if (comparison.unavailable_reason !== 'unsupported_cashflow_for_method' || comparison.quoted_apr == null) return null;
  const alternatives = [
    comparison.nominal_apr != null ? '名义年化' : null,
    comparison.effective_apr != null ? '复利年化' : null,
    comparison.xirr_apr != null ? '按实际日期年化' : null,
  ].filter(Boolean).join('、');
  if (!alternatives) return null;
  return `披露口径标注与可重算口径不一致：材料按所标口径无法用当前现金流重算，但${alternatives}可以重算，披露数值可能对应其中另一种口径；请核对披露口径标注，不能据此直接认定利率标错。`;
}

export function comparisonStatus(comparison: AprComparison | undefined): NonNullable<AprComparison['status']> {
  if (!comparison || comparison.status === 'unavailable' || comparison.method_basis === 'unavailable' ||
      comparison.quoted_apr == null || comparison.computed_apr == null || comparison.gap_pp == null ||
      typeof comparison.exceeds_tolerance !== 'boolean') return 'unavailable';
  return comparison.status === 'provisional' || comparison.method_basis === 'assumed_simple' ? 'provisional' : 'complete';
}
