import { useEffect, useRef, useState } from 'react';
import { inferFeePrefills, type FeePrefill } from '../../../shared/fee-prefill.ts';
import { invalidateFeePrefills, manualFeeEdits } from '../lib/fee-review.ts';
import { caseFactsSchema } from '../../../src/domain.ts';
import { Button, Card } from '../components/base/index.tsx';
import SourceCard from '../components/SourceCard.tsx';
import KeyFactsCard from '../components/KeyFactsCard.tsx';
import FactsFold from '../components/FactsFold.tsx';
import OtherInfo from '../components/OtherInfo.tsx';
import type { PageLoader } from '../components/DocumentPage.tsx';
import { LoadingSteps } from './Upload.tsx';
import { booleanFact, feeBlockers, feeGaps, routeQuestion, setBooleanFact } from '../lib/fee-decision.ts';
import { createDraftGuard, DraftGuardContext, useDraftBlocker } from '../lib/draft-guard.ts';
import type { CaseFacts, CaseSnapshot, DocumentParsed, Evidence } from '../types/audit.ts';

export function StickyBar({ busy, onConfirm, onReset, onCancel }: { busy: boolean; onConfirm: () => void; onReset: () => void; onCancel: () => void }) {
  return <div className="sticky bottom-0 z-30 -mx-gutter mt-6 border-t border-line bg-surface/80 px-gutter py-4 backdrop-blur-xl"><div className="flex flex-wrap items-center gap-3"><Button variant="primary" loading={busy} onClick={onConfirm}>{busy ? '正在核算和生成报告' : '确认，生成报告'}</Button>{busy ? <Button onClick={onCancel}>取消任务</Button> : <Button onClick={onReset}>重新选择</Button>}<span className="text-xs text-mute">每处修改都会保留在报告中。</span></div></div>;
}

function labelsFor(field: string): [string, string, string] {
  return /licensed|牌照/.test(field) ? ['有', '没有', '不清楚'] : ['是', '不是', '不清楚'];
}

function helperFor(field: string): string | null {
  if (/licensed|牌照/.test(field)) return '认不准就选不清楚，报告会列为待核实。';
  if (/internet_consumer_loan/.test(field)) return '决定适用哪一组规则。';
  if (/quoted_apr/.test(field)) return '明示表里没写这一项，需要对着原文核对。';
  return null;
}

function AskCard({ current, facts, onChange, onEvidence }: { current: CaseSnapshot; facts: CaseFacts; onChange: (facts: CaseFacts) => void; onEvidence: (item: Evidence) => void }) {
  if (!current.questions.length) return null;
  return <Card className="mt-6">
    <h2 className="text-lg font-medium">再确认几件事</h2>
    <p className="mt-1 text-sm text-mute">材料里没写，只有你知道。答不上来就选“不清楚”，报告会写明没核实。</p>
    <div className="mt-4 flex flex-col">
      {current.questions.map((question, index) => {
        const route = routeQuestion(question.field, current.evidence);
        const helper = helperFor(question.field);
        const [yes, no, unsure] = labelsFor(question.field);
        const value = booleanFact(facts, question.field);
        return <div key={index} className="flex flex-col gap-3 border-t border-line py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0"><p className="text-sm">{question.question}</p>{helper && <p className="mt-1 text-xs text-mute">{helper}</p>}</div>
          {route.kind === 'boolean' ? <div role="radiogroup" aria-label={question.question} className="flex shrink-0 flex-wrap gap-2">
            {([[yes, true], [no, false], [unsure, null]] as const).map(([label, option]) => <Button key={label} variant="chip" pressed={value === option} onClick={() => onChange(setBooleanFact(facts, question.field, option))}>{label}</Button>)}
          </div> : route.kind === 'self-check' && route.evidence ? <Button variant="chip" className="shrink-0 self-start" onClick={() => onEvidence(route.evidence!)}>去核对原文</Button>
            : <span className="text-xs text-mute">材料里没有这一项，报告会写“未核实”。</span>}
        </div>;
      })}
    </div>
  </Card>;
}

