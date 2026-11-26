import { useEffect, useState } from 'react';
import type { CaseState } from '../lib/case-client.ts';
import { Tag } from './base/index.tsx';
import ProcessPanel from './ProcessPanel.tsx';

/**
 * 材料处理主线共八步，后端逐个推进 stage；这里只负责把 stage 换成「第几步 + 一句在做什么」。
 * 文案沿用上传页加载块的措辞，保证折叠条和下方加载提示是同一套说法。
 */
const STEPS: ReadonlyArray<{ stage: string; label: string }> = [
  { stage: 'upload', label: '正在上传材料' },
  { stage: 'parse_pdf', label: '正在读取 PDF 文本' },
  { stage: 'read_images', label: '正在识别图片内容' },
  { stage: 'extract_case', label: '正在抽取并对齐事实' },
  { stage: 'prepare_review', label: '正在准备核对信息' },
  { stage: 'calculate', label: '正在生成现金流并核算' },
  { stage: 'check_rules', label: '正在对照检查项' },
  { stage: 'write_report', label: '正在撰写报告' },
];

/**
 * 处理过程的折叠条。
 * 收起时只占一行：处理中 / 当前阶段 / 第几步；展开后复用原来的 ProcessPanel，
 * 处理时间线、分析摘要、材料原文仍由它渲染，不在这里复制一份。
 */
export default function ProcessFold({
  state,
  onCancel,
  transition = false,
}: {
  state: CaseState;
  onCancel: () => void;
  /** 确认页正在生成报告时，整页只剩这条：补一个取消入口和一句去向说明。 */
  transition?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const stepIndex = STEPS.findIndex((item) => item.stage === state.stage);
  const stepLabel = stepIndex >= 0 ? STEPS[stepIndex]!.label : '正在处理';
  const count = state.activities.length;

  // 任务结束时自动收起，避免结果页上方挂着一段旧日志；结束后用户手动展开的不会被这里关掉。
  useEffect(() => {
    if (!state.busy) setOpen(false);
  }, [state.busy]);

  return (
    <section className="mb-5 min-w-0 rounded-md border border-line bg-surface">
      <div className="flex min-w-0 items-center">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="process-fold-body"
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-3 px-5 py-3 text-left"
        >
          <Tag tone={state.busy ? 'blue' : 'neutral'}>{state.busy ? '处理中' : '处理记录'}</Tag>
          <span className="min-w-0 flex-1 truncate text-sm font-medium" role="status" aria-live="polite">
            {state.busy ? stepLabel : `已结束 · ${count} 条记录`}
          </span>
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            aria-hidden="true"
            className={`ml-auto shrink-0 text-mute transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
          >
            <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        {state.busy && transition ? (
          <button
            type="button"
            onClick={onCancel}
            className="mr-5 shrink-0 border-b border-dashed border-line-strong text-xs text-mute hover:text-ink"
          >
            取消
          </button>
        ) : null}
      </div>
      {state.busy && stepIndex >= 0 ? (
        <div className="px-5 pb-3">
          <div
            role="progressbar"
            aria-label="处理阶段"
            aria-valuemin={0}
            aria-valuemax={STEPS.length}
            aria-valuenow={stepIndex}
            aria-valuetext={`第 ${stepIndex + 1} 步，共 ${STEPS.length} 步`}
            className="flex h-1 w-full overflow-hidden rounded-sm bg-line"
          >
            <span
              className="h-full bg-blue transition-[width] duration-500"
              style={{ width: `${(stepIndex / STEPS.length) * 100}%` }}
            />
            <span
              className="h-full bg-blue/30 transition-[width] duration-500"
              style={{ width: `${(1 / STEPS.length) * 100}%` }}
            />
          </div>
          <p className="mt-1 text-2xs text-mute">
            第 {stepIndex + 1} / {STEPS.length} 步 · 按处理阶段显示，不代表完成百分比
          </p>
          {transition ? <p className="mt-2 text-sm text-ink-soft">材料已确认，正在核算并生成报告；完成后自动进入报告页。</p> : null}
        </div>
      ) : null}
      {open ? (
        <div id="process-fold-body" className="animate-unfold px-4 pb-1 [&>section]:mb-0">
          <ProcessPanel state={state} onCancel={onCancel} />
        </div>
      ) : null}
    </section>
  );
}
