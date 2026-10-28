import { useState } from 'react';
import type { AuditReport, RuleResult } from '../../types/audit.ts';
import { rulePresentation } from '../../../../shared/rule-policy.ts';
import { AccordionCard, Card, Tag, type Tone } from '../base/index.tsx';

export function RuleList({ report }: { report: AuditReport }) {
  return (
    <section id="report-rules" className="flex flex-col gap-4">
      <header className="flex flex-col gap-1"><h2 className="text-lg font-medium">规则检查</h2><p className="text-sm text-mute">逐项展示检查结果、依据和可以进一步核实的动作。</p></header>
      {report.rules.length ? <div className="flex flex-col gap-3">{report.rules.map((rule) => <RuleItem key={rule.rule_id} rule={rule} report={report} />)}</div> : <Card><p className="text-sm text-mute">报告中没有规则检查结果。</p></Card>}
    </section>
  );
}

function RuleItem({ rule, report }: { rule: RuleResult; report: AuditReport }) {
  const [open, setOpen] = useState(rule.status === 'triggered');
  const presentation = rulePresentation(rule);
  const evidence = [...new Map(report.evidence.filter((item) => rule.evidence_ids.includes(item.id)).map(item => [JSON.stringify([item.document_id,item.page,item.quote]),item])).values()];
  return (
    <AccordionCard title={<span id={`rule-${rule.rule_id}`} className="flex flex-wrap items-center gap-2"><Tag tone={presentation.tone as Tone}>{presentation.label}</Tag><Tag tone="neutral">{presentation.natureLabel}</Tag><span>{rule.rule_id} {rule.title}</span></span>} open={open} onToggle={() => setOpen(!open)} dense>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2"><Tag tone={presentation.tone as Tone}>{presentation.label}</Tag>{presentation.levelLabel && presentation.levelLabel !== presentation.natureLabel ? <Tag tone={presentation.tone as Tone}>{presentation.levelLabel}</Tag> : null}<Tag tone="neutral">{presentation.natureLabel}</Tag><span className="self-center text-xs text-mute">{presentation.factLabel} · 规则 {rule.rule_id}</span></div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{rule.reason}</p>
        {rule.action ? <Card inset tone="blue"><p className="text-sm"><span className="font-medium">可以核实：</span>{rule.action}</p></Card> : null}
        {rule.citation ? (
          <Card inset>
            <p className="text-sm font-medium">{rule.citation.document}{rule.citation.article ? ` · ${rule.citation.article}` : ''}</p>
            {rule.citation.quote ? <blockquote className="mt-2 border-l-2 border-line-strong pl-3 text-sm text-ink-soft">{rule.citation.quote}</blockquote> : null}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-mute">
              {rule.citation.effective_date ? <span>生效日期：{rule.citation.effective_date}</span> : null}
              <span>{rule.citation.verification === 'official_checked' ? '来源已作官方核对' : '依据为本地材料，未作官方核对'}</span>
            </div>
            {rule.citation.url ? <a className="mt-2 inline-block break-all text-sm text-blue underline" href={rule.citation.url} target="_blank" rel="noreferrer">查看来源</a> : null}
          </Card>
        ) : <p className="text-xs text-mute">此项没有附带条款出处。</p>}
        {evidence.length ? <details><summary className="cursor-pointer text-sm font-medium">关联材料摘录（{evidence.length}段）</summary><div className="mt-3 flex flex-col gap-2">{evidence.map((item) => <blockquote key={item.id} className="rounded-md bg-canvas px-4 py-3 text-sm text-ink-soft"><p>{item.quote}</p><footer className="mt-2 text-xs text-mute">原文依据{item.page === null ? '' : ` · 第 ${item.page} 页`}{item.source_type === 'vision_transcript' ? ' · 图像转录，待核对' : ''}</footer></blockquote>)}</div></details> : null}
      </div>
    </AccordionCard>
  );
}

