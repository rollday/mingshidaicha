import type { ReactNode } from 'react';
import type { AuditReport } from '../../types/audit.ts';
import { comparisonStatus, unavailableComparisonLabels, unsupportedDisclosureHint } from '../../../../shared/apr-comparison.ts';
import { decimal, methodNames, money, moneyPlain, percent } from '../../lib/format.ts';
import {
  includedFeePhrase,
  receivedAmount,
  undisclosedIncludedFees,
  undisclosedSeparateFees,
  undisclosedSeparateTotal,
} from '../../lib/report-display.ts';
import { Card, Tag, type Tone } from '../base/index.tsx';
import { SummaryCard } from './SummaryCard.tsx';

const levelTone: Record<AuditReport['conclusion']['level'], Tone> = {
  red: 'red',
  yellow: 'amber',
  blue: 'blue',
};

export function VerdictCard({ report }: { report: AuditReport }) {
  const summary = report.calculation?.summary;
  const rates = report.calculation?.calculation;
  const comparison = rates?.comparison;
  const status = comparisonStatus(comparison);
  const canCompare = comparison !== undefined && status !== 'unavailable' && comparison.quoted_apr !== null && comparison.computed_apr !== null;
  const quoted = comparison?.quoted_apr ?? report.facts.disclosure.quoted_apr;
  const computed = canCompare ? comparison.computed_apr : rates?.nominal_apr ?? rates?.xirr_apr;
  const gap = comparison?.gap_pp ?? null;
  const reason = comparison?.unavailable_reason ??
    (comparison?.quoted_apr == null ? 'missing_disclosed_apr' : comparison.method_basis === 'unavailable' ? 'unconfirmed_disclosed_method' : null);
  const { confirmed_issues: confirmed, pending_checks: pending, advisory_hints: advisory } = report.conclusion.counts;
  const tone = levelTone[report.conclusion.level];
  const accent = tone === 'red' ? 'border-l-red' : tone === 'amber' ? 'border-l-amber' : 'border-l-blue';
  const loan = report.facts.loan;
  const received = receivedAmount(summary, loan);
  const total = summary?.total_payment ?? null;
  const totals = new Map((report.calculation?.fee_totals ?? []).map((item) => [item.id, item]));
  const undisclosedSeparate = undisclosedSeparateFees(report.facts.fees);
  const undisclosedIncluded = undisclosedIncludedFees(report.facts.fees);
  const extra = undisclosedSeparateTotal(report.facts.fees, totals, loan.term_periods);
  const feeForLede = undisclosedSeparate.find((fee) => fee.timing === 'per_period' && fee.amount !== null) ?? undisclosedSeparate[0] ?? null;
  const includedForLede = undisclosedIncluded.find((fee) => fee.timing === 'per_period' && fee.amount !== null) ?? undisclosedIncluded[0] ?? null;

  let lede: ReactNode = null;
  if (canCompare) {
    lede = feeForLede ? (
      <>合同上写的年化是 {percent(quoted)}，但{feeForLede.timing === 'per_period' ? `每期还要另收 ${moneyPlain(feeForLede.amount)} 元${feeForLede.name}` : `还有${feeForLede.name} ${money(feeForLede.amount)}`}，表里没写。把已经发生的还款和这笔另付费用一起算，实际年化约 <mark className="hl-red">{percent(computed)}</mark>。</>
    ) : includedForLede ? (
      <>合同上写的年化是 {percent(quoted)}，但表里没写{includedForLede.name}；这笔钱{includedFeePhrase(includedForLede)}，按实际还款重算约 <mark className="hl-red">{percent(computed)}</mark>。</>
    ) : (
      <>合同上写的年化是 {percent(quoted)}，按材料重算约 <mark className="hl-red">{percent(computed)}</mark>{gap !== null ? <>，差 {decimal(gap)} 个百分点。</> : <>。</>}</>
    );
  } else if (computed !== null && computed !== undefined) {
    lede = <>按材料重算约 {percent(computed)}（{methodNames[comparison?.method ?? 'unknown']}），暂无可直接对比的明示年化。</>;
  } else {
    lede = <>借款成本与重算年化暂不可用，先看下面已确认的费用与核查结果。</>;
  }

  return (
    <Card padding="none" className={`relative overflow-hidden border-l-4 ${accent} p-5 sm:p-7`}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {confirmed > 0 ? <Tag tone="red">已确认 {confirmed} 个问题</Tag> : null}
          {pending > 0 ? <Tag tone="amber">待核实 {pending} 项</Tag> : null}
          {advisory > 0 ? <Tag tone="blue">阅读提示 {advisory} 条</Tag> : null}
          {confirmed === 0 && pending === 0 ? <Tag tone="green">未发现需提示的问题</Tag> : null}
          {report.conclusion.partial ? <Tag tone="blue">计算未完成</Tag> : null}
        </div>

        <h2 className="font-serif text-xl font-semibold leading-snug text-ink">
          {total !== null ? (
            <>借 {received === null ? '这笔款' : `${moneyPlain(received)} 元`}，一共要还 <mark className="hl-red">{money(total)}</mark></>
          ) : (
            <>这笔借款的还款总额暂不可用</>
          )}
        </h2>

        <p className="text-base leading-relaxed text-ink">{lede}</p>

        {comparison && rates && unsupportedDisclosureHint({ ...comparison, nominal_apr: rates.nominal_apr, effective_apr: rates.effective_apr, xirr_apr: rates.xirr_apr }) ? (
          <p className="text-sm text-amber">披露口径标注可能有误：按所标口径无法重算，但
            {rates.nominal_apr != null ? `名义年化约 ${percent(rates.nominal_apr)}` : ''}
            {rates.nominal_apr != null && rates.effective_apr != null ? '、' : ''}
            {rates.effective_apr != null ? `复利年化约 ${percent(rates.effective_apr)}` : ''}
            {rates.xirr_apr != null ? `按实际日期年化约 ${percent(rates.xirr_apr)}` : ''}
            可以重算。披露数值可能对应其中另一种口径，请核对标注；这不是利率标错的认定。</p>
        ) : null}

        <SummaryCard report={report} embedded />

        {summary ? (
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-md bg-canvas px-4 py-3">
              <p className="text-xs text-mute">到手</p>
              <p className="mt-1 font-serif text-lg font-semibold leading-tight num">{received === null ? '—' : moneyPlain(received)}<span className="ml-1 text-xs font-normal text-mute">元</span></p>
            </div>
            <div className="rounded-md bg-canvas px-4 py-3">
              <p className="text-xs text-mute">一共要还</p>
              <p className="mt-1 font-serif text-lg font-semibold leading-tight num"><mark className="hl">{total === null ? '—' : moneyPlain(total)}</mark><span className="ml-1 text-xs font-normal text-mute">元</span></p>
            </div>
            <div className="rounded-md bg-amber-bg px-4 py-3 max-sm:col-span-2">
              <p className="text-xs text-amber">表外且另付</p>
              <p className="mt-1 font-serif text-lg font-semibold leading-tight num text-amber">{extra === null ? '—' : <mark className="hl">{moneyPlain(extra)}</mark>}<span className="ml-1 text-xs font-normal text-amber">元</span></p>
            </div>
          </div>
        ) : null}

        {canCompare ? (
          <div className="mt-2 flex flex-col gap-3">
            <div>
              <div className="flex items-baseline justify-between gap-3 text-sm text-ink-soft"><span>表上写的年化</span><span className="num">{percent(quoted)}</span></div>
              <div className="mt-1 h-3 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-line-strong" style={{ width: barWidth(quoted) }} /></div>
            </div>
            <div>
              <div className="flex items-baseline justify-between gap-3 text-sm text-ink-soft"><span>按实际支出算的年化</span><span className="num font-semibold text-red">{percent(computed)}</span></div>
              <div className="mt-1 h-3 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-red" style={{ width: barWidth(computed) }} /></div>
            </div>
            {gap !== null ? <p className="text-xs text-mute">差 {decimal(gap)} 个百分点。</p> : null}
          </div>
        ) : (
          <p className="text-sm text-mute">未完成同口径比较。{reason ? unavailableComparisonLabels[reason] : '缺少完整比较结果'}。</p>
        )}

        {rates ? (
          <details className="mt-3 border-t border-dashed border-line pt-3">
            <summary className="cursor-pointer text-xs font-medium text-blue">「年化」是什么意思？</summary>
            <div className="mt-3 flex flex-col gap-2 text-sm leading-relaxed text-ink-soft">
              <p>年化就是把<strong className="text-ink">利息和各项费用</strong>折算成「一年要付多少」的比率，用来比较不同期限、不同收费方式的贷款谁更贵。</p>
              <p>借 100 元、一年下来多付 12 元，年化就是 12%。</p>
              {canCompare ? <p>这笔贷款表上写 {percent(quoted)}；{feeForLede ? `表里没写每期另收的 ${moneyPlain(feeForLede.amount)} 元${feeForLede.name}，` : includedForLede ? `表里没写${includedForLede.name}（${includedFeePhrase(includedForLede)}），` : '按实际还款安排重算，'}年化约 <strong className="text-red">{percent(computed)}</strong>。</p> : null}
              {canCompare ? <p>注意：{percent(computed)} <strong className="text-ink">不等于</strong>「一共多付 {percent(computed)}」——因为你是分期还本，本金在逐月减少，所以按「平均占用的本金」折算才是这个数。你实际多付的总额是 <strong className="num text-ink">{money(summary?.total_cost)}</strong>。</p> : null}
              {quoted !== null ? <p>明示口径：{methodNames[report.facts.disclosure.quoted_method]}；本工具的比较容差用于提示核对材料。</p> : null}
            </div>
          </details>
        ) : null}
      </div>
    </Card>
  );
}

function barWidth(value: string | null | undefined): string {
  if (value == null) return '0%';
  const numeric = Number(decimal(value, 2, 2));
  if (!Number.isFinite(numeric)) return '0%';
  return `${Math.min(100, Math.max(0, numeric * 4))}%`;
}
