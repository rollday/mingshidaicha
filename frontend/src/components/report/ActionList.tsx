import type { AuditReport } from '../../types/audit.ts';
import { Card } from '../base/index.tsx';

export function ActionList({ report }: { report: AuditReport }) {
  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-1"><h2 className="text-lg font-medium">签字前可以做的事</h2><p className="text-sm text-mute">以下是报告根据材料整理的核实动作。</p></header>
      <Card padding="wide">
        {report.narrative.actions.length ? <ol className="flex flex-col gap-3">{report.narrative.actions.map((action, index) => (
          <li key={`${action.rule_id ?? 'general'}-${index}`} className="flex items-start gap-3 border-b border-line pb-3 last:border-0 last:pb-0">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-canvas text-sm text-mute">{index + 1}</span>
            <div className="flex flex-col gap-1"><p className="text-sm leading-relaxed">{action.text}</p>{action.rule_id ? <a href={`#rule-${action.rule_id}`} className="w-fit text-xs text-blue underline">查看对应规则：{action.rule_id}</a> : null}</div>
          </li>
        ))}</ol> : <p className="text-sm text-mute">报告没有列出额外核实动作。</p>}
      </Card>
    </section>
  );
}
