import { useEffect, useState } from 'react';
import type { CaseState } from '../lib/case-client.ts';
import { methodNames, money, percent } from '../lib/format.ts';
import type {
  Activity,
  DocumentParsed,
  Evidence,
  LenderSearchCategory,
  LoanResult,
  ReportDraft,
  RuleResult,
} from '../types/audit.ts';
import { rulePresentation, summarizeRules } from '../../../shared/rule-policy.ts';
import { Button, Card, Tag, type Tone } from './base/index.tsx';

const PAGE_TEXT_LIMIT = 8_000;
const ACTIVITY_LIMIT = 180;

const activityStatus: Record<Activity['status'], { label: string; tone: Tone }> = {
  started: { label: '已开始', tone: 'blue' },
  completed: { label: '已完成', tone: 'green' },
  warning: { label: '需留意', tone: 'amber' },
};

const categoryName: Record<LenderSearchCategory['kind'], string> = {
  license: '许可与机构信息',
  registry: '企业登记信息',
  penalty: '监管处罚信息',
};

const categoryStatus: Record<LenderSearchCategory['status'], string> = {
  sources_found: '已返回来源',
  no_indexed_results: '公开索引未找到结果',
  unavailable: '本项暂不可用',
};

function displayTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(timestamp);
}

function excerpt(value: string, limit = 600): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function stageName(stage: string): string {
  const names: Record<string, string> = {
    parse_pdf: '正在读取 PDF',
    read_images: '正在读取页面图像',
    extract_case: '正在提取材料信息',
    prepare_review: '正在准备信息核对',
    calculate: '正在计算借款成本',
    check_rules: '正在检查规则',
    write_report: '正在整理报告',
    search_license: '正在检索许可与机构信息',
    search_registry: '正在检索企业登记信息',
    search_penalty: '正在检索监管处罚信息',
    read_official_source: '正在读取公开来源',
  };
  return names[stage] ?? stage;
}

function AnalysisSummary({
  activity,
  evidence,
  rules,
  currentRevision,
  documentIndexes,
}: {
  activity: Activity;
  evidence: Evidence[];
  rules: RuleResult[];
  currentRevision: number | null;
  documentIndexes: Map<string, number>;
}) {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const rulesById = new Map(rules.map((item) => [item.rule_id, item]));
  const linkedEvidence = (activity.evidence_ids ?? [])
    .map((id) => evidenceById.get(id))
    .filter((item): item is Evidence => item !== undefined);
  const linkedRules = (activity.rule_ids ?? [])
    .map((id) => rulesById.get(id))
    .filter((item): item is RuleResult => item !== undefined);

  return (
    <article className="rounded-md border border-line bg-canvas p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm leading-relaxed">{activity.message}</p>
        <ActivityMeta activity={activity} />
      </div>
      {currentRevision !== null && activity.revision !== currentRevision ? (
        <p className="mt-2 text-xs text-amber">
          {activity.revision === null ? '此摘要未关联版本' : `此摘要属于第 ${activity.revision} 版`}；下方材料摘录按当前第 {currentRevision} 版快照匹配。
        </p>
      ) : null}
      {linkedEvidence.length ? (
        <div className="mt-3 flex flex-col gap-2">
          {linkedEvidence.slice(0, 5).map((item) => (
            <blockquote key={item.id} className="border-l-2 border-line-strong pl-3 text-sm text-ink-soft">
              <p className="whitespace-pre-wrap">{excerpt(item.quote)}</p>
              <footer className="mt-1 text-xs text-mute">
                {documentIndexes.has(item.document_id) ? `材料第 ${documentIndexes.get(item.document_id)} 份` : '材料'}{item.page === null ? '' : ` · 第 ${item.page} 页`}
              </footer>
            </blockquote>
          ))}
          {linkedEvidence.length > 5 ? <p className="text-xs text-mute">另有 {linkedEvidence.length - 5} 段关联材料。</p> : null}
        </div>
      ) : null}
      {linkedRules.length ? (
        <ul className="mt-3 flex flex-col gap-2">
          {linkedRules.slice(0, 8).map((rule) => {
            const presentation = rulePresentation(rule);
            return (
              <li key={rule.rule_id} className="rounded-md border border-line bg-surface px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Tag tone={presentation.tone as Tone}>{presentation.label}</Tag>
                  <Tag tone="neutral">{presentation.natureLabel}</Tag>
                  <span className="font-medium">{rule.rule_id} · {rule.title}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-ink-soft">{excerpt(rule.reason)}</p>
                <p className="mt-1 text-xs text-mute">{presentation.factLabel}</p>
                {rule.citation?.url ? (
                  <a className="mt-2 inline-block break-all text-blue underline" href={rule.citation.url} target="_blank" rel="noreferrer">
                    查看规则来源{rule.citation.document ? `：${rule.citation.document}` : ''}
                  </a>
                ) : null}
              </li>
            );
          })}
          {linkedRules.length > 8 ? <li className="text-xs text-mute">另有 {linkedRules.length - 8} 项关联规则。</li> : null}
        </ul>
      ) : null}
    </article>
  );
}

