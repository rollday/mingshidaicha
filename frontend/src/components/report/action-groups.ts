/** Group only identical advice; retain every rule that refers to it. */
export function groupActions(actions: readonly { text: string; rule_id: string | null }[]) {
  const grouped = new Map<string, { text: string; ruleIds: string[] }>();
  for (const action of actions) {
    const key = action.text.trim();
    let group = grouped.get(key);
    if (!group) {
      group = { text: action.text, ruleIds: [] };
      grouped.set(key, group);
    }
    if (action.rule_id && !group.ruleIds.includes(action.rule_id)) group.ruleIds.push(action.rule_id);
  }
  return [...grouped.values()];
}
