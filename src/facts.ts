import type { CaseFacts } from './domain.ts';

/** Apply the project's missing-contingent-cost default to confirmed table facts. */
export function normalizeCaseFacts(facts: CaseFacts): CaseFacts {
  const disclosure = facts.disclosure;
  if (disclosure.contingent_disclosed !== null || disclosure.present !== true || disclosure.items_complete !== true) return facts;
  // Unknown fee nature or disclosure status can still represent a contingent
  // row in the table, so it cannot establish the absence of such a row.
  const possibleContingentRow = facts.fees.some(fee => fee.contingent !== false && fee.in_disclosure !== false);
  if (possibleContingentRow) return facts;
  return { ...facts, disclosure: { ...disclosure, contingent_disclosed: false } };
}
