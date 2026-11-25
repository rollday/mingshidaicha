import type { AuditReport } from '../../types/audit.ts';
import { money } from '../../lib/format.ts';
import { Card, Tag } from '../base/index.tsx';

export function SummaryCard({ report, embedded = false }: { report: AuditReport; embedded?: boolean }) {
  const aiGenerated = report.generation.mode === 'ai';
  const calculation = report.calculation?.summary;
  const hasContingentFees = report.facts.fees.some((fee) => fee.contingent === true);
  const summaryText = report.narrative.summary?.trim() || '报告未提供概要，请以核查结果为准。';
  const label = aiGenerated ? 'AI 概要' : '核查概要';
  const modeTag = <Tag tone={aiGenerated ? 'blue' : 'neutral'}>{aiGenerated ? 'AI 生成' : '模板回退'}</Tag>;
  const fallbackNote = !aiGenerated ? <p className="text-xs leading-relaxed text-mute">AI 撰写未通过校验，以下概要由已确认规则结果生成；费用计算和核查结论不受影响。</p> : null;

  if (embedded) {
    return (
      <div className="rounded-md border border-blue/20 bg-blue/5 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-blue"><span>{label}</span>{modeTag}</div>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">{summaryText}</p>
        <p className="mt-2 text-2xs text-mute">原文保留 · 报告生成时的概要</p>
        {fallbackNote}
      </div>
    );
  }

  return (
    <Card as="section" aria-labelledby="report-summary-heading" padding="none" className="relative overflow-hidden p-4 sm:p-7">
      <div className="absolute inset-y-0 left-0 w-1 bg-blue" />
      <div className="flex flex-col gap-3 pl-2">
        <header className="flex flex-wrap items-center gap-2">
          <h2 id="report-summary-heading" className="font-serif text-lg font-medium">{label}</h2>
          {modeTag}
        </header>
        <p className="whitespace-pre-wrap text-base leading-relaxed text-ink">{summaryText}</p>
        {calculation ? (
          <div className="rounded-md border border-blue/20 bg-blue/5 px-3 py-3">
            <p className="text-sm leading-relaxed">按当前材料预计，你一共要还 <strong className="num text-base">{money(calculation.total_payment)}</strong>。</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-soft">
              还款计划 {money(calculation.total_repayment)} + 另付费用 {money(calculation.total_additional_fees)}；其中借款成本（不含归还本金）{money(calculation.total_cost)}。
            </p>
            {hasContingentFees ? <p className="mt-1 text-xs text-mute">未包含逾期等条件下才可能产生的或有费用。</p> : null}
          </div>
        ) : null}
        {fallbackNote}
      </div>
    </Card>
  );
}
