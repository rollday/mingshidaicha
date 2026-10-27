import { useEffect, useRef, useState } from 'react';
import { caseFactsSchema } from '../../../src/domain.ts';
import { Button, Card, Field, Tag, fieldInputClass } from './base/index.tsx';
import type { CaseFacts, CaseSnapshot, Evidence } from '../types/audit.ts';
import { shiftDecimal, methodNames } from '../lib/format.ts';

export function ConfidenceTag({ evidenced }: { evidenced: boolean }) { return <Tag tone={evidenced ? 'neutral' : 'amber'}>{evidenced ? '有原文，待核对' : '待补充依据'}</Tag>; }
export function TriSelect({ value, onChange, label }: { value: boolean | null; onChange: (value: boolean | null) => void; label: string }) {
  return <select aria-label={label} value={value === null ? 'unknown' : String(value)} onChange={event => onChange(event.target.value === 'unknown' ? null : event.target.value === 'true')} className="min-h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-sm"><option value="unknown">待确认</option><option value="true">是</option><option value="false">否</option></select>;
}
export function TextInput({ label, value, onChange, suffix }: { label: string; value: string | null; onChange: (value: string | null) => void; suffix?: string }) {
  return <div className="flex min-w-0 flex-col gap-2"><span className="text-sm text-mute">{label}</span><Field suffix={suffix}><input aria-label={label} className={fieldInputClass} value={value ?? ''} placeholder="待确认" onChange={event => onChange(event.target.value || null)} /></Field></div>;
}
function RateInput({ label, value, onChange }: { label: string; value: string | null; onChange: (value: string | null) => void }) {
  const [raw, setRaw] = useState(value === null ? '' : shiftDecimal(value, 2));
  const lastValue = useRef(value);
  useEffect(() => { if (value !== lastValue.current) { lastValue.current = value; setRaw(value === null ? '' : shiftDecimal(value, 2)); } }, [value]);
  return <div className="flex flex-col gap-2"><span className="text-sm text-mute">{label}</span><Field suffix="%"><input aria-label={label} inputMode="decimal" className={fieldInputClass} value={raw} placeholder="待确认" onChange={event => { const text = event.target.value; if (!/^\d*(?:\.\d*)?$/.test(text)) return; setRaw(text); const normalized = text === '' || text === '.' ? null : shiftDecimal(text,-2); lastValue.current = normalized; onChange(normalized); }} /></Field></div>;
}
const evidenceNames: Record<string,string> = { 'loan.principal':'本金', 'loan.disbursed':'到账', 'loan.period_payment':'每期还款', 'loan.start_date':'放款日期', 'loan.repay_method':'还款方式', 'loan.term_periods':'期数', 'loan.nominal_apr':'合同利率', 'lender.name':'放贷方', 'lender.type':'机构类型', 'lender.internet_consumer_loan':'产品类型', 'lender.internet_assisted':'助贷属性', 'disclosure.present':'明示表', 'disclosure.quoted_apr':'标注年化', 'disclosure.quoted_method':'年化口径', 'disclosure.items_complete':'明示项目', 'disclosure.contingent_disclosed':'或有成本披露' };
export default function FieldCard({ facts, current, onChange, onEvidence }: { facts: CaseFacts; current: CaseSnapshot; onChange: (facts: CaseFacts) => void; onEvidence: (evidence: Evidence) => void }) {
  const [json, setJson] = useState(''), [error, setError] = useState('');
  useEffect(() => { setJson(JSON.stringify(facts, null, 2)); }, [facts]);
  const loan = (key: keyof CaseFacts['loan'], value: unknown) => onChange({ ...facts, loan: { ...facts.loan, [key]: value } });
  const evidence = (field: string) => current.evidence.find(item => item.field === field || item.field.startsWith(field + '.'));
  const primary = current.evidence.filter(item => /^(loan\.(principal|disbursed|period_payment)|lender.name|disclosure.quoted_apr)$/.test(item.field) || /^fees(?:\[|\.).*\.(amount|payee)$/.test(item.field));
  const evidenceButton = (item: Evidence) => <Button key={item.id} variant="chip" onClick={() => onEvidence(item)}>{evidenceNames[item.field] ?? (/fees/.test(item.field) ? '费用原文' : '其他原文')} · 查看依据</Button>;
  return <Card className="flex min-w-0 flex-col gap-4"><h2 className="text-lg font-medium">读到的字段</h2><p className="text-sm text-mute">金额留空表示未知，不会自动当成零。这里的依据标签不代表模型置信度。</p><div className="grid gap-4 sm:grid-cols-2">
    <TextInput label="合同本金" value={facts.loan.principal} suffix="元" onChange={value => loan('principal', value)} />
    <TextInput label="实际到账" value={facts.loan.disbursed} suffix="元" onChange={value => loan('disbursed', value)} />
    <TextInput label="每期还本息" value={facts.loan.period_payment} suffix="元" onChange={value => loan('period_payment', value)} />
    <div className="flex flex-col gap-2"><label htmlFor="term" className="text-sm text-mute">还款期数</label><Field suffix="期"><input id="term" className={fieldInputClass} type="number" min="1" max="600" placeholder="待确认" value={facts.loan.term_periods ?? ''} onChange={event => loan('term_periods', event.target.value === '' ? null : Number(event.target.value))} /></Field></div>
    <div className="flex flex-col gap-2"><label htmlFor="repay" className="text-sm text-mute">还款方式</label><select id="repay" className="min-h-11 rounded-md border border-line-strong bg-surface px-3 text-sm" value={facts.loan.repay_method} onChange={event => loan('repay_method', event.target.value)}>{[['unknown','待确认'],['equal_installment','等额本息'],['equal_principal','等额本金'],['interest_only','先息后本'],['bullet','到期一次还本付息'],['schedule','按明确还款计划']].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></div>
    <div className="flex flex-col gap-2"><label htmlFor="start-date" className="text-sm text-mute">放款日期</label><Field><input id="start-date" type="date" className={fieldInputClass} value={facts.loan.start_date ?? ''} onChange={event => loan('start_date', event.target.value || null)} /></Field></div>
    <RateInput label="合同名义年利率" value={facts.loan.nominal_apr} onChange={value => loan('nominal_apr',value)} />
    <RateInput label="明示表标注年化" value={facts.disclosure.quoted_apr} onChange={value => onChange({...facts,disclosure:{...facts.disclosure,quoted_apr:value}})} />
    <div className="flex flex-col gap-2"><label htmlFor="quoted-method" className="text-sm text-mute">明示表年化口径</label><select id="quoted-method" className="min-h-11 rounded-md border border-line-strong bg-surface px-3 text-sm" value={facts.disclosure.quoted_method} onChange={event => onChange({...facts,disclosure:{...facts.disclosure,quoted_method:event.target.value as CaseFacts['disclosure']['quoted_method']}})}>{Object.entries(methodNames).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></div>
  </div><TextInput label="放贷方（合同签约方）" value={facts.lender.name} onChange={value => onChange({ ...facts, lender: { ...facts.lender, name: value } })} />
    <div className="flex flex-wrap items-center gap-2"><ConfidenceTag evidenced={Boolean(evidence('loan.principal'))} />{primary.map(evidenceButton)}</div>
    {current.evidence.length > primary.length && <details><summary className="cursor-pointer text-sm text-mute">其他字段的原文依据</summary><div className="mt-3 flex flex-wrap gap-2">{current.evidence.filter(item => !primary.includes(item)).map(evidenceButton)}</div></details>}
    <details className="border-t border-line pt-4"><summary className="cursor-pointer text-sm text-ink-soft">完整数据编辑（含年化口径、费用和特殊还款计划）</summary><p className="mt-3 text-xs text-mute">金额和利率保留字符串，"0.12" 表示 12%。没有对应字段时保留 null 或 unknown。</p><textarea aria-label="完整业务事实 JSON" spellCheck={false} className="mt-3 min-h-64 w-full rounded-md border border-line-strong bg-canvas p-3 font-mono text-xs" value={json} onChange={event => setJson(event.target.value)} /><Button onClick={() => { try { const result = caseFactsSchema.safeParse(JSON.parse(json)); if (!result.success) throw new Error(result.error.issues[0]?.message ?? '字段不符合协议'); onChange(result.data); setError(''); } catch (error) { setError('未应用：' + (error as Error).message); } }}>应用完整数据</Button>{error && <p role="alert" className="mt-3 text-sm text-ink-soft">{error}</p>}</details>
  </Card>;
}
