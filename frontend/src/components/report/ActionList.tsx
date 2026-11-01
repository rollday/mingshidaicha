import { useRef, useState } from 'react';
import type { AuditReport } from '../../types/audit.ts';
import { Card } from '../base/index.tsx';
import { navigateToRule, ruleAnchorId } from './rule-navigation.ts';
import { groupActions } from './action-groups.ts';

export function ActionList({ report }: { report: AuditReport }) {
  const copyTargets = useRef(new Map<string, HTMLParagraphElement | null>());
  const [copyStates, setCopyStates] = useState<Record<string, 'copied' | 'manual' | undefined>>({});
  const actions = groupActions(report.narrative.actions);

  const copyText = async (key: string, text: string) => {
    let copied = false;
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch {
        // Fall through to the legacy copy path, then to manual selection.
      }
    }

    if (!copied) copied = fallbackCopy(text);
    if (copied) {
      setCopyStates((current) => ({ ...current, [key]: 'copied' }));
      window.setTimeout(() => setCopyStates((current) => current[key] === 'copied' ? { ...current, [key]: undefined } : current), 2000);
      return;
    }

    selectText(copyTargets.current.get(key));
    setCopyStates((current) => ({ ...current, [key]: 'manual' }));
  };

  return (
    <section id="report-actions" className="scroll-mt-20 flex flex-col gap-4">
      <header className="flex flex-col gap-1"><h2 className="text-lg font-medium">可以核实的下一步</h2><p className="text-sm text-mute">以下动作来自报告中的已确认信息和待核实项。</p></header>
      <Card padding="wide">
        {actions.length ? <ol className="flex flex-col gap-3">{actions.map((action, index) => {
          const copyKey = `${action.ruleIds[0] ?? 'general'}-${index}`;
          const copyState = copyStates[copyKey];
          return (
            <li key={copyKey} className="flex items-start gap-3 border-b border-line pb-3 last:border-0 last:pb-0">
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-canvas text-sm text-mute">{index + 1}</span>
              <div className="flex min-w-0 flex-col gap-1">
                <p ref={(node) => { copyTargets.current.set(copyKey, node); }} className="text-sm leading-relaxed">{action.text}</p>
                {action.ruleIds.length ? <div className="flex flex-wrap gap-x-3 gap-y-1">{action.ruleIds.map((ruleId) => <a key={ruleId} href={`#${ruleAnchorId(ruleId)}`} onClick={(event) => {
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  navigateToRule(ruleId);
                }} className="w-fit text-2xs text-blue underline">查看对应规则：{ruleId}</a>)}</div> : null}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <button type="button" onClick={() => void copyText(copyKey, action.text)} className="inline-flex min-h-11 items-center text-sm text-blue underline underline-offset-2">
                    {copyState === 'copied' ? '已复制' : copyState === 'manual' ? '再试一次复制' : '复制这条建议'}
                  </button>
                  {copyState === 'manual' ? <span className="text-xs text-amber" role="status">自动复制失败，文字已选中，请手动复制。</span> : null}
                </div>
              </div>
            </li>
          );
        })}</ol> : <p className="text-sm text-mute">报告没有列出额外核实动作。</p>}
      </Card>
    </section>
  );
}

function fallbackCopy(text: string): boolean {
  let textarea: HTMLTextAreaElement | null = null;
  try {
    textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea?.remove();
  }
}

function selectText(target: HTMLParagraphElement | null | undefined): void {
  if (!target) return;
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(target);
  selection.removeAllRanges();
  selection.addRange(range);
}
