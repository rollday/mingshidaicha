import { useState } from 'react';
import type { AuditReport } from '../types/audit.ts';
import { Button } from '../components/base/index.tsx';
import { money } from '../lib/format.ts';
import { ActionList } from '../components/report/ActionList.tsx';
import { CorrectionsNotice } from '../components/report/CorrectionsNotice.tsx';
import { FeeTable } from '../components/report/FeeTable.tsx';
import { Glossary } from '../components/report/Glossary.tsx';
import { LenderCheck } from '../components/report/LenderCheck.tsx';
import { MonthlyCard } from '../components/report/MonthlyCard.tsx';
import { RuleList } from '../components/report/RuleList.tsx';
import { SummaryCard } from '../components/report/SummaryCard.tsx';
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
  onReadOfficial,
  onDownloadPdf,
}: {
  report: AuditReport;
  onBack: () => void;
  onReset: () => void;
  onRetry: () => void;
  busy: boolean;
  stage:string;
  onSearch:(name:string)=>void;
  onCancel:()=>void;
  onReadOfficial:(url:string)=>void;
  onDownloadPdf:()=>Promise<Blob>;
}) {
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const loan = report.facts.loan;
  const downloadPdf = async () => {
    if (downloadingPdf) return;
    setDownloadingPdf(true);
    setPdfError('');
    try {
      const blob = await onDownloadPdf();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const date = report.generated_at.slice(0, 10).replace(/[^0-9-]/g, '') || 'report';
      link.href = url;
      link.download = `loan-audit-report-${date}.pdf`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      const message = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
        ? error.message
        : 'PDF 报告生成失败，请稍后重试。';
      setPdfError(message);
    } finally {
      setDownloadingPdf(false);
    }
  };
  return (
    <section className="flex flex-col gap-6 animate-rise">
      <header className="flex flex-col gap-3 border-b border-line pb-4 sm:flex-row sm:items-end sm:justify-between sm:pb-6">
        <div className="flex min-w-0 flex-col gap-1">
          <Button variant="text" onClick={onBack} disabled={busy} className="w-fit text-sm text-mute hover:text-ink">← 返回修改信息</Button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-serif text-display font-bold">{report.title}</h1>
            {report.generation.mode === 'template' ? (
              <span title={report.generation.error_code ?? 'AI 概要未通过校验，已改用规则结果生成'}>
                <span className="rounded-full bg-canvas px-3 py-1 text-xs text-mute">规则概要</span>
              </span>
            ) : null}
          </div>
          <p className="text-sm text-ink-soft">
            {report.facts.lender.name ?? '放款方待确认'}
            {loan.principal !== null ? ` · 本金 ${money(loan.principal)}` : ''}
            {loan.term_periods !== null ? ` · 共 ${loan.term_periods} 期` : ''}
          </p>
          <p className="text-sm text-mute">
            生成时间：{new Date(report.generated_at).toLocaleString('zh-CN')}
          </p>
        </div>
        <div className={`grid ${busy ? 'grid-cols-2' : 'grid-cols-3'} gap-2 sm:flex sm:flex-wrap sm:justify-end`}>
          <Button variant="secondary" className="w-full !px-2 !text-2xs sm:w-auto sm:!px-5 sm:!text-base" onClick={onRetry} disabled={busy}>{busy ? (stage==='read_official_source'?'正在读取官方详情…':stage.startsWith('search_') ? '正在检索公开来源…' : '正在生成报告…') : '重新生成报告'}</Button>
          {busy && <Button className="w-full sm:w-auto" onClick={onCancel}>取消任务</Button>}
          <Button variant="secondary" className="w-full !px-2 !text-2xs sm:w-auto sm:!px-5 sm:!text-base" disabled={busy || downloadingPdf} onClick={() => void downloadPdf()}>{downloadingPdf ? '正在生成 PDF…' : '下载 PDF 报告'}</Button>
          <Button variant="primary" className="w-full !px-2 !text-2xs sm:w-auto sm:!px-7 sm:!text-base" disabled={busy} onClick={onReset}>新建核查</Button>
        </div>
      </header>

      {pdfError ? <p className="-mt-5 text-sm text-red" role="alert">{pdfError}</p> : null}

      <div className="flex flex-col gap-6">
        <SummaryCard report={report} />
        <VerdictCard report={report} />
        <FeeTable report={report} />
        <ActionList report={report} />
        <MonthlyCard report={report} />
        <RuleList report={report} />
        <LenderCheck report={report} busy={busy} onSearch={onSearch} onReadOfficial={onReadOfficial} />
        <Glossary />
        <CorrectionsNotice report={report} />
      </div>
    </section>
  );
}
