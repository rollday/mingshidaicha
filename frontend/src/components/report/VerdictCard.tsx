import type { AuditReport } from '../../types/audit.ts';
import { comparisonStatus, unavailableComparisonLabels, unsupportedDisclosureHint } from '../../../../shared/apr-comparison.ts';
import { decimal, methodNames, money, percent } from '../../lib/format.ts';
import { Card, Tag, type Tone } from '../base/index.tsx';

const levelTone: Record<AuditReport['conclusion']['level'], Tone> = {
  red: 'red',
  yellow: 'amber',
  blue: 'blue',
};

export function VerdictCard({ report }: { report: AuditReport }) {
  const rates = report.calculation?.calculation;
  const comparison = rates?.comparison;
  const status = comparisonStatus(comparison);
  const canCompare = comparison !== undefined && status !== 'unavailable';
  const methodLabel = methodNames[comparison?.method ?? 'unknown'];
  const recomputed = canCompare ? comparison.computed_apr : rates?.nominal_apr ?? rates?.xirr_apr;
  const recomputedLabel = canCompare ? methodLabel : rates?.nominal_apr != null ? '名义年化' : '按实际日期年化';
  const reason = comparison?.unavailable_reason ??
    (comparison?.quoted_apr == null ? 'missing_disclosed_apr' : comparison.method_basis === 'unavailable' ? 'unconfirmed_disclosed_method' : null);
  const { confirmed_issues, pending_checks, advisory_hints } = report.conclusion.counts;
  const conclusionTone = levelTone[report.conclusion.level];
  const tone = confirmed_issues === 0 && pending_checks > 0 ? 'amber' : conclusionTone;
  const heading = canCompare
    ? `明示年化 ${percent(comparison.quoted_apr)}，按材料重算约 ${percent(comparison.computed_apr)}`
    : recomputed != null
    ? `按材料重算约 ${percent(recomputed)}（${recomputedLabel}）`
    : confirmed_issues > 0
    ? '本次核查有已确认命中'
    : pending_checks > 0
      ? '本次核查有待核实项目'
      : '本次核查摘要';
  const feeTotals = new Map((report.calculation?.fee_totals ?? []).map((item) => [item.id, item]));
  const confirmedSeparateUndisclosedFees = report.facts.fees.filter((fee) =>
    fee.in_disclosure === false && fee.included_in_cashflows === false && fee.contingent === false,
  );
  const feeStatusPending = report.facts.fees.filter((fee) =>
    fee.in_disclosure === null || fee.included_in_cashflows === null,
  ).length;

  return (
    <Card padding="none" className="relative overflow-hidden p-4 sm:p-7">
      <div className={`absolute inset-y-0 left-0 w-1 ${tone === 'red' ? 'bg-red' : tone === 'amber' ? 'bg-amber' : 'bg-blue'}`} />
      <div className="flex flex-col gap-3 pl-2">
        <div className="flex flex-wrap items-center gap-2">
          {confirmed_issues > 0 ? <Tag tone={conclusionTone}>已确认命中 {confirmed_issues} 条</Tag> : null}
          {pending_checks > 0 ? <Tag tone="amber">待核实 {pending_checks} 条</Tag> : null}
          {advisory_hints > 0 ? <Tag tone="blue">阅读提示 {advisory_hints} 条</Tag> : null}
          {report.conclusion.partial ? <Tag tone="blue">计算未完成</Tag> : null}
          {report.conclusion.information_incomplete && pending_checks === 0 ? <Tag tone="blue">信息待补充</Tag> : null}
        </div>
        <h2 className="font-serif text-lg font-medium leading-snug">{heading}</h2>
        {canCompare ? (
          <p className="text-2xs text-mute">
            {status === 'provisional' ? '按单利推定，披露口径待确认' : methodLabel}。差额 {decimal(comparison.gap_pp)} 个百分点，{comparison.exceeds_tolerance ? '超过' : '未超过'}比较容差。
          </p>
        ) : rates ? (
          <p className="text-2xs text-mute">未完成同口径比较。{reason ? unavailableComparisonLabels[reason] : '缺少完整比较结果'}。</p>
        ) : null}
        {comparison && rates && unsupportedDisclosureHint({ ...comparison, nominal_apr: rates.nominal_apr, effective_apr: rates.effective_apr, xirr_apr: rates.xirr_apr }) ? (
          <p className="text-sm text-amber">披露口径标注可能有误：按所标口径无法重算，但
            {rates.nominal_apr != null ? `名义年化约 ${percent(rates.nominal_apr)}` : ''}
            {rates.nominal_apr != null && rates.effective_apr != null ? '、' : ''}
            {rates.effective_apr != null ? `复利年化约 ${percent(rates.effective_apr)}` : ''}
            {rates.xirr_apr != null ? `按实际日期年化约 ${percent(rates.xirr_apr)}` : ''}
            可以重算。披露数值可能对应其中另一种口径，请核对标注；这不是利率标错的认定。</p>
        ) : null}
        {!report.calculation ? <p className="text-sm text-mute">借款成本与重算年化暂不可用。</p> : null}
        {confirmedSeparateUndisclosedFees.length ? (
          <p className="text-sm text-ink-soft">未列明且另付：{confirmedSeparateUndisclosedFees.slice(0, 2).map((fee) => {
            const total = feeTotals.get(fee.id)?.total;
            return `${fee.name}${total === undefined ? '（金额待核算）' : ` ${money(total)}`}`;
          }).join('、')}{confirmedSeparateUndisclosedFees.length > 2 ? ` 等 ${confirmedSeparateUndisclosedFees.length} 项` : ''}</p>
        ) : null}
        {feeStatusPending > 0 ? <p className="text-sm text-amber">有 {feeStatusPending} 项费用的明示状态或现金流纳入情况待确认，详见费用明细。</p> : null}
        <div className="grid grid-cols-2 gap-2 pt-1 sm:flex">
          <a href="#report-actions" className="inline-flex min-h-11 items-center justify-center rounded-md bg-ink px-3 text-sm font-medium text-surface hover:bg-ink-soft">查看核实动作</a>
          <a href="#report-rules" className="inline-flex min-h-11 items-center justify-center rounded-md border border-line-strong bg-surface px-3 text-sm text-ink hover:border-ink">查看依据</a>
        </div>
        <details className="text-2xs text-mute">
          <summary className="cursor-pointer font-medium text-blue">查看比较口径与金额说明</summary>
          <p className="mt-2">明示年化 {report.facts.disclosure.quoted_apr === null ? '未提供' : `${percent(report.facts.disclosure.quoted_apr)}（${methodNames[report.facts.disclosure.quoted_method]}）`}。</p>
          {canCompare ? <p className="mt-2">本工具的比较容差用于提示核对材料。</p> : null}
          {report.calculation ? <p className="mt-2">独立支付费用合计：{money(report.calculation.summary.total_additional_fees)}，不等同于未列入明示表的金额。</p> : null}
        </details>
      </div>
    </Card>
  );
}
