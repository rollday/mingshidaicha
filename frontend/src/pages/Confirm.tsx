import { useState } from 'react';
import { caseFactsSchema } from '../../../src/domain.ts';
import { Button, Card } from '../components/base/index.tsx';
import FieldCard from '../components/FieldCard.tsx';
import RecheckCard from '../components/RecheckCard.tsx';
import SourceCard from '../components/SourceCard.tsx';
import { LoadingSteps } from './Upload.tsx';
import type { CaseFacts, CaseSnapshot, DocumentParsed, Evidence } from '../types/audit.ts';

export function StickyBar({ busy, onConfirm, onReset, onCancel }: { busy:boolean;onConfirm:()=>void;onReset:()=>void;onCancel:()=>void }) {
  return <div className="sticky bottom-0 z-30 -mx-gutter mt-6 border-t border-line bg-surface/80 px-gutter py-4 backdrop-blur-xl"><div className="flex flex-wrap items-center gap-3"><Button variant="primary" loading={busy} onClick={onConfirm}>{busy ? '正在核算和生成报告' : '确认，生成报告'}</Button>{busy ? <Button onClick={onCancel}>取消任务</Button> : <Button onClick={onReset}>重新选择</Button>}<span className="text-xs text-mute">每处修改都会保留在报告中。</span></div></div>;
}
export default function Confirm({ current, parsed, busy, stage, onConfirm, onReset, onCancel }: { current:CaseSnapshot;parsed:Record<string,DocumentParsed>;busy:boolean;stage:string;onConfirm:(facts:CaseFacts)=>void;onReset:()=>void;onCancel:()=>void }) {
  const [facts, setFacts] = useState<CaseFacts>(() => structuredClone(current.facts));
  const [focused, setFocused] = useState<Evidence | null>(null), [error, setError] = useState('');
  return <section className="animate-rise"><h1 className="font-serif text-display font-bold">确认读取结果</h1><p className="mt-3 text-ink-soft">先对照原文，再确认实际到账、每期还款和另收费用。未知信息可以保留，报告会说明限制。</p>{current.questions.length > 0 && <Card inset className="mt-5"><p className="text-sm font-medium">还有信息需要你核对</p><ul className="mt-2 list-inside list-disc text-sm text-mute">{current.questions.map((question,index) => <li key={index}>{question.question}</li>)}</ul></Card>}
    {current.conflicts.length > 0 && <Card inset tone="amber" className="mt-4"><h2 className="text-sm font-medium">材料中的冲突</h2>{current.conflicts.map((conflict,index) => <p key={index} className="mt-2 text-sm">{conflict.description}</p>)}</Card>}
    <fieldset disabled={busy} className="mt-6 min-w-0"><div className="grid items-start gap-6 sm:grid-cols-2"><SourceCard current={current} parsed={parsed} focused={focused} /><FieldCard facts={facts} current={current} onChange={setFacts} onEvidence={item => { setFocused(item); document.getElementById('source-card')?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'}); }} /></div><div className="mt-6"><RecheckCard facts={facts} onChange={setFacts} /></div></fieldset>
    {error && <p role="alert" className="mt-4 text-sm text-ink-soft">{error}</p>}{busy && <LoadingSteps stage={stage} onCancel={onCancel} />}
    <StickyBar busy={busy} onCancel={onCancel} onReset={onReset} onConfirm={() => { const parsed = caseFactsSchema.safeParse(facts); if (!parsed.success) { const first = parsed.error.issues[0]; setError(`请核对 ${first?.path.join('.')}：${first?.message}`); return; } setError(''); onConfirm(parsed.data); }} />
  </section>;
}
