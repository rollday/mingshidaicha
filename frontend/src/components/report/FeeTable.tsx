import type { ReactNode } from 'react';
import type { AuditReport, CaseFacts } from '../../types/audit.ts';
import { money, triState } from '../../lib/format.ts';
import { Card, Tag, Table, type Column } from '../base/index.tsx';

const columns: Column[] = [
  { key: 'name', label: '费用项目' },
  { key: 'amount', label: '单次金额', align: 'right' },
  { key: 'total', label: '核算合计', align: 'right' },
  { key: 'payee', label: '收取主体' },
  { key: 'disclosure', label: '明示表' },
];
const payeeNames: Record<CaseFacts['fees'][number]['payee_type'], string> = {
  lender: '放贷方', platform: '平台', guarantor: '担保方', other: '其他主体', unknown: '主体待确认',
};

export function FeeTable({ report }: { report: AuditReport }) {
  const totals = new Map((report.calculation?.fee_totals ?? []).map((item) => [item.id, item]));
  const regular = report.facts.fees.filter((fee) => fee.contingent === false);
  const unknown = report.facts.fees.filter((fee) => fee.contingent === null);
  const contingent = report.facts.fees.filter((fee) => fee.contingent === true);
  const rowsFor = (fees: typeof report.facts.fees) => fees.map((fee) => {
    const total = totals.get(fee.id);
    return {
      name: <span className="flex flex-wrap items-center gap-2">{fee.name}{fee.contingent === true ? <Tag tone="amber">或有费用</Tag> : null}</span>,
      amount: money(fee.amount),
      total: fee.contingent !== false ? '未纳入正常成本' : total ? money(total.total) : '—',
      payee: <span>{fee.payee ?? '未注明'}<span className="ml-1 text-xs text-mute">· {payeeNames[fee.payee_type]}</span></span>,
      disclosure: <Tag tone={fee.in_disclosure === true ? 'green' : fee.in_disclosure === false ? 'amber' : 'neutral'}>{triState(fee.in_disclosure)}</Tag>,
    };
  });
  const flags = [
    ['明示表是否存在', report.facts.disclosure.present],
    ['明示项目是否齐全', report.facts.disclosure.items_complete],
    ['或有费用是否披露', report.facts.disclosure.contingent_disclosed],
  ] as const;

  return (
    <section className="flex flex-col gap-4">
      <SectionHeading title="费用明细" subtitle="区分每笔收费、披露情况与计算是否纳入成本。" />
      <Card padding="wide">
        {regular.length ? <FeeGroup label="非或有费用" fees={regular} totals={totals} rows={rowsFor(regular)} /> : <p className="py-2 text-sm text-mute">没有已确认的非或有费用项目。</p>}
        {unknown.length > 0 && <div className="mt-5 border-t border-line pt-4"><h3 className="mb-2 text-base font-medium">费用发生条件待确认</h3><FeeGroup label="待确认费用" fees={unknown} totals={totals} rows={rowsFor(unknown)} /></div>}
        {contingent.length ? (
          <div className="mt-5 border-t border-line pt-4">
            <h3 className="mb-2 text-base font-medium">或有费用（单独列示，不计入上方常规合计）</h3>
            <FeeGroup label="或有费用" fees={contingent} totals={totals} rows={rowsFor(contingent)} />
          </div>
        ) : null}
        <div className="mt-5 grid gap-2 border-t border-line pt-4 sm:grid-cols-3">
          {flags.map(([label, value]) => <div key={label} className="flex items-center justify-between gap-3 text-sm"><span className="text-mute">{label}</span><Tag tone={value === true ? 'green' : value === false ? 'amber' : 'neutral'}>{triState(value)}</Tag></div>)}
        </div>
        {report.facts.fees.length ? (
          <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4 text-sm">
            <p className="text-mute">请分开核对费用是否已经包含在到账或还款额中，以及是否计入明示年化：</p>
            {report.facts.fees.map((fee) => <div key={fee.id} className="flex flex-wrap gap-x-5 gap-y-1"><span>{fee.name}</span><span className="text-mute">已含在到账或还款额中：{triState(fee.included_in_cashflows)}</span><span className="text-mute">已计入明示年化：{triState(fee.included_in_disclosed_cost)}</span></div>)}
          </div>
        ) : null}
        {report.calculation ? <p className="mt-4 border-t border-line pt-4 text-sm text-mute">独立支付费用合计：{money(report.calculation.summary.total_additional_fees)}；总成本：{money(report.calculation.summary.total_cost)}</p> : <p className="mt-4 border-t border-line pt-4 text-sm text-mute">计算未完成，合计暂不可用。</p>}
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
        return <article key={fee.id} className="rounded-md bg-canvas p-4">
          <h4 className="text-base font-medium">{fee.name}</h4>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-mute">单次金额</dt><dd className="text-right num">{money(fee.amount)}</dd>
            <dt className="text-mute">核算合计</dt><dd className="text-right num">{fee.contingent !== false ? '未纳入正常成本' : total ? money(total.total) : '—'}</dd>
            <dt className="text-mute">收取主体</dt><dd className="text-right">{fee.payee ?? '未注明'} · {payeeNames[fee.payee_type]}</dd>
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
