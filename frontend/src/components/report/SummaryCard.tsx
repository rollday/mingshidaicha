import type { AuditReport } from '../../types/audit.ts';
import { Card, Tag } from '../base/index.tsx';

export function SummaryCard({ report }: { report: AuditReport }) {
  const aiGenerated = report.generation.mode === 'ai';
  return (
    <Card as="section" aria-labelledby="report-summary-heading" padding="none" className="relative overflow-hidden p-4 sm:p-7">
      <div className="absolute inset-y-0 left-0 w-1 bg-blue" />
      <div className="flex flex-col gap-3 pl-2">
        <header className="flex flex-wrap items-center gap-2">
          <h2 id="report-summary-heading" className="font-serif text-lg font-medium">{aiGenerated ? 'AI 概要' : '核查概要'}</h2>
          <Tag tone={aiGenerated ? 'blue' : 'neutral'}>{aiGenerated ? 'AI 生成' : '模板回退'}</Tag>
        </header>
        <p className="whitespace-pre-wrap text-base leading-relaxed text-ink">{report.narrative.summary}</p>
        {!aiGenerated ? (
          <p className="text-xs leading-relaxed text-mute">AI 撰写未通过校验，以下概要由已确认规则结果生成；费用计算和核查结论不受影响。</p>
        ) : null}
      </div>
    </Card>
  );
}
