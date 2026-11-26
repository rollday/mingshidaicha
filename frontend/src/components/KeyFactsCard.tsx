import { useEffect, useState } from 'react';
import type { CaseFacts, CaseSnapshot, Evidence } from '../types/audit.ts';
import type { FeePrefill } from '../../../shared/fee-prefill.ts';
import { Button, Card, Field, fieldInputClass } from './base/index.tsx';
import { money, percent } from '../lib/format.ts';
import { parseMoneyText } from '../lib/money-input.ts';
import { feeVerdict } from '../lib/fee-decision.ts';
import { feeEvidence } from '../lib/fee-review.ts';
import { TextInput, TriSelect } from './FieldCard.tsx';
import { RateField } from './FactsFold.tsx';

const timingNames: Record<string, string> = { upfront: '放款时一次', per_period: '每期', at_maturity: '到期', specific_period: '指定期数', unknown: '收费时间待确认' };
const repayNames: Record<string, string> = { equal_installment: '等额本息', equal_principal: '等额本金', interest_only: '先息后本', bullet: '到期一次还本付息', schedule: '按明确还款计划', unknown: '待确认' };
const roleNames: Record<string, string> = { disclosure: '明示表', contract: '合同', schedule: '还款计划', other: '材料' };

export function MoneyInput({ label, value, onCommit }: { label: string; value: string | null; onCommit: (value: string | null) => void }) {
  const [draft, setDraft] = useState(value ?? ''), [bad, setBad] = useState(false);
  useEffect(() => { setDraft(value ?? ''); setBad(false); }, [value]);
  const commit = (text: string) => {
    if (text.trim() === '') { setBad(false); setDraft(''); onCommit(null); return; }
    const parsed = parseMoneyText(text);
    if (parsed === null) { setBad(true); return; }
    setBad(false); onCommit(parsed);
  };
  return <div className="flex flex-col gap-1">
    <Field suffix="元"><input aria-label={label} inputMode="decimal" className={fieldInputClass} value={draft} placeholder="待填写" onChange={event => setDraft(event.target.value)} onBlur={() => commit(draft)} onKeyDown={event => { if (event.key === 'Enter') commit(draft); }} /></Field>
    {bad && <p role="alert" className="text-xs text-mute">这串数字没读懂，可以写成 10000 或 1万。</p>}
  </div>;
}

