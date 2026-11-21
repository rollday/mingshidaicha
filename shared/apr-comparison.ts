import type { AprComparison } from '../src/domain.ts';

export const unavailableComparisonLabels = {
  missing_disclosed_apr: '材料未提供可比较的综合融资成本年化',
  unconfirmed_disclosed_method: '披露年化的计算口径待确认',
  unsupported_cashflow_for_method: '当前现金流未能按披露口径重算',
};

export function comparisonStatus(comparison: AprComparison | undefined): NonNullable<AprComparison['status']> {
  if (!comparison || comparison.status === 'unavailable' || comparison.method_basis === 'unavailable' ||
      comparison.quoted_apr == null || comparison.computed_apr == null || comparison.gap_pp == null ||
      typeof comparison.exceeds_tolerance !== 'boolean') return 'unavailable';
  return comparison.status === 'provisional' || comparison.method_basis === 'assumed_simple' ? 'provisional' : 'complete';
}
