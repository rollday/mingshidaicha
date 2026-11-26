export type MaterialRole = 'disclosure' | 'contract' | 'schedule' | 'other';

/**
 * The role is only a hint for the extraction prompt, never a routing decision, so a wrong guess is
 * cheap. The order below follows what the report depends on most: the disclosure table is the basis
 * every later comparison uses, so a combined "contract + disclosure" scan is typed as disclosure.
 */
const rules: [MaterialRole, RegExp][] = [
  ['disclosure', /明示|披露|综合融资成本|融资成本表/],
  ['schedule', /还款计划|还款表|还款安排|还款明细/],
  ['contract', /合同|协议|借据|条款/],
];

export function guessMaterialRole(fileName: string): MaterialRole {
  const name = fileName.replace(/\.(pdf|jpe?g|png)$/i, '').normalize('NFKC');
  for (const [role, pattern] of rules) if (pattern.test(name)) return role;
  return 'other';
}
