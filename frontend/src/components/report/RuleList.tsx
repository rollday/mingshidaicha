import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AuditReport, RuleResult } from '../../types/audit.ts';
import { rulePresentation } from '../../../../shared/rule-policy.ts';
import { moneyPlain, percent } from '../../lib/format.ts';
import { AccordionCard, Card, Tag, type Tone } from '../base/index.tsx';
import { resolveRuleHash, ruleAnchorId } from './rule-navigation.ts';

type CopyState = 'copied' | 'manual' | undefined;

function scrollRuleIntoView(target: HTMLElement) {
  const behavior = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  const scroll = () => {
    if (target.isConnected) target.scrollIntoView({ block: 'start', behavior });
  };
  const animationRoot = target.closest('.animate-rise');
  const activeAnimations = animationRoot?.getAnimations().filter((animation) => animation.playState === 'running') ?? [];

  if (activeAnimations.length) {
    void Promise.all(activeAnimations.map((animation) => animation.finished.catch(() => undefined))).then(scroll);
  } else {
    scroll();
  }
}

export function RuleList({ report }: { report: AuditReport }) {
  const [otherRulesOpen, setOtherRulesOpen] = useState(false);
  const [pendingRuleId, setPendingRuleId] = useState<string | null>(null);
  const visibleByDefault = report.rules.filter((rule) => rule.status === 'triggered' || rule.status === 'insufficient_data');
  const foldedRules = report.rules.filter((rule) => rule.status === 'not_triggered' || rule.status === 'not_applicable');
  const notTriggeredCount = foldedRules.filter((rule) => rule.status === 'not_triggered').length;
  const notApplicableCount = foldedRules.filter((rule) => rule.status === 'not_applicable').length;
  const levelWeight: Record<RuleResult['level'], number> = { red: 0, yellow: 1, blue: 2 };
  const visibleRules = [...visibleByDefault].sort((a, b) => levelWeight[a.level] - levelWeight[b.level] || a.rule_id.localeCompare(b.rule_id));
  const looseActions = [...new Set(report.narrative.actions.filter((action) => action.rule_id === null).map((action) => action.text.trim()).filter(Boolean))];
  const { confirmed_issues: confirmed, pending_checks: pending } = report.conclusion.counts;
  const heading = confirmed > 0
    ? `这份材料有 ${confirmed} 个已确认问题${pending > 0 ? `，${pending} 项待核实` : ''}`
    : pending > 0
      ? `这份材料有 ${pending} 项待核实`
      : report.rules.length
        ? '未发现问题'
        : '没有可展示的核查结果';

  const navigateFromLocation = useCallback(() => {
    const ruleIds = new Set(report.rules.map((rule) => rule.rule_id));
    const ruleId = resolveRuleHash(window.location.hash, ruleIds);
    if (!ruleId) {
      setPendingRuleId(null);
      return;
    }
    const targetRule = report.rules.find((rule) => rule.rule_id === ruleId);
    if (targetRule?.status === 'not_triggered' || targetRule?.status === 'not_applicable') setOtherRulesOpen(true);
    setPendingRuleId(ruleId);
  }, [report.rules]);

  useEffect(() => {
    setOtherRulesOpen(false);
  }, [report.rules]);

  useEffect(() => {
    window.addEventListener('hashchange', navigateFromLocation);
    window.addEventListener('popstate', navigateFromLocation);
    navigateFromLocation();
    return () => {
      window.removeEventListener('hashchange', navigateFromLocation);
      window.removeEventListener('popstate', navigateFromLocation);
    };
  }, [navigateFromLocation]);

  useLayoutEffect(() => {
    if (!pendingRuleId) return;
    const target = document.getElementById(ruleAnchorId(pendingRuleId));
    if (!target) {
      setPendingRuleId(null);
      return;
    }

    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        scrollRuleIntoView(target);
        setPendingRuleId(null);
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [otherRulesOpen, pendingRuleId]);

  return (
    <section id="report-rules" className="scroll-mt-20 flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-medium">{heading}</h2>
        <p className="text-sm text-mute">按「对你影响多大」排序；每条都能追到原文和法规出处。待核实的项不并入结论。</p>
      </header>
      <div className="flex flex-col gap-3">
        {visibleRules.map((rule) => <IssueCard key={rule.rule_id} rule={rule} report={report} />)}
        {visibleRules.length === 0 && report.rules.length ? (
          <Card><p className="text-sm text-mute">所有规则均已检查，材料中暂未发现需要提示的问题。</p></Card>
        ) : null}
        {looseActions.length ? <LooseActions actions={looseActions} /> : null}
        {foldedRules.length ? (
          <div className="scroll-mt-20">
            <AccordionCard
              title={<span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1"><span>其他规则</span><span className="text-sm font-normal text-mute">未命中 {notTriggeredCount} 条 · 不适用 {notApplicableCount} 条</span></span>}
              open={otherRulesOpen}
              onToggle={() => setOtherRulesOpen((open) => !open)}
              dense
            >
              <div className="flex flex-col gap-3">
                {foldedRules.map((rule) => <FoldedRule key={rule.rule_id} rule={rule} report={report} />)}
              </div>
            </AccordionCard>
          </div>
        ) : null}
        {!report.rules.length ? <Card><p className="text-sm text-mute">报告中没有规则检查结果。</p></Card> : null}
      </div>
    </section>
  );
}

function IssueCard({ rule, report }: { rule: RuleResult; report: AuditReport }) {
  const presentation = rulePresentation(rule);
  const actions = actionsFor(rule, report);
  const ask = askFor(rule, report);
  const evidence = [...new Map(report.evidence.filter((item) => rule.evidence_ids.includes(item.id)).map(item => [JSON.stringify([item.document_id, item.page, item.quote]), item])).values()];
  const statusLabel = rule.status === 'insufficient_data' ? '待核实' : rule.nature === 'advisory' ? '阅读提示' : '已确认';
  const statusTone: Tone = rule.status === 'insufficient_data' || rule.nature === 'advisory' ? 'blue' : 'red';
  const copy = useCopyFeedback();
  const copyKey = rule.rule_id;

  return (
    <article id={ruleAnchorId(rule.rule_id)} className="scroll-mt-20 rounded-lg border border-line bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={statusTone}>{statusLabel}</Tag>
        <Tag tone="neutral">{presentation.natureLabel}</Tag>
        <Tag tone="neutral">{rule.rule_id}</Tag>
      </div>
      <h3 className="mt-3 text-base font-semibold leading-relaxed text-ink">{issueHeadline(rule, report)}</h3>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">{rule.reason}</p>

      {actions.length ? (
        <div className="mt-4 rounded-md bg-canvas px-4 py-3">
          <p className="text-xs text-mute">建议动作</p>
          {actions.map((text) => <p key={text} className="mt-1 text-sm leading-relaxed text-ink">{text}</p>)}
          <p className="mt-3 text-xs text-mute">可以直接复制发出去的问法</p>
          <p ref={(node) => { copy.targets.current.set(copyKey, node); }} className="mt-1 rounded-sm border border-line bg-surface px-3 py-2 text-sm leading-relaxed text-ink-soft">“{ask}”</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            <button type="button" onClick={() => void copy.copyText(copyKey, ask)} className="inline-flex min-h-11 items-center text-sm text-blue underline underline-offset-2">
              {copy.states[copyKey] === 'copied' ? '已复制' : copy.states[copyKey] === 'manual' ? '再试一次复制' : '复制这条建议'}
            </button>
            <span className="text-xs text-line-strong">·</span>
            <span className="text-xs text-mute">依据见下方「材料摘录与依据」</span>
          </div>
          {copy.states[copyKey] === 'manual' ? <p className="mt-1 text-xs text-amber" role="status">自动复制失败，文字已选中，请手动复制。</p> : null}
        </div>
      ) : null}

      <details className="mt-4 border-t border-dashed border-line pt-3">
        <summary className="cursor-pointer text-xs font-medium text-blue">材料摘录与依据</summary>
        <div className="mt-3 flex flex-col gap-3">
          {evidence.map((item) => (
            <div key={item.id} className="border-l-2 border-line-strong pl-3">
              <p className="text-xs text-mute">材料原文 · {item.document_id}{item.page === null ? '' : ` · 第 ${item.page} 页`}{item.source_type === 'vision_transcript' ? ' · 图像转录，待核对' : ''}</p>
              <q className="mt-1 block whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">{item.quote}</q>
            </div>
          ))}
          {!evidence.length ? <p className="text-xs text-mute">未找到可直接引用的原文摘录，请核对原始材料。</p> : null}
          {rule.citation ? (
            <div className="rounded-md bg-canvas px-4 py-3">
              <p className="text-sm font-medium">依据：{rule.citation.document}{rule.citation.article ? ` · ${rule.citation.article}` : ''}</p>
              {rule.citation.quote ? <blockquote className="mt-2 text-sm leading-relaxed text-ink-soft">{rule.citation.quote}</blockquote> : null}
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-mute">
                {rule.citation.effective_date ? <span>生效日期：{rule.citation.effective_date}</span> : null}
                <span>{rule.citation.verification === 'official_checked' ? '来源已作官方核对' : '依据为本地材料，未作官方核对'}</span>
              </div>
              {rule.citation.url ? <a className="mt-2 inline-block break-all text-sm text-blue underline underline-offset-2" href={rule.citation.url} target="_blank" rel="noreferrer">查看规定原文 ↗</a> : null}
            </div>
          ) : <p className="text-xs text-mute">此项没有附带条款出处。</p>}
        </div>
      </details>
    </article>
  );
}

function LooseActions({ actions }: { actions: string[] }) {
  const copy = useCopyFeedback();
  return (
    <Card padding="wide" className="flex flex-col gap-3">
      <h3 className="text-base font-medium">其他建议</h3>
      {actions.map((text, index) => {
        const key = `loose-${index}`;
        return (
          <div key={key} className="border-t border-line pt-3 first:border-0 first:pt-0">
            <p ref={(node) => { copy.targets.current.set(key, node); }} className="text-sm leading-relaxed text-ink">{text}</p>
            <button type="button" onClick={() => void copy.copyText(key, text)} className="mt-1 inline-flex min-h-11 items-center text-sm text-blue underline underline-offset-2">
              {copy.states[key] === 'copied' ? '已复制' : copy.states[key] === 'manual' ? '再试一次复制' : '复制这条建议'}
            </button>
            {copy.states[key] === 'manual' ? <p className="mt-1 text-xs text-amber" role="status">自动复制失败，文字已选中，请手动复制。</p> : null}
          </div>
        );
      })}
    </Card>
  );
}

function FoldedRule({ rule, report }: { rule: RuleResult; report: AuditReport }) {
  const presentation = rulePresentation(rule);
  return (
    <div id={ruleAnchorId(rule.rule_id)} className="scroll-mt-20">
      <details className="rounded-md border border-line bg-surface px-4 py-3">
        <summary className="cursor-pointer text-sm">
          <span className="inline-flex flex-wrap items-center gap-2">
            <Tag tone={presentation.tone as Tone}>{presentation.label}</Tag>
            <Tag tone="neutral">{rule.rule_id}</Tag>
            <span>{rule.title}</span>
          </span>
        </summary>
        <p className="mt-3 whitespace-pre-wrap text-sm text-ink-soft">{rule.reason}</p>
        {rule.citation ? (
          <div className="mt-3 rounded-md bg-canvas px-3 py-2 text-xs text-mute">
            <p className="font-medium text-ink-soft">依据：{rule.citation.document}{rule.citation.article ? ` · ${rule.citation.article}` : ''}</p>
            {rule.citation.quote ? <p className="mt-1">{rule.citation.quote}</p> : null}
            {rule.citation.url ? <a className="mt-1 inline-block break-all text-blue underline" href={rule.citation.url} target="_blank" rel="noreferrer">查看规定原文 ↗</a> : null}
          </div>
        ) : null}
      </details>
    </div>
  );
}

function actionsFor(rule: RuleResult, report: AuditReport): string[] {
  const texts = report.narrative.actions
    .filter((action) => action.rule_id === rule.rule_id)
    .map((action) => action.text.trim())
    .filter(Boolean);
  if (texts.length) return [...new Set(texts)];
  return rule.action.trim() ? [rule.action.trim()] : [];
}

function issueHeadline(rule: RuleResult, report: AuditReport) {
  const comparison = report.calculation?.calculation.comparison;
  const undisclosed = report.facts.fees.filter((fee) => fee.contingent === false && fee.in_disclosure === false);
  if (rule.rule_id === 'R02' && comparison?.quoted_apr != null && comparison.computed_apr != null) {
    return <>按实际支出算，年化是 <mark className="hl-red">{percent(comparison.computed_apr)}</mark>，不是 {percent(comparison.quoted_apr)}</>;
  }
  if (rule.rule_id === 'R03') {
    const fee = undisclosed.find((item) => item.timing === 'per_period' && item.amount !== null);
    if (fee?.amount != null) {
      return <>每期多收 <mark className="hl">{moneyPlain(fee.amount)} 元</mark>，明示表里一个字没写</>;
    }
  }
  if (rule.rule_id === 'R05') {
    const fee = undisclosed.find((item) => item.payee_type === 'platform');
    if (fee) return <>平台直接收 {fee.amount == null ? '这笔费用' : <mark className="hl">{moneyPlain(fee.amount)} 元</mark>}，明示表未列</>;
  }
  return rule.title;
}

function askFor(rule: RuleResult, report: AuditReport): string {
  const comparison = report.calculation?.calculation.comparison;
  const undisclosed = report.facts.fees.filter((fee) => fee.contingent === false && fee.in_disclosure === false);
  const fee = undisclosed[0];
  const perPeriodFee = undisclosed.find((item) => item.timing === 'per_period' && item.amount !== null);
  const quoted = comparison?.quoted_apr ?? report.facts.disclosure.quoted_apr;
  switch (rule.rule_id) {
    case 'R01':
      return '请提供完整的综合融资成本明示表和逐期还款计划，注明每期本金、利息、各项费用及其收取主体。';
    case 'R02':
      return `请问明示表上的${quoted == null ? '年化' : ` ${percent(quoted)}`} 是按什么方式计算的？${perPeriodFee ? `如果把每期 ${moneyPlain(perPeriodFee.amount)} 元${perPeriodFee.name}一起算进去，年化是多少？` : '如果把这些费用一起算进去，年化是多少？'}请书面回复。`;
    case 'R03':
      return `明示表上只写了利息，合同里${fee ? `每期还有 ${moneyPlain(fee.amount)} 元${fee.name}` : '还有其他费用'}。请提供这笔钱的收取依据和明细，并说明为什么没有写进明示表、是否计入了年化。`;
    case 'R04':
      return `合同里的${fee?.name ?? '这笔费用'}是否计入年化？请提供包含这项费用的逐期还款计划和综合融资成本明细。`;
    case 'R05':
      return '这项费用由平台直接收取，依据是什么？请提供平台与贷款人的合作及收费说明，并确认是否计入明示年化。';
    case 'R06':
      return '请说明这笔贷款为什么向在校学生发放，并书面确认额度、期限和用途是否符合学生贷款的相关要求。';
    case 'R07':
      return '请提供放贷方的金融许可证编号和监管登记信息，以便核对资质。';
    case 'R08':
      return '请提供资金实际流向的凭证，并说明这笔贷款是否属于指定用途、资金是否直接支付给第三方。';
    case 'R09':
      return '请提供原始营销页面或宣传材料的完整截图和链接，说明其中的利率、额度、到账时间等表述。';
    case 'R10':
      return '请说明这笔费用在什么条件下发生、金额如何计算，以及为什么没有在明示表中单独列出。';
    default:
      return rule.action.trim() || '请提供这项收费的合同条款、收取依据和书面说明。';
  }
}

function useCopyFeedback() {
  const targets = useRef(new Map<string, HTMLParagraphElement | null>());
  const [states, setStates] = useState<Record<string, CopyState>>({});

  const copyText = async (key: string, text: string) => {
    let copied = false;
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch {
        // Fall through to the legacy copy path, then to manual selection.
      }
    }

    if (!copied) copied = fallbackCopy(text);
    if (copied) {
      setStates((current) => ({ ...current, [key]: 'copied' }));
      window.setTimeout(() => setStates((current) => current[key] === 'copied' ? { ...current, [key]: undefined } : current), 1500);
      return;
    }

    selectText(targets.current.get(key));
    setStates((current) => ({ ...current, [key]: 'manual' }));
  };

  return { targets, states, copyText };
}

function fallbackCopy(text: string): boolean {
  let textarea: HTMLTextAreaElement | null = null;
  try {
    textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea?.remove();
  }
}

function selectText(target: HTMLParagraphElement | null | undefined): void {
  if (!target) return;
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(target);
  selection.removeAllRanges();
  selection.addRange(range);
}
