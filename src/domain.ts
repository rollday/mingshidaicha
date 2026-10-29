import { z } from 'zod';
import { decimal } from './numeric.ts';

const short = z.string().max(300);
const nullableMoney = decimal.nullable().default(null);
export const caseFactsSchema = z.object({
  borrower: z.object({ is_student: z.boolean().nullable().default(null), purpose: short.default('unknown') }).strict().default({ is_student: null, purpose: 'unknown' }),
  lender: z.object({
    name: short.nullable().default(null), type: z.enum(['bank', 'consumer_finance', 'microloan', 'platform', 'other', 'unknown']).default('unknown'),
    licensed: z.boolean().nullable().default(null), internet_consumer_loan: z.boolean().nullable().default(null),
    internet_assisted: z.boolean().nullable().default(null),
  }).strict().default({ name: null, type: 'unknown', licensed: null, internet_consumer_loan: null, internet_assisted: null }),
  loan: z.object({
    principal: nullableMoney, disbursed: nullableMoney,
    term_periods: z.number().int().min(1).max(600).nullable().default(null),
    periods_per_year: z.number().int().min(1).max(366).default(12),
    repay_method: z.enum(['equal_installment', 'equal_principal', 'interest_only', 'bullet', 'schedule', 'unknown']).default('unknown'),
    period_payment: nullableMoney, nominal_apr: nullableMoney,
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  }).strict().default({ principal: null, disbursed: null, term_periods: null, periods_per_year: 12, repay_method: 'unknown', period_payment: null, nominal_apr: null, start_date: null }),
  repayments: z.array(z.object({ amount: decimal, period: z.number().int().min(1).max(12000).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).strict()).max(600).default([]),
  fees: z.array(z.object({
    id: z.string().min(1).max(80), name: short, amount: nullableMoney,
    timing: z.enum(['upfront', 'per_period', 'at_maturity', 'specific_period', 'unknown']).default('unknown'),
    period: z.number().int().min(0).max(600).nullable().default(null),
    payee: short.nullable().default(null), payee_type: z.enum(['lender', 'platform', 'guarantor', 'other', 'unknown']).default('unknown'),
    in_disclosure: z.boolean().nullable().default(null), included_in_cashflows: z.boolean().nullable().default(null),
    included_in_disclosed_cost: z.boolean().nullable().default(null),
    contingent: z.boolean().nullable().default(null),
  }).strict()).max(50).default([]),
  disclosure: z.object({
    present: z.boolean().nullable().default(null), quoted_apr: nullableMoney,
    quoted_method: z.enum(['nominal', 'effective', 'simple', 'xirr', 'unknown']).default('unknown'),
    items_complete: z.boolean().nullable().default(null), contingent_disclosed: z.boolean().nullable().default(null),
  }).strict().default({ present: null, quoted_apr: null, quoted_method: 'unknown', items_complete: null, contingent_disclosed: null }),
  funds_to: z.enum(['borrower', 'training_provider', 'third_party', 'unknown']).default('unknown'),
  marketing_phrases: z.array(short).max(30).default([]),
}).strict();
export type CaseFacts = z.infer<typeof caseFactsSchema>;

export const evidenceSchema = z.object({
  id: z.string().min(1).max(100), field: z.string().min(1).max(300),
  document_id: z.string().min(1).max(100), page: z.number().int().positive().nullable(),
  quote: z.string().min(1).max(3000),
  source_type: z.enum(['text', 'vision_transcript']).optional(),
}).strict();
export type Evidence = z.infer<typeof evidenceSchema>;
export const caseExtractionSchema = z.object({
  facts: caseFactsSchema, evidence: z.array(evidenceSchema).max(2000),
  questions: z.array(z.object({ field: short, question: z.string().max(1000) }).strict()).max(100),
  conflicts: z.array(z.object({ field: short, description: z.string().max(1000), evidence_ids: z.array(short).max(20) }).strict()).max(100),
}).strict();
export type CaseExtraction = z.infer<typeof caseExtractionSchema>;
export type SourceMaterial = { id: string; role: 'disclosure' | 'contract' | 'schedule' | 'other'; pages: { page: number; text: string }[]; vision?: boolean };
export type RuleResult = ReturnType<typeof import('../shared/rule-policy.ts').gradeRule> & {
  rule_id: string; title: string; status: 'triggered' | 'not_triggered' | 'insufficient_data' | 'not_applicable';
  reason: string; action: string;
  citation: { document: string; article: string; quote: string; url: string; effective_date: string; verification: 'official_checked' | 'local_material_only' } | null;
  evidence_ids: string[];
};
export type LoanResult = {
  input: unknown; calculation: { cashflows: unknown[]; nominal_apr: string | null; effective_apr: string | null; simple_apr: string | null; xirr_apr: string | null; comparison: { method: string; method_basis?: 'explicit' | 'assumed_simple' | 'unavailable'; disclosed_method?: string; method_label?: string; quoted_apr: string | null; computed_apr: string | null; gap_pp: string | null; exceeds_tolerance: boolean | null } };
  summary: { principal: string; disbursed: string; total_repayment: string; total_additional_fees: string; total_cost: string };
  fee_totals: { id: string; name: string; total: string; contingent: boolean }[];
};
