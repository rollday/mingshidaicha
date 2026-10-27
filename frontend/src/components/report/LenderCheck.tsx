import type { AuditReport, CaseFacts } from '../../types/audit.ts';
import { triState } from '../../lib/format.ts';
import { Card, Tag } from '../base/index.tsx';

const lenderTypes: Record<CaseFacts['lender']['type'], string> = {
  bank: '银行', consumer_finance: '消费金融公司', microloan: '小额贷款公司',
  platform: '平台', other: '其他', unknown: '类型待确认',
};

export function LenderCheck({ report }: { report: AuditReport }) {
  const lender = report.facts.lender;
  const rows = [
    ['是否有牌照', lender.licensed],
    ['是否涉及互联网消费贷款', lender.internet_consumer_loan],
    ['是否涉及互联网助贷', lender.internet_assisted],
  ] as const;
  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-1"><h2 className="text-lg font-medium">放贷方信息</h2><p className="text-sm text-mute">展示用户确认的主体信息与相关属性。</p></header>
      <Card padding="wide" className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="font-serif text-xl font-medium">{lender.name ?? '主体名称待确认'}</h3>
          <Tag tone="blue">{lenderTypes[lender.type]}</Tag>
        </div>
        <dl className="grid gap-3 sm:grid-cols-3">
          {rows.map(([label, value]) => <div key={label} className="flex items-center justify-between gap-3 border-t border-line pt-3"><dt className="text-sm text-mute">{label}</dt><dd><Tag tone={value === true ? 'green' : value === false ? 'amber' : 'neutral'}>{triState(value)}</Tag></dd></div>)}
        </dl>
        <p className="border-t border-line pt-4 text-sm text-mute">以上是用户确认的主体资质，不等于系统已联网查验。</p>
      </Card>
    </section>
  );
}
