import { useEffect, useId, useState } from 'react';
import type { CaseState } from '../lib/case-client.ts';
import { Tag } from './base/index.tsx';
import ProcessPanel, { stageName } from './ProcessPanel.tsx';

export default function ProcessFold({
  state,
  onCancel,
  showCancel = false,
}: {
  state: CaseState;
  onCancel: () => void;
  showCancel?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const label = state.busy ? (state.stage ? stageName(state.stage) : '正在处理') : `共 ${state.activities.length} 条记录`;

  useEffect(() => {
    if (!state.busy) setOpen(false);
  }, [state.busy]);

  return (
    <section className="mb-5 min-w-0 rounded-md border border-line bg-surface">
      <div className="flex min-w-0 items-center">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-3 px-5 py-3 text-left"
        >
          <Tag tone={state.busy ? 'blue' : 'neutral'}>{state.busy ? '处理中' : '处理记录'}</Tag>
          <span className="min-w-0 flex-1 truncate text-sm font-medium" role="status">
            {label}
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
        {state.busy && showCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="mr-5 shrink-0 border-b border-dashed border-line-strong text-sm text-mute hover:text-ink"
          >
            取消本次任务
          </button>
        )}
      </div>
      <div id={bodyId} hidden={!open} className="animate-unfold px-4 pb-1 [&>section]:mb-0">
        {open && <ProcessPanel state={state} onCancel={onCancel} hideCancel />}
      </div>
    </section>
  );
}
