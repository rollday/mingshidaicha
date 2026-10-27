import { Segmented } from './base/index.tsx';
import type { Mode } from '../types/audit.ts';
export function ModeSwitch({ value, onChange }: { value: Mode; onChange: (mode: Mode) => void }) {
  return <Segmented value={value} onChange={onChange} options={[{ value: 'general', label: '通用' }, { value: 'student', label: '大学生' }]} />;
}
export default function AppHeader({ mode, onModeChange, locked }: { mode: Mode; onModeChange: (mode: Mode) => void; locked: boolean }) {
  return <header className="sticky top-0 z-40 border-b border-line bg-surface/80 backdrop-blur-xl">
    <div className="mx-auto flex min-h-16 max-w-page flex-wrap items-center justify-between gap-3 px-gutter py-3">
      <div className="flex items-center gap-3"><svg className="size-7 text-ink" viewBox="0 0 28 28" fill="none" aria-hidden="true"><rect x="3" y="3" width="22" height="22" rx="5" stroke="currentColor" strokeWidth="2" /><path d="M8 10h12M8 14h12M8 18h6" stroke="currentColor" strokeWidth="2" /><path className="text-blue" d="m16 19 2 2 5-5" stroke="currentColor" strokeWidth="2" /></svg><span className="font-serif text-lg font-bold">明示贷查</span></div>
      {locked ? <span className="text-sm text-mute">{mode === 'student' ? '大学生场景' : '通用场景'}</span> : <ModeSwitch value={mode} onChange={onModeChange} />}
    </div>
  </header>;
}
