import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRules } from '../src/rules.ts';
import type { CaseFacts, Evidence, LoanResult } from '../src/domain.ts';

const baseFacts: CaseFacts = {
  borrower: { is_student: false, purpose: 'personal consumption' },
  lender: { name: 'Example Bank', type: 'bank', licensed: true, internet_consumer_loan: true, internet_assisted: null },
  loan: {
    principal: '10000', disbursed: '10000', term_periods: 12, periods_per_year: 12,
    repay_method: 'equal_installment', period_payment: '900', nominal_apr: '0.1', start_date: '2026-08-01',
  },
  repayments: [],
  fees: [],
  disclosure: { present: true, quoted_apr: '0.1', quoted_method: 'effective', items_complete: true, contingent_disclosed: true },
  funds_to: 'borrower',
  marketing_phrases: ['按合同约定还款'],
};

function loanResult(exceeds: boolean | null): LoanResult {
  return {
    input: {},
    calculation: {
      cashflows: [], nominal_apr: null, effective_apr: null, simple_apr: null, xirr_apr: null,
      comparison: { method: 'effective', quoted_apr: '0.1', computed_apr: '0.1', gap_pp: '0', exceeds_tolerance: exceeds },
    },
    summary: { principal: '10000', disbursed: '10000', total_repayment: '10800', total_additional_fees: '0', total_cost: '800' },
    fee_totals: [],
  };
}

function run(facts: CaseFacts = baseFacts, result: LoanResult | null = loanResult(false), evidence: Evidence[] = [], as_of?: string) {
  return evaluateRules(facts, result, evidence, as_of ? { as_of } : undefined);
}

function byId(rows: ReturnType<typeof evaluateRules>, id: string) {
  const found = rows.find((row) => row.rule_id === id);
  assert.ok(found, `missing ${id}`);
  return found;
}

test('returns all ten deterministic rules for a complete, non-flagged case', () => {
  const rows = run();
  assert.equal(rows.length, 10);
  assert.deepEqual(rows.map((row) => row.rule_id), Array.from({ length: 10 }, (_, i) => `R${String(i + 1).padStart(2, '0')}`));
  assert.equal(rows.some((row) => row.status === 'triggered'), false);
  assert.equal(byId(rows, 'R01').status, 'not_triggered');
  assert.equal(byId(rows, 'R03').status, 'not_triggered');
  assert.equal(byId(rows, 'R06').status, 'not_triggered');
  assert.equal(byId(rows, 'R08').status, 'not_applicable');
  assert.equal(byId(rows, 'R09').status, 'not_triggered');
});

test('flags a confirmed omitted normal fee but does not treat contingent costs as normal fees', () => {
  const facts: CaseFacts = {
    ...baseFacts,
    fees: [
      { id: 'fee-1', name: '服务费', amount: '100', timing: 'upfront', period: null, payee: 'Partner', payee_type: 'other', in_disclosure: false, included_in_cashflows: true, contingent: false, included_in_disclosed_cost: null },
      { id: 'fee-2', name: '逾期罚息', amount: '20', timing: 'unknown', period: null, payee: 'Lender', payee_type: 'lender', in_disclosure: false, included_in_cashflows: false, contingent: true, included_in_disclosed_cost: null },
    ],
  };
  const rows = run(facts);
  assert.equal(byId(rows, 'R03').status, 'triggered');
  assert.equal(byId(rows, 'R04').status, 'not_triggered');
  assert.equal(byId(rows, 'R10').status, 'not_triggered');
});

test('R06 triggers only when all three student microloan conditions are true', () => {
  const studentLoan: CaseFacts = {
    ...baseFacts,
    borrower: { is_student: true, purpose: 'tuition' },
    lender: { name: 'Example Microloan', type: 'microloan', licensed: true, internet_consumer_loan: true, internet_assisted: null },
  };
  assert.equal(byId(run(studentLoan), 'R06').status, 'triggered');
  assert.equal(byId(run({ ...studentLoan, lender: { ...studentLoan.lender, internet_consumer_loan: false } }), 'R06').status, 'not_triggered');
  assert.equal(byId(run({ ...studentLoan, lender: { ...studentLoan.lender, internet_consumer_loan: null, internet_assisted: null } }), 'R06').status, 'insufficient_data');
});

test('does not apply provisions before their effective date and respects as_of', () => {
  const preEffective = { ...baseFacts, loan: { ...baseFacts.loan, start_date: '2025-09-30' } };
  assert.equal(byId(run(preEffective), 'R01').status, 'not_applicable');
  assert.equal(byId(run(preEffective), 'R05').status, 'not_applicable');
  assert.equal(byId(run(baseFacts, loanResult(false), [], '2026-07-31'), 'R01').status, 'not_applicable');
  assert.equal(byId(run(baseFacts, loanResult(false), [], '2026-07-31'), 'R06').status, 'not_triggered');
});

