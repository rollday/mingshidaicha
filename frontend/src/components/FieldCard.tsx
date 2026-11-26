import { Field, fieldInputClass } from './base/index.tsx';

export function TriSelect({ value, onChange, label }: { value: boolean | null; onChange: (value: boolean | null) => void; label: string }) {
  return <select aria-label={label} value={value === null ? 'unknown' : String(value)} onChange={event => onChange(event.target.value === 'unknown' ? null : event.target.value === 'true')} className="min-h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-sm"><option value="unknown">待确认</option><option value="true">是</option><option value="false">否</option></select>;
}

export function TextInput({ label, value, onChange, suffix }: { label: string; value: string | null; onChange: (value: string | null) => void; suffix?: string }) {
  return <div className="flex min-w-0 flex-col gap-2"><span className="text-sm text-mute">{label}</span><Field suffix={suffix}><input aria-label={label} className={fieldInputClass} value={value ?? ''} placeholder="待确认" onChange={event => onChange(event.target.value || null)} /></Field></div>;
}