function FeeItem({ fee, index, facts, sourceFacts, evidence, materials, suggestion, onChange, onEvidence }: {
  fee: CaseFacts['fees'][number]; index: number; facts: CaseFacts; sourceFacts: CaseFacts; evidence: Evidence[];
  materials: CaseSnapshot['materials']; suggestion?: FeePrefill; onChange: (facts: CaseFacts) => void; onEvidence: (item: Evidence) => void;
}) {
  const [judging, setJudging] = useState(fee.included_in_cashflows === null);
  const verdict = feeVerdict(fee, facts, suggestion);
  const patch = (key: keyof CaseFacts['fees'][number], value: unknown) => onChange({ ...facts, fees: facts.fees.map((item, i) => i === index ? { ...item, [key]: value } : item) });
  const related = feeEvidence(fee.id, sourceFacts, evidence);
  const quote = related[0];
  const quoteRole = quote ? roleNames[materials.find(item => item.id === quote.document_id)?.role ?? 'other'] : null;
  const choose = (value: boolean | null) => { patch('included_in_cashflows', value); if (value !== null) setJudging(false); };
  return <div className="flex flex-col gap-3 rounded-md border border-amber-line/50 bg-amber-bg/50 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="font-medium">{fee.name || '待确认费用'}<span className="ml-2 text-sm font-normal text-mute">{timingNames[fee.timing]}</span></p>
      <Button variant="chip" onClick={() => onChange({ ...facts, fees: facts.fees.filter((_, i) => i !== index) })}>删除</Button>
    </div>
    {fee.contingent !== true && <div className="max-w-48"><MoneyInput label={`${fee.name || '这项费用'}的金额`} value={fee.amount} onCommit={value => patch('amount', value)} /></div>}
    <p className="text-sm text-ink-soft"><b className="text-ink">{verdict.sentence}</b>{verdict.detail}</p>
    {judging && <div role="radiogroup" aria-label="这笔费用算在里面还是另收" className="flex flex-wrap gap-2">
      {([['算在里面', true], ['另收', false], ['不清楚', null]] as const).map(([label, value]) => <Button key={label} variant="chip" pressed={fee.included_in_cashflows === value} onClick={() => choose(value)}>{label}</Button>)}
    </div>}
    {fee.included_in_cashflows === true && <p role="note" className="text-xs text-amber">选了「算在里面」，这笔钱就要和{facts.loan.period_payment != null ? `每期还款额 ${money(facts.loan.period_payment)}` : '每期还款额'}、{facts.loan.nominal_apr != null ? `合同利率 ${percent(facts.loan.nominal_apr)}` : '合同利率'} 同时对得上；对不上会算不出年化。如果合同写的是另收，请改回「另收」，或先核对还款额和利率。</p>}
    <div className="flex flex-wrap items-center gap-2">
      {quote ? <Button variant="chip" onClick={() => onEvidence(quote)}>看{quoteRole}原文</Button> : <span className="text-xs text-mute">没有可定位的原文</span>}
      <Button variant="chip" onClick={() => setJudging(value => !value)}>{judging ? '收起' : '改判断'}</Button>
    </div>
    <details className="border-t border-amber-line/30 pt-3">
      <summary className="cursor-pointer text-sm text-ink-soft">收费时间、主体与其他设置</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <TextInput label="费用名称" value={fee.name} onChange={value => patch('name', value ?? '')} />
        <TextInput label="收取主体" value={fee.payee} onChange={value => patch('payee', value)} />
        <div className="flex flex-col gap-2"><label htmlFor={`timing-${fee.id}`} className="text-sm text-mute">收费时间</label>
          <select id={`timing-${fee.id}`} value={fee.timing} className="min-h-11 rounded-md border border-line-strong bg-surface px-3 text-sm" onChange={event => patch('timing', event.target.value)}>
            {[['unknown', '待确认'], ['per_period', '每期收取'], ['upfront', '放款时一次收取'], ['at_maturity', '到期收取'], ['specific_period', '指定期数']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        {fee.timing === 'specific_period' && <div className="flex flex-col gap-2"><label htmlFor={`period-${fee.id}`} className="text-sm text-mute">收取期数（0 表示放款时）</label>
          <input id={`period-${fee.id}`} type="number" min="0" max="600" className="min-h-11 rounded-md border border-line-strong bg-surface px-3 text-sm" value={fee.period ?? ''} onChange={event => patch('period', event.target.value === '' ? null : Number(event.target.value))} />
        </div>}
        <div className="flex flex-col gap-2"><span className="text-sm text-mute">是否列在明示表</span><TriSelect label="是否列在明示表" value={fee.in_disclosure} onChange={value => patch('in_disclosure', value)} /></div>
        <div className="flex flex-col gap-2"><span className="text-sm text-mute">是否计入披露的年化合计</span><TriSelect label="是否计入披露的年化合计" value={fee.included_in_disclosed_cost} onChange={value => patch('included_in_disclosed_cost', value)} /></div>
        <div className="flex flex-col gap-2"><span className="text-sm text-mute">是否只在违约等情况下产生</span><TriSelect label="是否只在违约等情况下产生" value={fee.contingent} onChange={value => patch('contingent', value)} /></div>
      </div>
    </details>
  </div>;
}

export default function KeyFactsCard({ facts, sourceFacts, current, onChange, onEvidence, suggestions }: {
  facts: CaseFacts; sourceFacts: CaseFacts; current: CaseSnapshot; onChange: (facts: CaseFacts) => void; onEvidence: (item: Evidence) => void;
  suggestions: FeePrefill[];
}) {
  const manual = current.materials.length === 0;
  const loan = (key: keyof CaseFacts['loan'], value: unknown) => onChange({ ...facts, loan: { ...facts.loan, [key]: value } });
  return <Card className="flex min-w-0 flex-col gap-4">
    <h2 className="text-lg font-medium">{manual ? '填写并核对' : '读到的字段'}</h2>
    <p className="text-sm text-mute">{manual ? '这次没有上传材料，下面几项按合同或明示表填上；金额留空表示未知，不会当成零。' : '先看这里对不对；读错了才动它。金额留空表示未知，不会当成零。'}</p>
    <div className="grid gap-3 text-sm sm:grid-cols-2">
      {manual ? <>
        <div><p className="text-mute">贷款本金</p><MoneyInput label="贷款本金" value={facts.loan.principal} onCommit={value => loan('principal', value)} /></div>
        <div><p className="text-mute">期数与方式</p><div className="mt-1 flex gap-2">
          <Field className="w-24 shrink-0"><input aria-label="还款期数" type="number" min={1} max={600} className={fieldInputClass} value={facts.loan.term_periods ?? ''} placeholder="待填写" onChange={event => loan('term_periods', event.target.value === '' ? null : Number(event.target.value))} /></Field>
          <select aria-label="还款方式" className="min-h-11 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-3 text-sm" value={facts.loan.repay_method} onChange={event => loan('repay_method', event.target.value as CaseFacts['loan']['repay_method'])}>
            {Object.entries(repayNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div></div>
        <div><p className="text-mute">每期还本息</p><MoneyInput label="每期还本息" value={facts.loan.period_payment} onCommit={value => loan('period_payment', value)} /></div>
        <div><p className="text-mute">表内标注年化</p><RateField label="表内标注年化" value={facts.disclosure.quoted_apr} onChange={value => onChange({ ...facts, disclosure: { ...facts.disclosure, quoted_apr: value } })} /></div>
        <div><p className="text-mute">放款日期</p><Field><input aria-label="放款日期" type="date" className={fieldInputClass} value={facts.loan.start_date ?? ''} onChange={event => loan('start_date', event.target.value || null)} /></Field></div>
        <div><p className="text-mute">放贷方（合同签约方）</p><Field><input aria-label="放贷方" className={fieldInputClass} value={facts.lender.name ?? ''} placeholder="待填写" onChange={event => onChange({ ...facts, lender: { ...facts.lender, name: event.target.value || null } })} /></Field></div>
      </> : <>
        <div><p className="text-mute">贷款本金</p><p className="num text-base font-medium">{money(facts.loan.principal)}</p></div>
        <div><p className="text-mute">期数与方式</p><p className="text-base font-medium">{facts.loan.term_periods === null ? '待确认' : `${facts.loan.term_periods} 期`}，{repayNames[facts.loan.repay_method] ?? '待确认'}</p></div>
        <div><p className="text-mute">每期还本息</p><p className="num text-base font-medium">{money(facts.loan.period_payment)}</p></div>
        <div><p className="text-mute">表内标注年化</p><p className="num text-base font-medium">{percent(facts.disclosure.quoted_apr)}</p></div>
        <div className="sm:col-span-2"><p className="text-mute">放贷方（合同签约方）</p><p className="text-base font-medium">{facts.lender.name || '待确认'}</p></div>
      </>}
    </div>
    {facts.fees.map((fee, index) => <FeeItem key={fee.id} fee={fee} index={index} facts={facts} sourceFacts={sourceFacts} evidence={current.evidence} materials={current.materials}
      suggestion={suggestions.find(item => item.fee_id === fee.id)} onChange={onChange} onEvidence={onEvidence} />)}
    <Button className="justify-start" onClick={() => onChange({ ...facts, fees: [...facts.fees, { id: crypto.randomUUID(), name: '待确认费用', amount: null, timing: 'unknown', period: null, payee: null, payee_type: 'unknown', in_disclosure: null, included_in_cashflows: null, included_in_disclosed_cost: null, contingent: false }] })}>
      ＋ 添加额外费用<span className="ml-2 text-xs font-normal text-mute">合同里还有别的收费，补在这里</span>
    </Button>
  </Card>;
}
