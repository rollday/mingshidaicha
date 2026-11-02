import type { AuditReport } from '../../types/audit.ts';
import { money, percent } from '../../lib/format.ts';
import { Card } from '../base/index.tsx';

export function CorrectionsNotice({ report }: { report: AuditReport }) {
  return (
    <section className="flex flex-col gap-4">
      <header><h2 className="text-lg font-medium">报告局限与说明</h2></header>
      <Card padding="wide" className="flex flex-col gap-5">
        {report.corrections.length ? (
          <div><h3 className="mb-3 text-base font-medium">修改过 {report.corrections.length} 处信息</h3><ul className="flex flex-col gap-3">{report.corrections.map((correction, index) => <li key={`${correction.field}-${index}`} className="flex flex-col gap-1 border-b border-line pb-3 last:border-0 last:pb-0"><span className="text-sm font-medium">{correction.field}</span><div className="grid gap-2 text-sm sm:grid-cols-[1fr_auto_1fr]"><CorrectionValue label="原识别" field={correction.field} value={correction.before} /><span className="hidden self-center text-mute sm:block">→</span><CorrectionValue label="确认后" field={correction.field} value={correction.after} /></div></li>)}</ul></div>
        ) : null}
        <div className={report.corrections.length ? 'border-t border-line pt-4' : ''}>
          <h3 className="text-base font-medium">报告局限</h3>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-mute">{report.narrative.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul>
          {report.generation.mode === 'template' ? <p className="mt-3 text-sm text-mute">本报告概要由规则结果生成，费用计算和核查结论完整；具体依据仍以已确认信息为准。</p> : null}
        </div>
        <p className="border-t border-line pt-4 text-sm text-mute">{report.disclaimer}</p>
      </Card>
    </section>
  );
}

function CorrectionValue({ label, field, value }: { label: string; field: string; value: unknown }) {
  let display: string;
  if (value === null || value === undefined) display = '待确认';
  else if (typeof value === 'boolean') display = value ? '是' : '否';
  else if (typeof value === 'string') {
    if (/^(?:-?\d+(?:\.\d+)?)$/.test(value) && /amount|principal|disbursed|payment/i.test(field)) display = money(value);
    else if (/^(?:-?\d+(?:\.\d+)?)$/.test(value) && /apr|rate|年化|利率/i.test(field)) display = percent(value);
    else display = value || '空';
  }
  else if (typeof value === 'object') display = JSON.stringify(value) ?? String(value);
  else display = String(value);
  return <p className="min-w-0 break-words"><span className="text-mute">{label}：</span>{display}</p>;
}
