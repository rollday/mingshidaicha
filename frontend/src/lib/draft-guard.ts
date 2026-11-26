import { createContext, useContext, useId, useLayoutEffect, useSyncExternalStore } from 'react';

export type DraftStatus = 'valid' | 'pending' | 'invalid';
export type DraftIssue = { label: string; status: Exclude<DraftStatus, 'valid'> };

/** Incomplete typed text must be resolved before the current stored facts are submitted. */
export function draftBlocker(issues: DraftIssue[]): string | null {
  const invalid = issues.filter(issue => issue.status === 'invalid').map(issue => issue.label);
  const pending = issues.filter(issue => issue.status === 'pending').map(issue => issue.label);
  if (invalid.length && pending.length) return `先修正这些输入：${invalid.join('、')}；再让这些输入生效：${pending.join('、')}（按 Enter 或点到别处）。`;
  if (invalid.length) return `先修正这些输入：${invalid.join('、')}。输入框里的文字尚未生效。`;
  if (pending.length) return `先让这些输入生效：${pending.join('、')}（按 Enter 或点到别处），避免提交修改前的金额。`;
  return null;
}

export type DraftGuard = {
  update: (id: string, label: string, status: DraftStatus) => void;
  clear: (id: string) => void;
  blocker: () => string | null;
  subscribe: (listener: () => void) => () => void;
};
export function createDraftGuard(): DraftGuard {
  const issues = new Map<string, DraftIssue>();
  const listeners = new Set<() => void>();
  const changed = () => { for (const listener of listeners) listener(); };
  return {
    update(id, label, status) {
      if (status === 'valid') {
        if (issues.delete(id)) changed();
        return;
      }
      const previous = issues.get(id);
      if (previous?.label === label && previous.status === status) return;
      issues.set(id, { label, status });
      changed();
    },
    clear(id) { if (issues.delete(id)) changed(); },
    blocker() { return draftBlocker([...issues.values()]); },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
export const DraftGuardContext = createContext<DraftGuard | null>(null);

/** Keep the confirmation guard in lockstep with the visible draft, before another click can submit. */
export function useDraftGuard(label: string, status: DraftStatus) {
  const guard = useContext(DraftGuardContext);
  const id = useId();
  useLayoutEffect(() => { guard?.update(id, label, status); }, [guard, id, label, status]);
  useLayoutEffect(() => () => guard?.clear(id), [guard, id]);
}

/** A live page-level message that follows draft edits without polling. */
export function useDraftBlocker(guard: DraftGuard) {
  return useSyncExternalStore(guard.subscribe, () => guard.blocker() ?? '');
}
