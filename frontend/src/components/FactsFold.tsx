import { useEffect, useState } from 'react';
import type { CaseFacts, CaseSnapshot } from '../types/audit.ts';
import { Button, Card, Field, fieldInputClass } from './base/index.tsx';
import { methodNames, money, percent } from '../lib/format.ts';
import { parsePercentText, percentDraft, percentDraftStatus } from '../lib/money-input.ts';
import { useDraftGuard } from '../lib/draft-guard.ts';
import { MoneyInput } from './KeyFactsCard.tsx';

const roleNames: Record<string, string> = { disclosure: '明示表', contract: '合同', schedule: '还款计划', other: '其他材料' };
const repayNames: Record<string, string> = { equal_installment: '等额本息', equal_principal: '等额本金', interest_only: '先息后本', bullet: '到期一次还本付息', schedule: '按明确还款计划', unknown: '待确认' };

export function RateField({ label, value, onChange }: { label: string; value: string | null; onChange: (value: string | null) => void }) {
  const [draft, setDraft] = useState(percentDraft(value));
  const draftStatus = percentDraftStatus(draft, value);
  useDraftGuard(label, draftStatus);
  useEffect(() => { setDraft(percentDraft(value)); }, [value]);
  return <Field suffix="%"><input aria-label={label} aria-invalid={draftStatus === 'invalid' || undefined} inputMode="decimal" className={fieldInputClass} value={draft} placeholder="待确认"
    onChange={event => setDraft(event.target.value)}
    onBlur={() => { const parsed = parsePercentText(draft); if (parsed !== null) onChange(parsed); else if (draft.trim() === '') onChange(null); }}
    onKeyDown={event => { if (event.key === 'Enter') { const parsed = parsePercentText(draft); if (parsed !== null) onChange(parsed); } }} /></Field>;
}

type RowKey = 'principal' | 'disbursed' | 'period_payment' | 'term_periods' | 'repay_method' | 'start_date' | 'nominal_apr' | 'quoted_method' | 'lender_name';

const ROWS: { key: RowKey; label: string; field: string }[] = [
  { key: 'principal', label: '合同本金', field: 'loan.principal' },
  { key: 'disbursed', label: '实际到账', field: 'loan.disbursed' },
  { key: 'period_payment', label: '每期还本息', field: 'loan.period_payment' },
  { key: 'term_periods', label: '还款期数', field: 'loan.term_periods' },
  { key: 'repay_method', label: '还款方式', field: 'loan.repay_method' },
  { key: 'start_date', label: '放款日期', field: 'loan.start_date' },
  { key: 'nominal_apr', label: '合同名义年利率', field: 'loan.nominal_apr' },
  { key: 'quoted_method', label: '明示表年化口径', field: 'disclosure.quoted_method' },
  { key: 'lender_name', label: '放贷方', field: 'lender.name' },
];

function display(key: RowKey, facts: CaseFacts): string {
  switch (key) {
    case 'principal': return money(facts.loan.principal);
    case 'disbursed': return money(facts.loan.disbursed);
    case 'period_payment': return money(facts.loan.period_payment);
    case 'term_periods': return facts.loan.term_periods === null ? '待确认' : `${facts.loan.term_periods} 期`;
    case 'repay_method': return repayNames[facts.loan.repay_method] ?? '待确认';
    case 'start_date': return facts.loan.start_date ?? '待确认';
    case 'nominal_apr': return percent(facts.loan.nominal_apr);
    case 'quoted_method': return methodNames[facts.disclosure.quoted_method] ?? '口径待确认';
    case 'lender_name': return facts.lender.name || '待确认';
  }
}

function origin(field: string, current: CaseSnapshot): string {
  const hit = current.evidence.find(item => item.field.replace(/^facts\./, '') === field);
  if (!hit) return '无原文';
  const material = current.materials.find(item => item.id === hit.document_id);
  return `${material ? roleNames[material.role] ?? '材料' : '材料'}${hit.page === null ? '' : ` P${hit.page}`}`;
}

