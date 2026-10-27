import type { AuditReport } from '../types/audit.ts';
import { Button } from '../components/base/index.tsx';
import { ActionList } from '../components/report/ActionList.tsx';
import { CorrectionsNotice } from '../components/report/CorrectionsNotice.tsx';
import { FeeTable } from '../components/report/FeeTable.tsx';
import { Glossary } from '../components/report/Glossary.tsx';
import { LenderCheck } from '../components/report/LenderCheck.tsx';
import { MonthlyCard } from '../components/report/MonthlyCard.tsx';
import { RuleList } from '../components/report/RuleList.tsx';
import { VerdictCard } from '../components/report/VerdictCard.tsx';

export default function Report({
  report,
  onBack,
  onReset,
  onRetry,
  busy,
  stage,
  onSearch,
  onCancel,
}: {
  report: AuditReport;
  onBack: () => void;
  onReset: () => void;
  onRetry: () => void;
  busy: boolean;
  stage:string;
  onSearch:(name:string)=>void;
  onCancel:()=>void;
}) {
  return (
    <section className="flex flex-col gap-8 animate-rise">
      <header className="flex flex-col gap-5 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-2">
          <Button variant="text" onClick={onBack} disabled={busy} className="w-fit text-sm text-mute hover:text-ink">← 返回确认信息</Button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-serif text-display font-bold">{report.title}</h1>
            {report.generation.mode === 'template' ? (
              <span title={report.generation.error_code ?? 'AI 报告未通过校验或暂不可用'}>
                <span className="rounded-full bg-canvas px-3 py-1 text-xs text-mute">模板生成</span>
              </span>
            ) : null}
          </div>
          <p className="text-sm text-mute">
            生成时间：{new Date(report.generated_at).toLocaleString('zh-CN')}
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button variant="secondary" onClick={onRetry} disabled={busy}>{busy ? (stage.startsWith('search_') ? '正在检索公开来源…' : '正在生成报告…') : '重新生成报告'}</Button>
          {busy && <Button onClick={onCancel}>取消任务</Button>}
          <Button variant="secondary" disabled={busy} onClick={() => {
            const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
            const link = document.createElement('a'); link.href = url; link.download = 'loan-audit-report.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}>下载报告数据</Button>
          <Button variant="primary" disabled={busy} onClick={onReset}>新建核查</Button>
        </div>
      </header>

      <div className="flex flex-col gap-8">
        <VerdictCard report={report} />
        <FeeTable report={report} />
        <RuleList report={report} />
        <LenderCheck report={report} busy={busy} onSearch={onSearch} />
        <MonthlyCard report={report} />
        <Glossary />
        <ActionList report={report} />
        <CorrectionsNotice report={report} />
      </div>
    </section>
  );
}