test('unknown facts remain insufficient rather than passing', () => {
  const facts: CaseFacts = {
    ...baseFacts,
    lender: { name: null, type: 'unknown', licensed: null, internet_consumer_loan: null, internet_assisted: null },
    borrower: { is_student: null, purpose: 'unknown' },
    loan: { ...baseFacts.loan, start_date: null },
    disclosure: { present: null, quoted_apr: null, quoted_method: 'unknown', items_complete: null, contingent_disclosed: null },
    funds_to: 'unknown',
    marketing_phrases: [],
  };
  const rows = run(facts, null);
  for (const id of ['R01', 'R02', 'R03', 'R04', 'R05', 'R06', 'R07', 'R08', 'R09', 'R10']) {
    assert.equal(byId(rows, id).status, 'insufficient_data', id);
  }
});

test('R02 uses only Python comparison.exceeds_tolerance and preserves unknown', () => {
  assert.equal(byId(run(baseFacts, loanResult(true)), 'R02').status, 'triggered');
  assert.equal(byId(run(baseFacts, loanResult(false)), 'R02').status, 'not_triggered');
  assert.equal(byId(run(baseFacts, loanResult(null)), 'R02').status, 'insufficient_data');
  assert.equal(byId(run(baseFacts, null), 'R02').status, 'insufficient_data');
});

test('R05 does not assert platform fee illegality without proof of assist-loan applicability', () => {
  const facts: CaseFacts = {
    ...baseFacts,
    fees: [{ id: 'platform-fee', name: '平台服务费', amount: '100', timing: 'upfront', period: null, payee: 'Platform', payee_type: 'platform', in_disclosure: false, included_in_cashflows: false, contingent: false, included_in_disclosed_cost: null }],
  };
  const row = byId(run(facts), 'R05');
  assert.equal(row.status, 'insufficient_data');
  assert.match(row.reason, /不能证明/);
  assert.equal(byId(run({ ...facts, lender: { ...facts.lender, type: 'microloan' } }), 'R05').status, 'not_applicable');
});

test('evidence references contain only IDs present in supplied evidence', () => {
  const evidence: Evidence[] = [{ id: 'ev-disclosure', field: 'disclosure.items_complete', document_id: 'doc-1', page: 1, quote: '明示表项目不完整' }];
  const facts = { ...baseFacts, disclosure: { ...baseFacts.disclosure, items_complete: false } };
  assert.deepEqual(byId(run(facts, loanResult(false), evidence), 'R01').evidence_ids, ['ev-disclosure']);
  assert.deepEqual(byId(run(facts), 'R01').evidence_ids, []);
});

test('R08 and R09 are blue advisory hints rather than confirmed issues', () => {
  const facts: CaseFacts = {
    ...baseFacts,
    borrower: { is_student: false, purpose: '职业培训' },
    funds_to: 'training_provider',
    marketing_phrases: ['无需征信，百分之百通过'],
  };
  const rows = run(facts);
  assert.equal(byId(rows, 'R08').status, 'triggered');
  assert.equal(byId(rows, 'R08').level, 'blue');
  assert.equal(byId(rows, 'R08').nature, 'advisory');
  assert.equal(byId(rows, 'R08').risk_level, null);
  assert.equal(byId(rows, 'R09').status, 'triggered');
  assert.equal(byId(rows, 'R09').level, 'blue');
  assert.equal(byId(rows, 'R08').citation?.verification, 'local_material_only');
  assert.equal(byId(rows, 'R09').citation?.verification, 'local_material_only');
});

test('unknown contingency never becomes a confirmed normal fee', () => {
  const facts: CaseFacts = { ...baseFacts, fees: [{ id: 'unknown', name: '担保费', amount: '50', timing: 'per_period', period: null, payee: null, payee_type: 'guarantor', in_disclosure: false, included_in_cashflows: false, included_in_disclosed_cost: false, contingent: null }] };
  assert.equal(byId(run(facts), 'R03').status, 'insufficient_data');
  assert.equal(byId(run(facts), 'R04').status, 'insufficient_data');
});

test('a fee outside repayment totals is distinct from a fee omitted from disclosed cost', () => {
  const facts: CaseFacts = { ...baseFacts, fees: [{ id: 'guarantee', name: '担保费', amount: '50', timing: 'per_period', period: null, payee: '保证机构', payee_type: 'guarantor', in_disclosure: true, included_in_cashflows: false, included_in_disclosed_cost: true, contingent: false }] };
  assert.equal(byId(run(facts), 'R04').status, 'not_triggered');
  facts.fees[0]!.included_in_disclosed_cost = false;
  assert.equal(byId(run(facts), 'R04').status, 'triggered');
});

test('confirmed assisted lending scope allows a specific platform fee check', () => {
  const facts: CaseFacts = { ...baseFacts, lender: { ...baseFacts.lender, internet_assisted: true }, fees: [{ id: 'platform', name: '服务费', amount: '50', timing: 'per_period', period: null, payee: '平台', payee_type: 'platform', in_disclosure: false, included_in_cashflows: false, included_in_disclosed_cost: false, contingent: false }] };
  assert.equal(byId(run(facts), 'R05').status, 'triggered');
});
