import type { ReactNode } from 'react';
import type { AuditReport, CaseFacts } from '../../types/audit.ts';
import { money, triState } from '../../lib/format.ts';
import { Card, Tag, Table, type Column } from '../base/index.tsx';

const columns: Column[] = [
  { key: 'name', label: '费用项目' },
  { key: 'amount', label: '单次金额', align: 'right' },
  { key: 'total', label: '核算合计', align: 'right' },
  { key: 'accounting', label: '费用计入方式' },
  { key: 'payee', label: '收取主体' },
  { key: 'disclosure', label: '明示表' },
];
const payeeNames: Record<CaseFacts['fees'][number]['payee_type'], string> = {
  lender: '放贷方', platform: '平台', guarantor: '担保方', other: '其他主体', unknown: '主体待确认',
};

function feeAccountingLabel(fee: CaseFacts['fees'][number]): string {
  if (fee.contingent === true) return '或有费用，不计入常规成本';
  if (fee.contingent === null) return '费用发生条件待确认';
  if (fee.included_in_cashflows === null) return '计入方式待确认';
  if (fee.included_in_cashflows === false) return '另计入现金流';
  if (fee.timing === 'unknown') return '计入位置待确认';
  return fee.timing === 'upfront' || (fee.timing === 'specific_period' && fee.period === 0)
    ? '已在到账净额中扣除（不重复扣款）'
    : '已含在还款额中（不重复加收）';
}

export function FeeTable({ report }: { report: AuditReport }) {
  const totals = new Map((report.calculation?.fee_totals ?? []).map((item) => [item.id, item]));
  const regular = report.facts.fees.filter((fee) => fee.contingent === false);
  const unknown = report.facts.fees.filter((fee) => fee.contingent === null);
  const contingent = report.facts.fees.filter((fee) => fee.contingent === true);
  const unconfirmedAccounting = regular.filter((fee) => fee.included_in_cashflows === null);
  const rowsFor = (fees: typeof report.facts.fees) => fees.map((fee) => {
    const total = totals.get(fee.id);
    const totalLabel = fee.contingent === true
      ? '或有费用，单独列示'
      : fee.contingent === null
        ? '发生条件待确认'
        : total ? money(total.total) : '尚未核算';
    return {
      name: <span className="flex flex-wrap items-center gap-2">{fee.name}{fee.contingent === true ? <Tag tone="amber">或有费用</Tag> : null}</span>,
      amount: fee.amount === null ? '待确认' : money(fee.amount),
      total: totalLabel,
      accounting: feeAccountingLabel(fee),
      payee: <span>{fee.payee ?? '主体待确认'}<span className="ml-1 text-xs text-mute">· {payeeNames[fee.payee_type]}</span></span>,
      disclosure: <Tag tone="neutral">{triState(fee.in_disclosure)}</Tag>,
    };
  });
  const flags = [
    ['明示表是否存在', report.facts.disclosure.present],
    ['明示表栏目是否齐全', report.facts.disclosure.items_complete],
    ['或有费用是否披露', report.facts.disclosure.contingent_disclosed],
  ] as const;

  return (
    <section className="flex flex-col gap-4">
      <SectionHeading title="钱花在哪" subtitle="金额和披露状态按已确认材料展示。" />
      <Card padding="none" className="p-4 sm:px-7 sm:py-6">
        {report.calculation ? (
          <div className="flex flex-col gap-1">
            <p className="text-base">按当前材料预计实际支付：<strong className="font-medium num">{money(report.calculation.summary.total_payment)}</strong></p>
            <p className="text-sm text-ink-soft">还款计划 {money(report.calculation.summary.total_repayment)} + 另付费用 {money(report.calculation.summary.total_additional_fees)}。</p>
          </div>
        ) : <p className="text-sm text-mute">还款合计暂不可用。</p>}
        {unconfirmedAccounting.length > 0 ? (
          <p role="status" className="mt-3 rounded-md bg-canvas p-3 text-sm text-amber">{unconfirmedAccounting.map((fee) => fee.name).join('、')}的计入方式待确认；确认前无法给出最终实际年化（APR）。</p>
        ) : null}
        {report.facts.fees.length ? (
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {report.facts.fees.slice(0, 2).map((fee) => <li key={fee.id} className="flex flex-wrap justify-between gap-x-3 gap-y-1 border-t border-line pt-2">
              <span className="min-w-0 flex-1">{fee.name} <span className="text-mute">· {fee.contingent === null ? '发生条件待确认' : fee.contingent ? '或有费用' : fee.in_disclosure === null ? '明示状态待确认' : fee.in_disclosure ? '表内已列' : '表内未列'}</span><span className="mt-1 block text-xs text-ink-soft">{feeAccountingLabel(fee)}</span></span>
              <span className="shrink-0 num">{fee.contingent === false && totals.has(fee.id) ? money(totals.get(fee.id)!.total) : fee.amount === null ? '金额待确认' : `${money(fee.amount)} / 次`}</span>
            </li>)}
            {report.facts.fees.length > 2 ? <li className="text-2xs text-mute">另有 {report.facts.fees.length - 2} 项，详见费用明细。</li> : null}
          </ul>
        ) : <p className="mt-2 text-sm text-mute">没有已确认的费用项目。</p>}
        <details className="mt-3 border-t border-line pt-3">
          <summary className="cursor-pointer text-sm font-medium text-blue">查看全部费用与披露信息</summary>
          <div className="mt-4">
        {regular.length ? <FeeGroup label="非或有费用" fees={regular} totals={totals} rows={rowsFor(regular)} /> : <p className="py-2 text-sm text-mute">没有已确认的非或有费用项目。</p>}
        {unknown.length > 0 && <div className="mt-5 border-t border-line pt-4"><h3 className="mb-2 text-base font-medium">费用发生条件待确认</h3><FeeGroup label="待确认费用" fees={unknown} totals={totals} rows={rowsFor(unknown)} /></div>}
        {contingent.length ? (
          <div className="mt-5 border-t border-line pt-4">
            <h3 className="mb-2 text-base font-medium">或有费用（单独列示，不计入上方常规合计）</h3>
            <FeeGroup label="或有费用" fees={contingent} totals={totals} rows={rowsFor(contingent)} />
          </div>
        ) : null}
        <div className="mt-5 grid gap-2 border-t border-line pt-4 sm:grid-cols-3">
          {flags.map(([label, value]) => <div key={label} className="flex items-center justify-between gap-3 text-sm"><span className="text-mute">{label}</span><Tag tone="neutral">{triState(value)}</Tag></div>)}
        </div>
        {report.facts.disclosure.items_complete === true && report.facts.fees.some((fee) => fee.in_disclosure === false) ? (
          <p className="mt-2 text-xs text-mute">“栏目齐全”与每笔费用是否列在明示表是不同字段；请查看下方逐项状态。</p>
        ) : null}
        {report.facts.fees.length ? (
          <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4 text-sm">
            <p className="text-mute">请分开核对费用是否已经包含在到账或还款额中，以及是否计入明示年化：</p>
            {report.facts.fees.map((fee) => <div key={fee.id} className="flex flex-wrap gap-x-5 gap-y-1"><span>{fee.name}</span><span className="text-mute">已含在到账或还款额中：{triState(fee.included_in_cashflows)}</span><span className="text-mute">已计入明示年化：{triState(fee.included_in_disclosed_cost)}</span></div>)}
          </div>
        ) : null}
        {report.calculation ? <p className="mt-4 border-t border-line pt-4 text-sm text-mute">独立支付费用合计：{money(report.calculation.summary.total_additional_fees)}；借款成本（不含归还本金）：{money(report.calculation.summary.total_cost)}</p> : <p className="mt-4 border-t border-line pt-4 text-sm text-mute">计算未完成，合计暂不可用。</p>}
          </div>
        </details>
      </Card>
    </section>
  );
}

