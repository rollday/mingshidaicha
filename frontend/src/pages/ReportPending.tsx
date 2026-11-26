import { useEffect, useState } from 'react';
import type { CaseState } from '../lib/case-client.ts';
import ProcessPanel from '../components/ProcessPanel.tsx';
import { Button, Card, Tag } from '../components/base/index.tsx';

/**
 * 确认 → 报告 之间的处理中间页。
 * 只负责把「正在处理」这件事说清楚：阶段进度条 + 阶段清单 + 折叠的处理记录。
 * 报告数据一到（report.result），App 会直接渲染既有报告页，这里不需要成功态。
 */

const STAGES = [
  { key: 'upload', label: '上传材料' },
  { key: 'parse_pdf', label: '读取 PDF 原文' },
  { key: 'read_images', label: '识别图片文字' },
  { key: 'extract_case', label: '抽取并对齐事实' },
  { key: 'prepare_review', label: '准备核对信息' },
  { key: 'calculate', label: '核算借款成本' },
  { key: 'check_rules', label: '对照检查规则' },
  { key: 'write_report', label: '撰写报告' },
] as const;

/** 后端 task.progress 只给阶段的名称，没有真实百分比，进度按已完成阶段数折算。 */
const STAGE_NAMES: Record<string, string> = {
  calculate: '正在核算借款成本',
  check_rules: '正在对照检查规则',
  write_report: '正在撰写报告',
};

function StageMark({ status }: { status: 'done' | 'now' | 'idle' }) {
  return (
    <span
      aria-hidden="true"
      className={[
        'flex size-4 shrink-0 items-center justify-center rounded-full',
        status === 'done' ? 'bg-ink text-surface' : status === 'now' ? 'border-2 border-blue' : 'border border-line-strong',
      ].join(' ')}
    >
      {status === 'done' ? (
        <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
          <path d="M2 6.4 4.8 9 10 3.4" stroke="currentColor" strokeWidth="2" />
        </svg>
      ) : null}
    </span>
  );
}

export default function ReportPending({ state, onCancel }: { state: CaseState; onCancel: () => void }) {
  const [elapsed, setElapsed] = useState<number | null>(null);
  const stageIndex = STAGES.findIndex(stage => stage.key === state.stage);
  const currentIndex = Math.max(0, stageIndex);
  const stageName = STAGE_NAMES[state.stage] ?? '正在生成报告';
  const percent = stageIndex >= 0 ? (stageIndex / STAGES.length) * 100 : (5 / STAGES.length) * 100;
  const percentText = percent % 1 === 0 ? String(percent) : percent.toFixed(1);
  const lede = state.stage === 'calculate'
    ? '正在按你在核对页确认的金额、期数和费用核算，随后对照规则并撰写结论。通常需要 20–40 秒，期间可以取消。'
    : '已按你在核对页确认的金额、期数和费用完成核算，正在对照规则并撰写结论。通常需要 20–40 秒，期间可以取消。';

  useEffect(() => {
    if (!state.startedAt) {
      setElapsed(null);
      return;
    }
    const started = Date.parse(state.startedAt);
    if (!Number.isFinite(started)) {
      setElapsed(null);
      return;
    }
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - started) / 1_000)));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [state.startedAt]);

  return (
    <section className="animate-rise">
      <h1 className="font-serif text-display font-bold">正在生成你的报告</h1>
      <p className="mt-3 text-ink-soft">{lede}</p>

      <Card className="mt-6">
        <div className="flex flex-wrap items-center gap-3">
          <Tag tone="blue">进行中</Tag>
          <h2 className="text-lg font-medium">{stageName}</h2>
          {elapsed !== null ? <span className="ml-auto text-xs text-mute">已用时 <b className="num font-medium text-ink">{elapsed}</b> 秒</span> : null}
        </div>

        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label="按处理阶段估算的处理进度"
          className="mt-4 h-2 overflow-hidden rounded-full bg-line"
        >
          <div className="h-full rounded-full bg-blue transition-[width] duration-700 ease-fill" style={{ width: `${percent}%` }} />
        </div>
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2 text-xs text-mute">
          <span>按处理阶段估算，不是精确百分比</span>
          <span className="num text-ink-soft">{percentText}%</span>
        </div>

        <ol aria-label="处理阶段" className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {STAGES.map((stage, index) => {
            const status = index < currentIndex ? 'done' : index === currentIndex ? 'now' : 'idle';
            return (
              <li
                key={stage.key}
                className={[
                  'flex items-center gap-2 rounded-md border px-3 py-2 text-sm',
                  status === 'done' ? 'border-line bg-surface text-ink'
                    : status === 'now' ? 'border-blue/25 bg-blue/10 text-blue'
                      : 'border-line bg-canvas text-mute',
                ].join(' ')}
              >
                <StageMark status={status} />
                {stage.label}
              </li>
            );
          })}
        </ol>

        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <Button onClick={onCancel}>取消本次任务</Button>
          <span className="text-xs text-mute">已保存本次确认的信息，取消后可返回核对页修改。</span>
        </div>
      </Card>

      <details className="mt-6 rounded-md border border-line bg-surface">
        <summary className="cursor-pointer px-5 py-3 text-sm font-medium">处理记录（{state.activities.length} 条）</summary>
        <div className="px-4 pb-1"><ProcessPanel state={state} onCancel={onCancel} /></div>
      </details>

      <p className="mt-6 text-xs text-mute">本报告基于你确认的信息生成，不构成法律意见或借贷建议。</p>
    </section>
  );
}