export default function Confirm({ current, parsed, busy, stage, onConfirm, onReset, onCancel, loadPage }: { current: CaseSnapshot; parsed: Record<string, DocumentParsed>; busy: boolean; stage: string; onConfirm: (facts: CaseFacts, prefillFeeIds?: string[]) => void; onReset: () => void; onCancel: () => void; loadPage: PageLoader }) {
  const [facts, setFacts] = useState<CaseFacts>(() => structuredClone(current.facts));
  const sourceFacts = (current as CaseSnapshot & { source_facts?: CaseFacts }).source_facts ?? current.facts;
  const edited = useRef(manualFeeEdits(current));
  const adoptedHere = useRef(new Set<string>());
  const autoApplied = useRef(false);
  const [applied, setApplied] = useState<FeePrefill[]>(() => (current as CaseSnapshot & { fee_prefills?: FeePrefill[] }).fee_prefills ?? []);
  const [basisNotice, setBasisNotice] = useState('');
  const [focused, setFocused] = useState<Evidence | null>(null), [error, setError] = useState('');
  const [draftGuard] = useState(createDraftGuard);
  const draftBlocker = useDraftBlocker(draftGuard);
  const suggestions = inferFeePrefills(facts, current.evidence, current.conflicts, sourceFacts);
  const manual = current.materials.length === 0;
  const gaps = feeGaps(facts);
  const changeFacts = (next: CaseFacts) => {
    for (const fee of next.fees) {
      const before = facts.fees.find(item => item.id === fee.id);
      if (before && before.included_in_cashflows !== fee.included_in_cashflows) edited.current.add(fee.id);
    }
    const checked = invalidateFeePrefills(facts, next, applied, edited.current);
    if (checked.fees.some((fee, index) => fee.included_in_cashflows !== next.fees[index]?.included_in_cashflows)) setBasisNotice('到账、还款或费用基准已修改，相关自动预填已恢复为待确认，请按新金额重新核对。');
    setFacts(checked);
  };
  const applySuggestions = (announce = true) => {
    const eligible = suggestions.filter(item => !edited.current.has(item.fee_id) && facts.fees.find(fee => fee.id === item.fee_id)?.included_in_cashflows === null);
    if (!eligible.length) {
      if (announce) setBasisNotice('合同条款还不足以判定这项费用，请按原文选一下。');
      return;
    }
    setFacts(currentFacts => ({ ...currentFacts, fees: currentFacts.fees.map(fee => {
      const suggestion = eligible.find(item => item.fee_id === fee.id);
      return suggestion ? { ...fee, included_in_cashflows: suggestion.value } : fee;
    }) }));
    for (const suggestion of eligible) adoptedHere.current.add(suggestion.fee_id);
    setApplied(previous => [...previous.filter(item => !eligible.some(next => next.fee_id === item.fee_id)), ...eligible]);
    if (announce) setBasisNotice('已按合同条款预填；请对照原文核对，可逐项修改。');
  };
  useEffect(() => {
    if (autoApplied.current) return;
    autoApplied.current = true;
    applySuggestions(false);
  }, []);
  const showEvidence = (item: Evidence) => {
    setFocused(item);
    document.getElementById('source-card')?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  return <DraftGuardContext.Provider value={draftGuard}><section className="animate-rise"><h1 className="font-serif text-display font-bold">{manual ? '填写这笔借款的信息' : '确认读取结果'}</h1><p className="mt-3 text-ink-soft">{manual ? '没有上传材料，按合同或明示表把实际到账、每期还款和另收费用填好。未知信息可以保留，报告会说明限制。' : '先对照原文，再确认实际到账、每期还款和另收费用。未知信息可以保留，报告会说明限制。'}</p>
    {current.conflicts.length > 0 && <Card inset tone="amber" className="mt-4"><h2 className="text-sm font-medium">材料中的冲突</h2>{current.conflicts.map((conflict, index) => <p key={index} className="mt-2 text-sm">{conflict.description}</p>)}</Card>}
    <fieldset disabled={busy} className="mt-6 min-w-0">
      {manual ? <><p className="mb-4 text-sm text-mute">手工录入，没有材料原文可对照；按合同或明示表填下面几项即可。</p>
        <KeyFactsCard facts={facts} sourceFacts={sourceFacts} current={current} onChange={changeFacts} onEvidence={showEvidence} suggestions={suggestions} /></>
        : <div className="grid items-start gap-6 sm:grid-cols-2">
          <SourceCard current={current} parsed={parsed} focused={focused} loadPage={loadPage} />
          <KeyFactsCard facts={facts} sourceFacts={sourceFacts} current={current} onChange={changeFacts} onEvidence={showEvidence} suggestions={suggestions} />
        </div>}
      <AskCard current={current} facts={facts} onChange={changeFacts} onEvidence={showEvidence} />
      <FactsFold facts={facts} current={current} onChange={changeFacts} />
      <OtherInfo facts={facts} onChange={changeFacts} />
    </fieldset>
    {draftBlocker && <p role="status" className="mt-4 text-sm text-amber">{draftBlocker}</p>}
    {gaps.length > 0 && <p role="status" className="mt-4 text-sm text-amber">还有 {gaps.length} 项没核实：{gaps[0]}{gaps.length > 1 ? `（共 ${gaps.length} 项）` : ''} 可以留空提交，报告会写明这一项没核实。</p>}
    {basisNotice && <p role="status" className="mt-4 text-sm text-ink-soft">{basisNotice}</p>}{error && <p role="alert" className="mt-4 text-sm text-ink-soft">{error}</p>}{busy && <LoadingSteps stage={stage} onCancel={onCancel} />}
    <StickyBar busy={busy} onCancel={onCancel} onReset={onReset} onConfirm={() => {
      if (draftGuard.blocker()) return;
      const parsedFacts = caseFactsSchema.safeParse(facts);
      if (!parsedFacts.success) { const first = parsedFacts.error.issues[0]; setError(`请核对 ${first?.path.join('.')}：${first?.message}`); return; }
      const blockers = feeBlockers(parsedFacts.data);
      if (blockers.length) { setError(blockers[0]!); return; }
      setError('');
      const prefillFeeIds = suggestions.filter(item => adoptedHere.current.has(item.fee_id) && !edited.current.has(item.fee_id) && parsedFacts.data.fees.find(fee => fee.id === item.fee_id)?.included_in_cashflows === item.value).map(item => item.fee_id);
      onConfirm(parsedFacts.data, prefillFeeIds);
    }} />
  </section></DraftGuardContext.Provider>;
}