export default function FactsFold({ facts, current, onChange }: { facts: CaseFacts; current: CaseSnapshot; onChange: (facts: CaseFacts) => void }) {
  const [editing, setEditing] = useState<RowKey | null>(null);
  const [snapshot, setSnapshot] = useState<CaseFacts | null>(null);
  const evidenced = ROWS.filter(row => origin(row.field, current) !== '无原文').length;
  const openRow = (key: RowKey) => { setSnapshot(facts); setEditing(key); };
  const finish = () => { setEditing(null); setSnapshot(null); };
  const cancel = () => { if (snapshot) onChange(snapshot); setEditing(null); setSnapshot(null); };
  const loan = <K extends keyof CaseFacts['loan']>(key: K, value: CaseFacts['loan'][K]) => onChange({ ...facts, loan: { ...facts.loan, [key]: value } });
  const editor = (key: RowKey) => {
    switch (key) {
      case 'principal': return <MoneyInput label="合同本金" value={facts.loan.principal} onCommit={value => loan('principal', value)} />;
      case 'disbursed': return <MoneyInput label="实际到账" value={facts.loan.disbursed} onCommit={value => loan('disbursed', value)} />;
      case 'period_payment': return <MoneyInput label="每期还本息" value={facts.loan.period_payment} onCommit={value => loan('period_payment', value)} />;
      case 'term_periods': return <Field suffix="期"><input aria-label="还款期数" type="number" min="1" max="600" className={fieldInputClass} value={facts.loan.term_periods ?? ''} onChange={event => loan('term_periods', event.target.value === '' ? null : Number(event.target.value))} /></Field>;
      case 'repay_method': return <select aria-label="还款方式" className="min-h-11 rounded-md border border-line-strong bg-surface px-3 text-sm" value={facts.loan.repay_method} onChange={event => loan('repay_method', event.target.value as CaseFacts['loan']['repay_method'])}>{Object.entries(repayNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>;
      case 'start_date': return <Field><input aria-label="放款日期" type="date" className={fieldInputClass} value={facts.loan.start_date ?? ''} onChange={event => loan('start_date', event.target.value || null)} /></Field>;
      case 'nominal_apr': return <RateField label="合同名义年利率" value={facts.loan.nominal_apr} onChange={value => loan('nominal_apr', value)} />;
      case 'quoted_method': return <select aria-label="明示表年化口径" className="min-h-11 rounded-md border border-line-strong bg-surface px-3 text-sm" value={facts.disclosure.quoted_method} onChange={event => onChange({ ...facts, disclosure: { ...facts.disclosure, quoted_method: event.target.value as CaseFacts['disclosure']['quoted_method'] } })}>{Object.entries(methodNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>;
      case 'lender_name': return <Field><input aria-label="放贷方" className={fieldInputClass} value={facts.lender.name ?? ''} placeholder="待确认" onChange={event => onChange({ ...facts, lender: { ...facts.lender, name: event.target.value || null } })} /></Field>;
    }
  };
  return <Card padding="none" className="mt-6">
    <details>
      <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-6 py-4">
        <span className="text-base font-medium">已读到的 9 项</span>
        <span className="text-sm text-mute">{evidenced === ROWS.length ? '都有原文，读错了才动它' : `${evidenced} 项有原文，其余要你补`}</span>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="ml-auto"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
      </summary>
      <div className="border-t border-line px-6 py-4">
        <div className="flex flex-col">
          {ROWS.map(row => <div key={row.key} className="grid gap-2 border-b border-line py-3 text-sm last:border-b-0 sm:grid-cols-[8rem_1fr_auto_auto] sm:items-center">
            <span className="text-mute">{row.label}</span>
            {editing === row.key ? <div className="sm:col-span-2">{editor(row.key)}</div> : <span className="num font-medium">{display(row.key, facts)}</span>}
            <span className="text-xs text-mute">{editing === row.key ? '' : origin(row.field, current)}</span>
            {editing === row.key
              ? <div className="flex gap-2"><Button variant="chip" onClick={cancel}>取消</Button><Button variant="chip" onClick={event => {
                const invalid = event.currentTarget.parentElement?.parentElement?.querySelector<HTMLInputElement>('input[aria-invalid="true"]');
                if (invalid) invalid.focus();
                else finish();
              }}>完成</Button></div>
              : <Button variant="chip" onClick={() => openRow(row.key)}>改</Button>}
          </div>)}
        </div>
      </div>
    </details>
  </Card>;
}
