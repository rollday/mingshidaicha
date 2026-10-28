import type { AuditReport } from '../../types/audit.ts';
import { decimal, methodNames, percent } from '../../lib/format.ts';
import { rulePresentation } from '../../../../shared/rule-policy.ts';
import { Card, Tag, type Tone } from '../base/index.tsx';

const levelTone: Record<AuditReport['conclusion']['level'], Tone> = {
  red: 'red', yellow: 'amber', blue: 'blue',
};
const levelName: Record<AuditReport['conclusion']['level'], string> = { red: '重点关注', yellow: '披露需核对', blue: '当前无已确认问题' };

export function VerdictCard({ report }: { report: AuditReport }) {
  const comparison = report.calculation?.calculation.comparison;
  const tone = levelTone[report.conclusion.level];
  const method = comparison?.method;
  const methodLabel = method ? methodNames[method] ?? method : '口径待确认';
  const { confirmed_issues, pending_checks, advisory_hints } = report.conclusion.counts;
  const differenceRule = report.rules.find((rule) => rule.rule_id === 'R02');
  const differencePresentation = differenceRule ? rulePresentation(differenceRule) : null;
  const differenceTone = differencePresentation?.tone === 'amber'
    ? 'amber'
    : differencePresentation?.tone === 'red'
      ? 'red'
      : 'neutral';
  const heading = confirmed_issues > 0
    ? '有已确认的规则问题需要关注。'
    : pending_checks > 0
      ? '部分信息仍需核实。'
      : advisory_hints > 0
        ? '阅读提示'
        : '规则比对已完成。';

  return (
    <Card padding="lg" className="relative overflow-hidden">
      <div className={`absolute inset-y-0 left-0 w-1 ${tone === 'red' ? 'bg-red' : tone === 'amber' ? 'bg-amber' : 'bg-blue'}`} />
      <div className="flex flex-col gap-5 pl-2">
        <div className="flex flex-wrap items-center gap-2">
          <Tag tone={tone}>{levelName[report.conclusion.level]}</Tag>
          {report.conclusion.partial ? <Tag tone="blue">计算未完成</Tag> : null}
          {report.conclusion.information_incomplete ? <Tag tone="blue">信息待补充</Tag> : null}
        </div>
        {report.conclusion.partial || !report.calculation ? (
          <p className="rounded-md border border-line bg-blue/5 px-4 py-3 text-sm text-ink-soft">
            材料不足，未核算年化。报告中的规则与已确认事实仍可供参考。
          </p>
        ) : null}
        <h2 className="font-serif text-xl font-medium">{heading}</h2>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">{report.conclusion.summary}</p>

        <dl className="grid gap-3 sm:grid-cols-3">
          <Count label="确认问题" value={confirmed_issues} tone={report.conclusion.level==='red'?'red':report.conclusion.level==='yellow'?'amber':'blue'} />
          <Count label="待核实" value={pending_checks} tone={report.rules.some(rule=>rule.status==='insufficient_data'&&rule.nature==='prohibited')?'amber':'blue'} />
          <Count label="阅读提示" value={advisory_hints} tone="blue" />
        </dl>

        <div className="grid gap-3 sm:grid-cols-3">
          <Metric label="披露年化" value={report.facts.disclosure.quoted_apr === null ? '未标注' : percent(report.facts.disclosure.quoted_apr)} note={methodNames[report.facts.disclosure.quoted_method] ?? '口径待确认'} />
          <Metric label="按材料重算" value={percent(comparison?.computed_apr)} note={methodLabel} />
          <Metric
            label="两者差额"
            value={comparison?.gap_pp == null ? '口径待确认' : `${decimal(comparison.gap_pp)} 个百分点`}
            note={comparison?.exceeds_tolerance === true ? '超过比较容差' : comparison?.exceeds_tolerance === false ? '未超过比较容差' : '是否超出容差未知'}
            tone={comparison?.exceeds_tolerance === true ? differenceTone : 'neutral'}
          />
        </div>
        {!report.calculation && report.calculation_error ? (
          <p className="text-sm text-mute">计算暂不可用（{report.calculation_error.code}）：{report.calculation_error.message}</p>
        ) : null}
        {report.calculation && !comparison?.computed_apr ? (
          <p className="text-sm text-mute">当前比较口径的重算年化不可用；页面不会用名义年化替代该数值。</p>
        ) : null}
      </div>
    </Card>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone: 'red' | 'amber' | 'blue' }) {
  return (
    <div className="rounded-md bg-canvas p-4">
      <dt className="text-sm text-mute">{label}</dt>
      <dd className={`mt-1 text-xl font-medium tabular-nums ${value===0?'text-mute':tone === 'red' ? 'text-red' : tone === 'amber' ? 'text-amber' : 'text-blue'}`}>{value}</dd>
    </div>
  );
}

function Metric({ label, value, note, tone = 'neutral' }: { label: string; value: string; note: string; tone?: 'red' | 'amber' | 'neutral' }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 rounded-md p-4 ${tone === 'red' ? 'bg-red/5' : tone === 'amber' ? 'bg-amber-bg/50' : 'bg-canvas'}`}>
      <span className="text-sm text-mute">{label}</span>
      <strong className={`break-words font-serif text-xl font-medium num ${tone === 'red' ? 'text-red' : tone === 'amber' ? 'text-amber' : ''}`}>{value}</strong>
      <span className="text-xs text-mute">{note}</span>
    </div>
  );
}
