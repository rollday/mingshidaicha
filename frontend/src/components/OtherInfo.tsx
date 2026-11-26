import { useEffect, useState } from 'react';
import { caseFactsSchema } from '../../../src/domain.ts';
import { Button, fieldInputClass } from './base/index.tsx';
import { TextInput, TriSelect } from './FieldCard.tsx';
import { RateField } from './FactsFold.tsx';
import { methodNames } from '../lib/format.ts';
import type { CaseFacts } from '../types/audit.ts';

export default function OtherInfo({ facts, onChange }: { facts: CaseFacts; onChange: (facts: CaseFacts) => void }) {
  const [json, setJson] = useState(''), [error, setError] = useState('');
  useEffect(() => { setJson(JSON.stringify(facts, null, 2)); }, [facts]);
  return <details className="mt-4 rounded-md border border-line bg-surface p-4">
    <summary className="cursor-pointer text-sm font-medium">其他背景与明示信息（可选填）</summary>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <TextInput label="借款用途" value={facts.borrower.purpose === 'unknown' ? null : facts.borrower.purpose} onChange={value => onChange({ ...facts, borrower: { ...facts.borrower, purpose: value ?? 'unknown' } })} />
      <div className="flex flex-col gap-2"><span className="text-sm text-mute">借款人是否为在校学生</span><TriSelect label="借款人是否为在校学生" value={facts.borrower.is_student} onChange={value => onChange({ ...facts, borrower: { ...facts.borrower, is_student: value } })} /></div>
      <div className="flex flex-col gap-2"><label htmlFor="funds" className="text-sm text-mute">资金实际付给谁</label><select id="funds" value={facts.funds_to} className="min-h-11 rounded-md border border-line-strong bg-surface px-3 text-sm" onChange={event => onChange({ ...facts, funds_to: event.target.value as CaseFacts['funds_to'] })}>{[['unknown', '待确认'], ['borrower', '借款人本人'], ['training_provider', '培训机构'], ['third_party', '其他第三方']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      <div className="flex flex-col gap-2"><label htmlFor="lender-type" className="text-sm text-mute">合同签约方类型</label><select id="lender-type" value={facts.lender.type} className="min-h-11 rounded-md border border-line-strong bg-surface px-3 text-sm" onChange={event => onChange({ ...facts, lender: { ...facts.lender, type: event.target.value as CaseFacts['lender']['type'] } })}>{[['unknown', '待确认'], ['bank', '银行'], ['consumer_finance', '消费金融公司'], ['microloan', '小额贷款公司'], ['platform', '平台'], ['other', '其他']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      {([['internet_consumer_loan', '是否互联网消费贷款'], ['internet_assisted', '是否互联网助贷'], ['licensed', '主体是否持有相关牌照']] as const).map(([key, label]) => <div key={key} className="flex flex-col gap-2"><span className="text-sm text-mute">{label}</span><TriSelect label={label} value={facts.lender[key]} onChange={value => onChange({ ...facts, lender: { ...facts.lender, [key]: value } })} /></div>)}
    </div>
    <div className="mt-4 border-t border-line pt-4">
      <h3 className="mb-3 text-base font-medium">明示信息核对</h3>
      <div className="grid gap-4 sm:grid-cols-3">
        {([['present', '是否提供明示表'], ['items_complete', '明示项目是否齐全'], ['contingent_disclosed', '是否披露或有成本']] as const).map(([key, label]) => <div key={key} className="flex flex-col gap-2"><span className="text-sm text-mute">{label}</span><TriSelect label={label} value={facts.disclosure[key]} onChange={value => onChange({ ...facts, disclosure: { ...facts.disclosure, [key]: value } })} /></div>)}
        <RateField label="明示表标注年化" value={facts.disclosure.quoted_apr} onChange={value => onChange({ ...facts, disclosure: { ...facts.disclosure, quoted_apr: value } })} />
        <div className="flex flex-col gap-2"><label htmlFor="quoted-method" className="text-sm text-mute">明示表年化口径</label><select id="quoted-method" value={facts.disclosure.quoted_method} className="min-h-11 rounded-md border border-line-strong bg-surface px-3 text-sm" onChange={event => onChange({ ...facts, disclosure: { ...facts.disclosure, quoted_method: event.target.value as CaseFacts['disclosure']['quoted_method'] } })}>{Object.entries(methodNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      </div>
    </div>
    <details className="mt-4 border-t border-line pt-4">
      <summary className="cursor-pointer text-sm text-ink-soft">完整数据编辑（含还款计划与特殊字段）</summary>
      <p className="mt-3 text-xs text-mute">金额和利率保留字符串，"0.12" 表示 12%。没有对应字段时保留 null 或 unknown。</p>
      <textarea aria-label="完整业务事实 JSON" spellCheck={false} className="mt-3 min-h-64 w-full rounded-md border border-line-strong bg-canvas p-3 font-mono text-xs" value={json} onChange={event => setJson(event.target.value)} />
      <Button onClick={() => { try { const result = caseFactsSchema.safeParse(JSON.parse(json)); if (!result.success) throw new Error(result.error.issues[0]?.message ?? '字段不符合协议'); onChange(result.data); setError(''); } catch (caught) { setError('未应用：' + (caught as Error).message); } }}>应用完整数据</Button>
      {error && <p role="alert" className="mt-3 text-sm text-ink-soft">{error}</p>}
    </details>
  </details>;
}
