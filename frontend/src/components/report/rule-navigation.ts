export const RULE_NAVIGATION_EVENT = 'report:rule-navigation';

export function ruleAnchorId(ruleId: string): string {
  return `rule-${encodeURIComponent(ruleId)}`;
}

export function ruleIdFromHash(hash: string): string | null {
  const prefix = '#rule-';
  if (!hash.startsWith(prefix)) return null;

  try {
    const ruleId = decodeURIComponent(hash.slice(prefix.length));
    return ruleId.length ? ruleId : null;
  } catch {
    return null;
  }
}

export function resolveRuleHash(hash: string, ruleIds: ReadonlySet<string>): string | null {
  const ruleId = ruleIdFromHash(hash);
  return ruleId && ruleIds.has(ruleId) ? ruleId : null;
}

export function addExpandedRule(expandedRuleIds: ReadonlySet<string>, ruleId: string): Set<string> {
  if (expandedRuleIds.has(ruleId)) return new Set(expandedRuleIds);
  return new Set([...expandedRuleIds, ruleId]);
}

export function toggleExpandedRule(expandedRuleIds: ReadonlySet<string>, ruleId: string): Set<string> {
  const next = new Set(expandedRuleIds);
  if (next.has(ruleId)) next.delete(ruleId);
  else next.add(ruleId);
  return next;
}

export function navigateToRule(ruleId: string): void {
  const hash = `#${ruleAnchorId(ruleId)}`;
  if (window.location.hash !== hash) {
    window.history.pushState(window.history.state, '', hash);
  }
  window.dispatchEvent(new Event(RULE_NAVIGATION_EVENT));
}
