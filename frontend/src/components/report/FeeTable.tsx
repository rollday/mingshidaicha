import type { ReactNode } from 'react';
import type { AuditReport, CaseFacts } from '../../types/audit.ts';
import { decimalAdd, decimalSub, decimalSum, money, moneyPlain, triState } from '../../lib/format.ts';
import { estimateFeeTotal } from '../../../../shared/fee-total.ts';
import { Card, Tag, Table, type Column } from '../base/index.tsx';

const detailColumns: Column[] = [
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

function feeTotalOf(
  fee: CaseFacts['fees'][number],
  totals: Map<string, NonNullable<AuditReport['calculation']>['fee_totals'][number]>,
  termPeriods: number | null,
): string | null {
  const total = totals.get(fee.id)?.total;
  if (total) return total;
  return estimateFeeTotal(fee, termPeriods)?.total ?? fee.amount ?? null;
}

function disclosureTag(value: boolean | null): ReactNode {
  if (value === true) return <Tag tone="green">在表内</Tag>;
  if (value === false) return <Tag tone="red">表外</Tag>;
  return <Tag tone="neutral">待确认</Tag>;
}

function feeLabel(fee: CaseFacts['fees'][number], termPeriods: number | null): ReactNode {
  if (fee.timing === 'per_period' && fee.amount !== null && termPeriods !== null) {
    return <>{fee.name}<span className="text-xs text-mute">（{moneyPlain(fee.amount)} 元 × {termPeriods} 期）</span></>;
  }
  return fee.name;
}

export function FeeTable({ report }: { report: AuditReport }) {
  const loan = report.facts.loan;
  const termPeriods = loan.term_periods;
  const totals = new Map((report.calculation?.fee_totals ?? []).map((item) => [item.id, item]));
  const regular = report.facts.fees.filter((fee) => fee.contingent === false);
  const unknown = report.facts.fees.filter((fee) => fee.contingent === null);
  const contingent = report.facts.fees.filter((fee) => fee.contingent === true);
  const unconfirmedAccounting = regular.filter((fee) => fee.included_in_cashflows === null);
  const summary = report.calculation?.summary;
  const principal = summary?.principal ?? loan.disbursed ?? loan.principal;
  const interest = summary ? decimalSub(summary.total_repayment, principal) : null;
  const totalPayment = summary?.total_payment ?? null;
  const payment = loan.period_payment ?? report.facts.repayments[0]?.amount ?? null;
  const perPeriodFees = report.facts.fees.filter((fee) =>
    fee.timing === 'per_period' && fee.contingent === false && fee.included_in_cashflows === false,
  );
  const perPeriodFeeTotal = decimalSum(perPeriodFees.map((fee) => fee.amount));
  const perPeriodPayment = payment !== null && perPeriodFeeTotal !== null
    ? decimalAdd(payment, perPeriodFeeTotal)
    : payment;
  const lenderName = report.facts.lender.name ?? '放贷方';
  const rowsFor = (fees: typeof report.facts.fees) => fees.map((fee) => {
    const total = totals.get(fee.id);
    const estimate = total ? null : estimateFeeTotal(fee, termPeriods);
    const totalLabel = fee.contingent === true
      ? '或有费用，单独列示'
      : fee.contingent === null
        ? '发生条件待确认'
        : total ? money(total.total) : estimate ? `${money(estimate.total)}（${estimate.basis}）` : '尚未核算';
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
      <SectionHeading title="钱花在哪" subtitle="金额都用你确认过的材料算出来，可以逐项核对。" />
      <Card padding="none" className="p-4 sm:px-7 sm:py-6">
        <div className="flex flex-col">
          <table className="w-full border-collapse text-sm max-sm:block sm:table-fixed" aria-label="钱花在哪">
            <thead className="max-sm:hidden">
              <tr className="text-left text-mute">
                <th className="w-2/5 py-2 pr-4 font-normal">项目</th>
                <th className="w-1/4 py-2 pr-4 text-right font-normal">金额</th>
                <th className="w-1/5 py-2 pr-4 font-normal">收给谁</th>
                <th className="py-2 font-normal">明示表里</th>
              </tr>
            </thead>
            <tbody className="max-sm:block">
              <tr className="border-t border-line max-sm:grid max-sm:grid-cols-[1fr_auto] max-sm:items-baseline max-sm:gap-x-3 max-sm:py-3">
                <td className="py-3 pr-4 align-top max-sm:py-0 max-sm:pr-0">本金（到手）</td>
                <td className="py-3 pr-4 text-right align-top num whitespace-nowrap max-sm:py-0 max-sm:pr-0">{principal === null ? '—' : money(principal)}</td>
                <td className="py-3 pr-4 align-top text-ink-soft max-sm:py-0 max-sm:pr-0 max-sm:text-xs max-sm:text-mute">—</td>
                <td className="py-3 align-top max-sm:py-0 max-sm:text-right"><Tag tone="green">在表内</Tag></td>
              </tr>
              {interest !== null ? (
                <tr className="border-t border-line max-sm:grid max-sm:grid-cols-[1fr_auto] max-sm:items-baseline max-sm:gap-x-3 max-sm:py-3">
                  <td className="py-3 pr-4 align-top max-sm:py-0 max-sm:pr-0">利息（{termPeriods === null ? '全期' : `${termPeriods} 期`}合计）</td>
                  <td className="py-3 pr-4 text-right align-top num whitespace-nowrap max-sm:py-0 max-sm:pr-0">{money(interest)}</td>
                  <td className="py-3 pr-4 align-top text-ink-soft max-sm:py-0 max-sm:pr-0 max-sm:text-xs max-sm:text-mute">{lenderName}</td>
                  <td className="py-3 align-top max-sm:py-0 max-sm:text-right"><Tag tone="green">在表内</Tag></td>
                </tr>
              ) : null}
              {regular.map((fee) => (
                <tr key={fee.id} className="border-t border-line max-sm:grid max-sm:grid-cols-[1fr_auto] max-sm:items-baseline max-sm:gap-x-3 max-sm:py-3">
                  <td className="py-3 pr-4 align-top max-sm:py-0 max-sm:pr-0">{feeLabel(fee, termPeriods)}</td>
                  <td className="py-3 pr-4 text-right align-top num whitespace-nowrap max-sm:py-0 max-sm:pr-0">{feeTotalOf(fee, totals, termPeriods) === null ? '—' : money(feeTotalOf(fee, totals, termPeriods))}</td>
                  <td className="py-3 pr-4 align-top text-ink-soft max-sm:py-0 max-sm:pr-0 max-sm:text-xs max-sm:text-mute">{fee.payee ?? payeeNames[fee.payee_type]}</td>
                  <td className="py-3 align-top max-sm:py-0 max-sm:text-right">{disclosureTag(fee.in_disclosure)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-line-strong max-sm:grid max-sm:grid-cols-[1fr_auto] max-sm:items-baseline max-sm:gap-x-3 max-sm:py-3">
                <td className="py-3 pr-4 font-semibold max-sm:py-0 max-sm:pr-0">全期实际支付</td>
                <td className="py-3 pr-4 text-right font-semibold num whitespace-nowrap max-sm:py-0 max-sm:pr-0">{totalPayment === null ? '—' : money(totalPayment)}</td>
                <td colSpan={2} className="py-3 max-sm:hidden" />
              </tr>
            </tbody>
          </table>
          {payment !== null ? (
            <p className="mt-3 text-sm leading-relaxed text-ink-soft">
              每月还款 <strong className="font-medium num">{money(payment)}</strong>
              {perPeriodFees.length && perPeriodFeeTotal !== null ? <>，另有{perPeriodFees.map((fee) => `${fee.name} ${money(fee.amount)}`).join('、')}，每期实付 <strong className="font-medium num">{money(perPeriodPayment)}</strong></> : null}
              {termPeriods !== null ? <>，共 {termPeriods} 期</> : null}。
            </p>
          ) : termPeriods !== null ? <p className="mt-3 text-sm text-mute">材料未提供每月还款额；共 {termPeriods} 期。</p> : null}
        </div>
        {report.calculation_error?.code === 'CALCULATION_INCONSISTENT' ? <p role="alert" className="mt-3 text-sm text-amber">{report.calculation_error.message}</p> : null}
        {report.calculation?.reconciliation && report.calculation.fee_ledger ? <p className="mt-2 text-xs text-mute">已按确认数据核对 {report.calculation.fee_ledger.filter(item => item.category !== 'contingent').length} 项正常费用的计入位置及逐期现金流。</p> : null}
        {unconfirmedAccounting.length > 0 ? (
          <p role="status" className="mt-3 rounded-md bg-canvas p-3 text-sm text-amber">{unconfirmedAccounting.map((fee) => fee.name).join('、')}的计入方式待确认；确认前无法给出最终实际年化（APR）。</p>
        ) : null}
        {!report.calculation ? <p className="mt-3 text-sm text-mute">还款合计暂不可用。</p> : null}
        <details className="mt-3 border-t border-line pt-3">
          <summary className="cursor-pointer text-sm font-medium text-blue">查看全部费用与披露信息</summary>
          <div className="mt-4">
            {report.fee_prefills?.length ? (
              <div className="mb-5">
                <h3 className="text-sm font-medium">初始预填依据</h3>
                <p className="mt-1 text-xs text-mute">以下记录初始识别时的预填来源；当前计入方式以上方费用明细为准。贷款或费用信息修改后，请重新核对原文。</p>
                {report.fee_prefills.map((prefill, index) => {
                  const fee = report.facts.fees.find((item) => item.id === prefill.fee_id);
                  const current = fee ? (fee as unknown as Record<string, unknown>)[prefill.field.split('.').at(-1)!] : undefined;
                  const status = !fee ? '预填后费用已删除' : current === prefill.value ? '按原文预填' : '预填后已修改';
                  const sources = report.evidence.filter((item) => prefill.evidence_ids.includes(item.id));
                  return <details key={`${prefill.fee_id}-${prefill.field}-${index}`} className="mt-3 rounded-md bg-canvas p-3 text-sm">
                    <summary className="cursor-pointer">{fee?.name ?? `已删除费用（${prefill.fee_id}）`} · {status}</summary>
                    <p className="mt-2">初始预填：{{ in_period_payment: '已含在还款额中', deducted_from_disbursement: '已在到账净额中扣除', separate_charge: '另计入现金流' }[prefill.treatment]}；{prefill.reason}</p>
                    <p className="mt-1 text-xs text-mute">预填规则：{prefill.rule_id}</p>
                    {sources.map((source) => <blockquote key={source.id} className="mt-2 border-l-2 border-line pl-3">
                      <p className="text-xs text-mute">材料 {source.document_id}{source.page === null ? '' : ` · 第 ${source.page} 页`}{source.source_type === 'vision_transcript' ? ' · 图像转录，待核对' : ''}</p>
                      <p className="mt-1 whitespace-pre-wrap break-words">{source.quote}</p>
                    </blockquote>)}
                    {!sources.length ? <p className="mt-2 text-xs text-mute">原文摘录暂不可用，请核对原始材料。</p> : null}
                  </details>;
                })}
              </div>
            ) : null}
            {regular.length ? <FeeGroup label="非或有费用" fees={regular} totals={totals} rows={rowsFor(regular)} termPeriods={termPeriods} /> : <p className="py-2 text-sm text-mute">没有已确认的非或有费用项目。</p>}
            {unknown.length > 0 && <div className="mt-5 border-t border-line pt-4"><h3 className="mb-2 text-base font-medium">费用发生条件待确认</h3><FeeGroup label="待确认费用" fees={unknown} totals={totals} rows={rowsFor(unknown)} termPeriods={termPeriods} /></div>}
            {contingent.length ? (
              <div className="mt-5 border-t border-line pt-4">
                <h3 className="mb-2 text-base font-medium">或有费用（单独列示，不计入上方常规合计）</h3>
                <FeeGroup label="或有费用" fees={contingent} totals={totals} rows={rowsFor(contingent)} termPeriods={termPeriods} />
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
  termPeriods,
}: {
  label: string;
  fees: AuditReport['facts']['fees'];
  totals: Map<string, NonNullable<AuditReport['calculation']>['fee_totals'][number]>;
  rows: Record<string, ReactNode>[];
  termPeriods: number | null;
}) {
  return <>
    <div className="flex flex-col gap-3 sm:hidden" aria-label={label}>
      {fees.map((fee) => {
        const total = totals.get(fee.id);
        const estimate = total ? null : estimateFeeTotal(fee, termPeriods);
        const totalLabel = fee.contingent === true
          ? '或有费用，单独列示'
          : fee.contingent === null
            ? '发生条件待确认'
            : total ? money(total.total) : estimate ? `${money(estimate.total)}（${estimate.basis}）` : '尚未核算';
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
      <Table label={label} columns={detailColumns} rows={rows} className="min-w-150" />
    </div>
  </>;
}

function SectionHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return <header className="flex flex-col gap-1"><h2 className="text-lg font-medium">{title}</h2><p className="text-sm text-mute">{subtitle}</p></header>;
}