function FeeGroup({
  label,
  fees,
  totals,
  rows,
}: {
  label: string;
  fees: AuditReport['facts']['fees'];
  totals: Map<string, NonNullable<AuditReport['calculation']>['fee_totals'][number]>;
  rows: Record<string, ReactNode>[];
}) {
  return <>
    <div className="flex flex-col gap-3 sm:hidden" aria-label={label}>
      {fees.map((fee) => {
        const total = totals.get(fee.id);
        const totalLabel = fee.contingent === true
          ? '或有费用，单独列示'
          : fee.contingent === null
            ? '发生条件待确认'
            : total ? money(total.total) : '尚未核算';
        return <article key={fee.id} className="rounded-md bg-canvas p-4">
          <h4 className="text-base font-medium">{fee.name}</h4>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-mute">单次金额</dt><dd className="text-right num">{fee.amount === null ? '待确认' : money(fee.amount)}</dd>
            <dt className="text-mute">核算合计</dt><dd className="text-right num">{totalLabel}</dd>
            <dt className="text-mute">费用计入方式</dt><dd className="text-right">{feeAccountingLabel(fee)}</dd>
            <dt className="text-mute">收取主体</dt><dd className="text-right">{fee.payee ?? '主体待确认'} · {payeeNames[fee.payee_type]}</dd>
            <dt className="text-mute">是否列在明示表</dt><dd className="text-right">{triState(fee.in_disclosure)}</dd>
          </dl>
        </article>;
      })}
    </div>
    <div className="hidden overflow-x-auto sm:block">
      <Table label={label} columns={columns} rows={rows} className="min-w-150" />
    </div>
  </>;
}

function SectionHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return <header className="flex flex-col gap-1"><h2 className="text-lg font-medium">{title}</h2><p className="text-sm text-mute">{subtitle}</p></header>;
}
