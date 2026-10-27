import type { AuditReport } from '../../types/audit.ts';
import { money } from '../../lib/format.ts';
import { Card, Tag } from '../base/index.tsx';

export function MonthlyCard({ report }: { report: AuditReport }) {
  const loan = report.facts.loan;
  const payment = loan.period_payment ?? report.facts.repayments[0]?.amount ?? null;
  const periodicFees = report.facts.fees.filter((fee) => fee.timing === 'per_period' && fee.contingent === false && fee.included_in_cashflows === false);
  const periodLabel = loan.period_payment === null ? '材料中的首笔' : loan.periods_per_year === 12 ? '每月约定' : '每期约定';
  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-1"><h2 className="text-lg font-medium">还款金额参考</h2><p className="text-sm text-mute">按材料中的单期还款额展示，不推算收入占比。</p></header>
      <Card padding="lg" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><p className="text-sm text-mute">{periodLabel}还款额</p><p className="mt-1 font-serif text-xl font-medium num">{money(payment)}</p></div>
          <Tag tone="neutral">{loan.term_periods === null ? '期数待确认' : `共 ${loan.term_periods} 期`}</Tag>
        </div>
        {payment === null ? <p className="text-sm text-mute">材料中没有可展示的单期还款金额。</p> : null}
        {periodicFees.length ? (
          <div className="rounded-md bg-canvas px-4 py-3">
            <p className="text-sm font-medium">另有按期收费项目</p>
            <ul className="mt-2 flex flex-col gap-2 text-sm text-mute">{periodicFees.map((fee) => <li key={fee.id} className="flex flex-wrap justify-between gap-2"><span>{fee.name}</span><span>{money(fee.amount)} / 期</span></li>)}</ul>
            <p className="mt-2 text-xs text-mute">上方还款额按贷款还款字段展示；这些收费未合并进该金额。</p>
          </div>
        ) : null}
        <p className="text-xs text-mute">此处用于阅读材料中的还款安排，不代表对未来扣款金额的保证。</p>
      </Card>
    </section>
  );
}
