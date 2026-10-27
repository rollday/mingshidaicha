import type { AuditReport } from '../../types/audit.ts';
import { decimal, methodNames, percent } from '../../lib/format.ts';
import { Card, Tag, type Tone } from '../base/index.tsx';

const levelTone: Record<AuditReport['conclusion']['level'], Tone> = {
  red: 'red', yellow: 'amber', blue: 'blue',
};
const levelName: Record<AuditReport['conclusion']['level'], string> = { red: '重点关注', yellow: '需要核实', blue: '已完成比对' };

export function VerdictCard({ report }: { report: AuditReport }) {
  const comparison = report.calculation?.calculation.comparison;
  const tone = levelTone[report.conclusion.level];
  const method = comparison?.method;
  const methodLabel = method ? methodNames[method] ?? method : '口径待确认';

  return (
    <Card padding="lg" className="relative overflow-hidden">
      <div className={`absolute inset-y-0 left-0 w-1 ${tone === 'red' ? 'bg-red' : tone === 'amber' ? 'bg-amber' : 'bg-blue'}`} />
      <div className="flex flex-col gap-5 pl-2">
        <div className="flex flex-wrap items-center gap-2">
          <Tag tone={tone}>{levelName[report.conclusion.level]}</Tag>
          {report.conclusion.partial ? <Tag tone="amber">材料不足</Tag> : null}
        </div>
        {report.conclusion.partial || !report.calculation ? (
          <p className="rounded-md border border-amber-line/50 bg-amber-bg/50 px-4 py-3 text-sm text-amber">
            材料不足，未核算年化。报告中的规则与已确认事实仍可供参考。
          </p>
        ) : null}
        <h2 className="font-serif text-xl font-medium">{report.conclusion.partial ? '先把关键材料补齐。' : report.rules.some(rule => rule.status === 'triggered') ? '有几处信息，值得再核对。' : '材料比对已完成。'}</h2>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">{report.conclusion.summary}</p>

        <div className="grid gap-3 sm:grid-cols-3">
          <Metric label="披露年化" value={report.facts.disclosure.quoted_apr === null ? '未标注' : percent(report.facts.disclosure.quoted_apr)} note={methodNames[report.facts.disclosure.quoted_method] ?? '口径待确认'} />
          <Metric label="按材料重算" value={percent(comparison?.computed_apr)} note={methodLabel} />
          <Metric
            label="两者差额"
            value={comparison?.gap_pp == null ? '口径待确认' : `${decimal(comparison.gap_pp)} 个百分点`}
            note={comparison?.exceeds_tolerance === true ? '超过比较容差' : comparison?.exceeds_tolerance === false ? '未超过比较容差' : '是否超出容差未知'}
            tone={comparison?.exceeds_tolerance === true ? 'red' : 'neutral'}
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

function Metric({ label, value, note, tone = 'neutral' }: { label: string; value: string; note: string; tone?: 'red' | 'neutral' }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 rounded-md p-4 ${tone === 'red' ? 'bg-red/5' : 'bg-canvas'}`}>
      <span className="text-sm text-mute">{label}</span>
      <strong className="break-words font-serif text-xl font-medium num">{value}</strong>
      <span className="text-xs text-mute">{note}</span>
    </div>
  );
}
