import type { AuditReport } from '../../types/audit.ts';
import { money, percent } from '../../lib/format.ts';
import { describeCorrectionObject } from '../../lib/report-display.ts';
import { Card } from '../base/index.tsx';

const COLLAPSE_AFTER = 6;

export function CorrectionsNotice({ report }: { report: AuditReport }) {
  const corrections = report.corrections;
  const items = (
    <ul className="flex flex-col gap-3">
      {corrections.map((correction, index) => (
        <li key={`${correction.field}-${index}`} className="flex flex-col gap-1 border-b border-line pb-3 last:border-0 last:pb-0">
          <span className="text-sm font-medium">{correctionLabel(correction)}</span>
          <div className="grid gap-2 text-sm sm:grid-cols-[1fr_auto_1fr]">
            <CorrectionValue label="原识别" field={correction.field} value={correction.before} />
            <span className="hidden self-center text-mute sm:block">→</span>
            <CorrectionValue label="确认后" field={correction.field} value={correction.after} />
          </div>
        </li>
      ))}
    </ul>
  );
  return (
    <section className="flex flex-col gap-4">
      <header><h2 className="text-lg font-medium">报告局限与说明</h2></header>
      <Card padding="wide" className="flex flex-col gap-5">
        {corrections.length ? (
          <div>
            <h3 className="mb-3 text-base font-medium">修改过 {corrections.length} 处信息</h3>
            {corrections.length > COLLAPSE_AFTER ? (
              <details>
                <summary className="cursor-pointer text-sm text-mute">逐条查看这 {corrections.length} 处（手工填写时每个字段都会记为一次确认）</summary>
                <div className="mt-3">{items}</div>
              </details>
            ) : items}
          </div>
        ) : null}
        <div className={corrections.length ? 'border-t border-line pt-4' : ''}>
          <h3 className="text-base font-medium">报告局限</h3>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-mute">{report.narrative.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul>
          {report.generation.mode === 'template' ? <p className="mt-3 text-sm text-mute">本报告概要由规则结果生成，费用计算和核查结论完整；具体依据仍以已确认信息为准。</p> : null}
        </div>
        <p className="border-t border-line pt-4 text-sm text-mute">{report.disclaimer}</p>
      </Card>
    </section>
  );
}

const fieldLabels: Record<string, string> = {
  'borrower.purpose': '借款用途', 'lender.name': '放贷方', 'lender.type': '签约方类型', 'lender.licensed': '是否持牌',
  'lender.internet_consumer_loan': '是否互联网消费贷款', 'lender.internet_assisted': '是否互联网助贷',
  'loan.principal': '合同本金', 'loan.disbursed': '实际到账', 'loan.term_periods': '期数', 'loan.repay_method': '还款方式',
  'loan.period_payment': '每期还款', 'loan.nominal_apr': '合同名义年利率', 'loan.start_date': '放款日期',
  'disclosure.present': '是否提供明示表', 'disclosure.quoted_apr': '明示表标注年化', 'disclosure.quoted_method': '年化口径',
  'disclosure.items_complete': '明示项目是否齐全', 'disclosure.contingent_disclosed': '或有成本是否披露', 'funds_to': '资金实际付给谁',
};

const valueLabels: Record<string, string> = {
  bank: '银行', consumer_finance: '消费金融公司', microloan: '小额贷款公司', platform: '平台', other: '其他',
  equal_installment: '等额本息', equal_principal: '等额本金', interest_only: '先息后本', bullet: '到期一次还本付息', schedule: '按还款计划',
  nominal: '名义年化', effective: '实际年化', simple: '单利', xirr: 'XIRR',
  upfront: '放款时收取', per_period: '每期收取', at_maturity: '到期收取', specific_period: '指定期收取',
  borrower: '借款人', training_provider: '培训机构', third_party: '第三方', unknown: '待确认',
};

function CorrectionValue({ label, field, value }: { label: string; field: string; value: unknown }) {
  let display: string;
  if (value === null || value === undefined) display = '待确认';
  else if (typeof value === 'boolean') display = value ? '是' : '否';
  else if (typeof value === 'string') {
    if (/^(?:-?\d+(?:\.\d+)?)$/.test(value) && /amount|principal|disbursed|payment/i.test(field)) display = money(value);
    else if (/^(?:-?\d+(?:\.\d+)?)$/.test(value) && /apr|rate|年化|利率/i.test(field)) display = percent(value);
    else display = valueLabels[value] ?? (value || '空');
  }
  else if (typeof value === 'object') display = describeCorrectionObject(value as Record<string, unknown>, field);
  else display = String(value);
  return <p className="min-w-0 break-words"><span className="text-mute">{label}：</span>{display}</p>;
}

function correctionLabel(correction: AuditReport['corrections'][number]): string {
  const fields: Record<string, string> = {
    included_in_cashflows: '是否已含在到账或还款额中', included_in_disclosed_cost: '是否计入明示年化',
    name: '费用名称', amount: '费用金额', contingent: '是否或有', timing: '发生时间', period: '指定期次',
    payee: '收取主体', payee_type: '收取主体类型', in_disclosure: '是否列在明示表',
    date: '还款日期',
  };
  const match = /^fees\[(\d+)\]\.(.+)$/.exec(correction.field);
  const metadata = correction as typeof correction & { fee_name?: string; fee_id?: string };
  if (/^fees\[\d+\]$/.test(correction.field)) return `${metadata.fee_name ?? metadata.fee_id ?? correction.field} · ${correction.after === null ? '费用已删除' : '费用项目'}`;
  if (/^repayments\[\d+\]$/.test(correction.field)) {
    const index = Number(/^repayments\[(\d+)\]$/.exec(correction.field)?.[1] ?? 0);
    return `还款第 ${index + 1} 笔 · 还款计划`;
  }
  if (match) return `${metadata.fee_name ?? (metadata.fee_id ? `费用（${metadata.fee_id}）` : `费用第 ${Number(match[1]) + 1} 项`)} · ${fields[match[2]!] ?? match[2]}`;
  const base = fieldLabels[correction.field] ?? fields[correction.field] ?? correction.field;
  return metadata.fee_name ? `${metadata.fee_name} · ${base}` : base;
}
