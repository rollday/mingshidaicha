import { useRef, useState } from 'react';
import { inferFeePrefills, type FeePrefill } from '../../../shared/fee-prefill.ts';
import { invalidateFeePrefills, manualFeeEdits } from '../lib/fee-review.ts';
import { caseFactsSchema } from '../../../src/domain.ts';
import { Button, Card } from '../components/base/index.tsx';
import FieldCard from '../components/FieldCard.tsx';
import RecheckCard from '../components/RecheckCard.tsx';
import SourceCard from '../components/SourceCard.tsx';
import type { PageLoader } from '../components/DocumentPage.tsx';
import { LoadingSteps } from './Upload.tsx';
import type { CaseFacts, CaseSnapshot, DocumentParsed, Evidence } from '../types/audit.ts';

export function StickyBar({ busy, onConfirm, onReset, onCancel }: { busy:boolean;onConfirm:()=>void;onReset:()=>void;onCancel:()=>void }) {
  return <div className="sticky bottom-0 z-30 -mx-gutter mt-6 border-t border-line bg-surface/80 px-gutter py-4 backdrop-blur-xl"><div className="flex flex-wrap items-center gap-3"><Button variant="primary" loading={busy} onClick={onConfirm}>{busy ? '正在核算和生成报告' : '确认，生成报告'}</Button>{busy ? <Button onClick={onCancel}>取消任务</Button> : <Button onClick={onReset}>重新选择</Button>}<span className="text-xs text-mute">每处修改都会保留在报告中。</span></div></div>;
}
export default function Confirm({ current, parsed, busy, stage, onConfirm, onReset, onCancel,loadPage }: { current:CaseSnapshot;parsed:Record<string,DocumentParsed>;busy:boolean;stage:string;onConfirm:(facts:CaseFacts,prefillFeeIds?:string[])=>void;onReset:()=>void;onCancel:()=>void;loadPage:PageLoader }) {
  const [facts, setFacts] = useState<CaseFacts>(() => structuredClone(current.facts));
  const sourceFacts = (current as CaseSnapshot & { source_facts?: CaseFacts }).source_facts ?? current.facts;
  const edited = useRef(manualFeeEdits(current));
  const adoptedHere = useRef(new Set<string>());
  const [applied, setApplied] = useState<FeePrefill[]>(() => (current as CaseSnapshot & { fee_prefills?: FeePrefill[] }).fee_prefills ?? []);
  const [basisNotice, setBasisNotice] = useState('');
  const suggestions = inferFeePrefills(facts, current.evidence, current.conflicts, sourceFacts);
  const changeFacts = (next: CaseFacts) => {
    for (const fee of next.fees) {
      const before = facts.fees.find(item => item.id === fee.id);
      if (before && before.included_in_cashflows !== fee.included_in_cashflows) edited.current.add(fee.id);
    }
    const checked = invalidateFeePrefills(facts, next, applied, edited.current);
    if (checked.fees.some((fee,index) => fee.included_in_cashflows !== next.fees[index]?.included_in_cashflows)) setBasisNotice('到账、还款或费用基准已修改，相关自动预填已恢复为待确认，请按新金额重新核对。');
    setFacts(checked);
  };
  const applySuggestions = () => {
    const eligible = suggestions.filter(item => !edited.current.has(item.fee_id) && facts.fees.find(fee => fee.id === item.fee_id)?.included_in_cashflows === null);
    setFacts({ ...facts, fees: facts.fees.map(fee => { const suggestion = eligible.find(item => item.fee_id === fee.id); return suggestion ? { ...fee, included_in_cashflows: suggestion.value } : fee; }) });
    for (const suggestion of eligible) adoptedHere.current.add(suggestion.fee_id);
    setApplied(previous => [...previous.filter(item => !eligible.some(next => next.fee_id === item.fee_id)), ...eligible]);
    setBasisNotice('已按合同条款预填；请对照原文核对，可逐项修改。');
  };
  const priorityQuestions = current.questions.filter(item => /^(?:facts\.)?(?:loan[.\[]|repayments[.\[]|fees[.\[])/.test(item.field));
  const otherQuestions = current.questions.filter(item => !priorityQuestions.includes(item));
  const [focused, setFocused] = useState<Evidence | null>(null), [error, setError] = useState('');
  return <section className="animate-rise"><h1 className="font-serif text-display font-bold">确认读取结果</h1><p className="mt-3 text-ink-soft">先对照原文，再确认实际到账、每期还款和另收费用。未知信息可以保留，报告会说明限制。</p>{priorityQuestions.length > 0 && <Card inset className="mt-5"><p className="text-sm font-medium">还有信息需要你核对</p><ul className="mt-2 list-inside list-disc text-sm text-mute">{priorityQuestions.map((question,index) => <li key={index}>{question.question}</li>)}</ul></Card>}
    {otherQuestions.length > 0 && <details className="mt-4 rounded-md border border-line p-4"><summary className="cursor-pointer text-sm font-medium">其他待确认信息（{otherQuestions.length} 项）</summary><ul className="mt-2 list-inside list-disc text-sm text-mute">{otherQuestions.map((question,index) => <li key={index}>{question.question}</li>)}</ul></details>}
    {current.conflicts.length > 0 && <Card inset tone="amber" className="mt-4"><h2 className="text-sm font-medium">材料中的冲突</h2>{current.conflicts.map((conflict,index) => <p key={index} className="mt-2 text-sm">{conflict.description}</p>)}</Card>}
    <fieldset disabled={busy} className="mt-6 min-w-0"><div className="grid items-start gap-6 sm:grid-cols-2"><SourceCard current={current} parsed={parsed} focused={focused} loadPage={loadPage} /><FieldCard facts={facts} current={current} onChange={changeFacts} onEvidence={item => { setFocused(item); document.getElementById('source-card')?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'}); }} /></div><div className="mt-6"><RecheckCard facts={facts} sourceFacts={sourceFacts} evidence={current.evidence} suggestions={suggestions} applied={applied} edited={edited.current} onApply={applySuggestions} onEvidence={item => { setFocused(item); document.getElementById('source-card')?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'}); }} onChange={changeFacts} /></div></fieldset>
    {basisNotice && <p role="status" className="mt-4 text-sm text-ink-soft">{basisNotice}</p>}{error && <p role="alert" className="mt-4 text-sm text-ink-soft">{error}</p>}{busy && <LoadingSteps stage={stage} onCancel={onCancel} />}
    <StickyBar busy={busy} onCancel={onCancel} onReset={onReset} onConfirm={() => { const parsed = caseFactsSchema.safeParse(facts); if (!parsed.success) { const first = parsed.error.issues[0]; setError(`请核对 ${first?.path.join('.')}：${first?.message}`); return; } setError(''); const prefillFeeIds = suggestions.filter(item => adoptedHere.current.has(item.fee_id) && !edited.current.has(item.fee_id) && parsed.data.fees.find(fee => fee.id === item.fee_id)?.included_in_cashflows === item.value).map(item => item.fee_id); onConfirm(parsed.data, prefillFeeIds); }} />
  </section>;
}