function ActivityMeta({ activity }: { activity: Activity }) {
  const time = displayTime(activity.timestamp);
  return (
    <span className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-mute">
      {time ? <time dateTime={activity.timestamp}>{time}</time> : null}
      <span>{activity.revision === null ? '未关联版本' : `第 ${activity.revision} 版`}</span>
      {activity.page !== undefined && activity.total_pages !== undefined
        ? <span>第 {activity.page}/{activity.total_pages} 页</span>
        : null}
    </span>
  );
}

function CalculationPreview({ calculation }: { calculation: LoanResult | null }) {
  if (!calculation) {
    return <p className="text-sm text-mute">当前材料暂不足以完成借款成本计算。</p>;
  }
  const comparison = calculation.calculation.comparison;
  const comparisonMethod = comparison.method_basis === 'assumed_simple' ? '按单利推定' : comparison.method_basis === 'unavailable' ? '口径待确认' : methodNames[comparison.method] ?? comparison.method;
  const rows = [
    ['本金', money(calculation.summary.principal)],
    ['实际到账', money(calculation.summary.disbursed)],
    ['额外费用', money(calculation.summary.total_additional_fees)],
    ['总成本', money(calculation.summary.total_cost)],
    [`计算年化（${comparisonMethod}）`, percent(calculation.calculation.comparison.computed_apr)],
  ] as const;
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {rows.map(([label, value]) => (
        <div key={label} className="min-w-0 rounded-md bg-canvas px-3 py-2">
          <dt className="text-xs text-mute">{label}</dt>
          <dd className="mt-1 break-words text-sm font-medium tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function RulePreview({ rules }: { rules: RuleResult[] }) {
  if (!rules.length) return <p className="text-sm text-mute">暂无规则检查结果。</p>;
  return (
    <ul className="divide-y divide-line">
      {rules.map((rule) => {
        const presentation = rulePresentation(rule);
        return (
          <li key={rule.rule_id} className="py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-2">
              <Tag tone={presentation.tone as Tone}>{presentation.label}</Tag>
              <Tag tone="neutral">{presentation.natureLabel}</Tag>
              {presentation.levelLabel ? <Tag tone={presentation.tone as Tone}>{presentation.levelLabel}</Tag> : null}
              <span className="text-sm font-medium">{rule.rule_id} · {rule.title}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">{rule.reason}</p>
            <p className="mt-1 text-xs text-mute">{presentation.factLabel}</p>
            {rule.citation ? (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-mute">
                <span>{rule.citation.document}{rule.citation.article ? ` · ${rule.citation.article}` : ''}</span>
                {rule.citation.url ? (
                  <a className="break-all text-blue underline" href={rule.citation.url} target="_blank" rel="noreferrer">查看来源</a>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function RulePreviewDetails({ rules }: { rules: RuleResult[] }) {
  const { counts } = summarizeRules(rules);
  return (
    <details className="rounded-md border border-line">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
        规则检查（确认问题 {counts.confirmed_issues} · 待核实 {counts.pending_checks} · 阅读提示 {counts.advisory_hints} · 总项数 {rules.length}）
      </summary>
      <div className="max-h-96 overflow-y-auto px-4 pb-4">
        <RulePreview rules={rules} />
      </div>
    </details>
  );
}

function DraftPreview({ draft }: { draft: ReportDraft }) {
  if (!['streaming', 'validating', 'retrying'].includes(draft.status)) return null;
  const sectionNames: Record<ReportDraft['sections'][number]['kind'], string> = {
    summary: '摘要',
    finding: '检查发现',
    action: '核实建议',
    limitation: '局限说明',
  };
  return (
    <Card className="min-w-0 border-amber-line/60" padding="md">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-medium">报告草稿 · 未校验</h3>
        <Tag tone="amber">{draft.status === 'retrying' ? '正在重试' : draft.status === 'validating' ? '正在校验' : '正在生成'}</Tag>
      </div>
      {draft.sections.length ? (
        <div data-testid="report-draft-content" className="mt-4 max-h-80 overflow-y-auto pr-1">
          <div className="flex flex-col gap-3">
            {draft.sections.map((section) => (
              <section key={section.id} className="rounded-md bg-canvas p-3">
                <h4 className="text-xs font-medium text-mute">{sectionNames[section.kind]}{section.rule_id ? ` · ${section.rule_id}` : ''}</h4>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">{section.text}</p>
              </section>
            ))}
          </div>
        </div>
      ) : <p className="mt-3 text-sm text-mute">草稿内容正在到达。</p>}
    </Card>
  );
}

function LiveCategories({ categories }: { categories: LenderSearchCategory[] }) {
  if (!categories.length) return null;
  return (
    <section aria-labelledby="process-categories-heading" className="flex flex-col gap-3">
      <h3 id="process-categories-heading" className="text-base font-medium">公开来源检索</h3>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {categories.map((category) => (
          <Card key={category.kind} padding="md" className="min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-medium">{categoryName[category.kind]}</h4>
              <Tag tone={category.status === 'sources_found' ? 'green' : category.status === 'unavailable' ? 'amber' : 'neutral'}>
                {categoryStatus[category.status]}
              </Tag>
            </div>
            {category.sources.length ? (
              <ul className="mt-3 flex max-h-64 flex-col gap-3 overflow-y-auto">
                {category.sources.map((source) => (
                  <li key={source.url} className="min-w-0 border-t border-line pt-3 first:border-0 first:pt-0">
                    <a className="break-words text-sm font-medium text-blue underline" href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
                    {source.snippet ? <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-ink-soft">{excerpt(source.snippet, 500)}</p> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="mt-3 text-xs text-mute">此分类目前没有可展示的来源。</p>}
          </Card>
        ))}
      </div>
    </section>
  );
}

function ParsedDocuments({ parsed }: { parsed: Record<string, DocumentParsed> }) {
  const documents = Object.entries(parsed);
  if (!documents.length) return null;
  return (
    <section aria-labelledby="process-documents-heading" className="flex flex-col gap-3">
      <h3 id="process-documents-heading" className="text-base font-medium">已读取的材料文字</h3>
      <div className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1">
        {documents.map(([documentId, document], index) => (
          <details key={documentId} className="rounded-md border border-line bg-canvas">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
              第 {index + 1} 份 PDF · {document.page_count} 页
            </summary>
            <div className="flex flex-col gap-2 px-3 pb-3">
              {document.pages.map((page) => {
                const clipped = page.text.length > PAGE_TEXT_LIMIT;
                return (
                  <details key={page.page} className="rounded-md border border-line bg-surface">
                    <summary className="cursor-pointer px-3 py-2 text-sm">第 {page.page} 页</summary>
                    <div className="max-h-72 overflow-auto px-3 pb-3">
                      <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-ink-soft">
                        {clipped ? page.text.slice(0, PAGE_TEXT_LIMIT) : page.text}
                      </pre>
                      {clipped ? <p className="mt-2 text-xs text-mute">本页内容较长，仅显示前 {PAGE_TEXT_LIMIT.toLocaleString('zh-CN')} 个字符。</p> : null}
                      {!page.text ? <p className="text-sm text-mute">此页没有可显示的文本。</p> : null}
                    </div>
                  </details>
                );
              })}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

export default function ProcessPanel({
  state,
  onCancel,
}: {
  state: CaseState;
  onCancel: () => void;
}) {
  const [elapsedSeconds, setElapsedSeconds] = useState<number | null>(null);
  const activities = state.activities.slice(-ACTIVITY_LIMIT);
  const newest = activities[activities.length - 1];
  const processActivities = activities.filter((activity) => activity.kind !== 'analysis');
  const analyses = activities.filter((activity) => activity.kind === 'analysis');
  const visibleEvidence = state.current?.evidence ?? [];
  const documentIndexes = new Map(Object.keys(state.parsed).map((documentId, index) => [documentId, index + 1]));
  const currentRevision = state.current?.revision ?? null;
  const rulesForActivity = (activity: Activity) => {
    if (activity.revision === null) return [];
    if (state.checked?.revision === activity.revision) return state.checked.rules;
    if (state.current?.revision === activity.revision) return state.current.report?.rules ?? [];
    return [];
  };
  const hasFinalReport = Boolean(state.current?.report);
  const showCheckedPreview = Boolean(state.checked && (
    !hasFinalReport || (state.busy && ['calculate', 'check_rules', 'write_report'].includes(state.stage))
  ));
  const draft = state.draft?.status === 'streaming' || state.draft?.status === 'validating' || state.draft?.status === 'retrying'
    ? state.draft
    : null;
  const hasProcessContent = state.busy || activities.length > 0 || Boolean(state.checked) ||
    Object.keys(state.parsed).length > 0 || state.liveCategories.length > 0 || draft !== null;

  useEffect(() => {
    if (!state.busy || !state.startedAt) {
      setElapsedSeconds(null);
      return;
    }
    const started = Date.parse(state.startedAt);
    if (!Number.isFinite(started)) {
      setElapsedSeconds(null);
      return;
    }
    const updateElapsed = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - started) / 1_000)));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1_000);
    return () => window.clearInterval(timer);
  }, [state.busy, state.startedAt]);

  if (!hasProcessContent) return null;

  const newestTime = newest ? displayTime(newest.timestamp) : null;
  const fallbackStatus = state.stage ? stageName(state.stage) : '等待处理状态';
  const newestMessage = state.error?.message ?? state.warning ?? newest?.message ?? fallbackStatus;

  return (
    <Card as="section" aria-labelledby="process-panel-heading" className="mb-6 flex min-w-0 flex-col gap-5" padding="md">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id="process-panel-heading" className="text-lg font-medium">处理进度</h2>
          <div role="status" aria-live="polite" className="mt-2 flex flex-wrap items-center gap-2">
            {state.error?.code === 'TASK_CANCELLED' ? <Tag tone="amber">已取消</Tag> : state.error ? <Tag tone="neutral">未完成</Tag> : state.warning ? <Tag tone="amber">需留意</Tag> : newest ? <Tag tone={activityStatus[newest.status].tone}>{activityStatus[newest.status].label}</Tag> : <Tag tone={state.busy ? 'blue' : 'neutral'}>{state.busy ? '处理中' : '状态'}</Tag>}
            <p className="min-w-0 whitespace-pre-wrap text-sm leading-relaxed">{newestMessage}</p>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-mute">
            {state.busy && elapsedSeconds !== null ? <span>已运行 {elapsedSeconds} 秒</span> : null}
            {state.startedAt ? <span>开始：{displayTime(state.startedAt)}</span> : null}
            {!state.busy && state.finishedAt ? <span>结束：{displayTime(state.finishedAt)}</span> : null}
            {state.lastModelAt ? <span>最近模型活动：{displayTime(state.lastModelAt)}</span> : null}
            {newest && newestTime ? <span>最新活动：{newestTime}{newest.revision === null ? '' : ` · 第 ${newest.revision} 版`}</span> : null}
          </div>
        </div>
        {state.busy ? <Button variant="secondary" className="shrink-0" onClick={onCancel}>取消任务</Button> : null}
      </header>

      {draft !== null ? <DraftPreview draft={draft} /> : null}

      {showCheckedPreview && state.checked ? (
        <section aria-labelledby="process-check-heading" className="flex min-w-0 flex-col gap-4">
          <div>
            <h3 id="process-check-heading" className="text-base font-medium">计算与规则检查</h3>
            <p className="mt-1 text-xs text-mute">第 {state.checked.revision} 版 · 以下结果来自本次已完成的计算和规则检查。</p>
          </div>
          <CalculationPreview calculation={state.checked.calculation} />
          <RulePreviewDetails rules={state.checked.rules} />
        </section>
      ) : null}

      {analyses.length ? (
        <details open={state.busy || undefined} className="rounded-md border border-line">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">分析摘要（{analyses.length} 条）</summary>
          <div className="flex max-h-96 flex-col gap-3 overflow-y-auto px-4 pb-4">
            {analyses.map((activity) => (
              <AnalysisSummary
                key={activity.id}
                activity={activity}
                evidence={visibleEvidence}
                rules={rulesForActivity(activity)}
                currentRevision={currentRevision}
                documentIndexes={documentIndexes}
              />
            ))}
          </div>
        </details>
      ) : null}

      {state.liveCategories.length ? <LiveCategories categories={state.liveCategories} /> : null}
      <ParsedDocuments parsed={state.parsed} />

      {processActivities.length ? (
        <details className="rounded-md border border-line">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            处理时间线（{processActivities.length} 条）
          </summary>
          <ol aria-label="处理时间线" className="max-h-80 overflow-y-auto px-4 pb-4">
            {processActivities.map((activity) => (
              <li key={activity.id} className="relative border-l border-line py-3 pl-4 first:pt-1 last:pb-1">
                <span aria-hidden="true" className="absolute -left-1 top-4 size-2 rounded-full bg-line-strong" />
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm leading-relaxed">{activity.message}</p>
                  <Tag tone={activityStatus[activity.status].tone}>{activityStatus[activity.status].label}</Tag>
                </div>
                <ActivityMeta activity={activity} />
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </Card>
  );
}
