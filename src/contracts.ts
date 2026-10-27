import { z } from 'zod';
import { decimal } from './numeric.ts';
import { caseFactsSchema } from './domain.ts';
export { decimal } from './numeric.ts';

// Money/rates cross the JS/Python boundary as decimal strings, never binary floats.
const payment = z.object({
  amount: decimal,
  period: z.number().int().min(0).max(12000).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();
export const calculationSchema = z.object({
  timing: z.enum(['periodic', 'dated']),
  periods_per_year: z.number().int().min(1).max(366).default(12),
  disbursements: z.array(payment).min(1).max(100),
  repayments: z.array(payment).min(1).max(10000),
  fees: z.array(payment.extend({ name: z.string().min(1).max(200), included_in_cashflows: z.boolean() })).max(1000).default([]),
  quoted_apr: decimal.optional(),
  quoted_method: z.enum(['nominal', 'effective', 'simple', 'xirr', 'unknown']).default('unknown'),
  comparison_tolerance_pp: decimal.default('0.5'),
}).strict();
export type CalculationInput = z.infer<typeof calculationSchema>;

export const extractionSchema = z.object({
  calculation: calculationSchema.nullable(),
  evidence: z.array(z.object({
    field: z.string().max(300), quote: z.string().min(1).max(3000),
    page: z.number().int().positive().nullable(),
  }).strict()).max(2000),
  missing_fields: z.array(z.string().max(300)).max(100),
  notes: z.array(z.string().max(1000)).max(100),
}).strict();
export type Extraction = z.infer<typeof extractionSchema>;

const requestId = z.string().min(1).max(100);
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session.authenticate'), request_id: requestId, token: z.string().max(200) }).strict(),
  z.object({ type: z.literal('ping'), request_id: requestId }).strict(),
  z.object({ type: z.literal('audit.calculate'), request_id: requestId, input: calculationSchema }).strict(),
  z.object({ type: z.literal('audit.extract'), request_id: requestId, text: z.string().min(1).max(200000) }).strict(),
  z.object({ type: z.literal('audit.document'), request_id: requestId, document_id: z.string().uuid() }).strict(),
  z.object({ type: z.literal('task.cancel'), request_id: requestId }).strict(),
  z.object({ type: z.literal('case.start'), request_id: requestId,
    documents: z.array(z.object({ document_id: z.string().uuid(), role: z.enum(['disclosure', 'contract', 'schedule', 'other']) }).strict()).max(5).default([]),
    text: z.string().max(200000).optional(),
    context: z.object({ is_student: z.boolean().nullable().optional(), purpose: z.string().max(300).optional() }).strict().optional(),
    manual_facts: caseFactsSchema.optional(),
  }).strict(),
  z.object({ type: z.literal('case.confirm'), request_id: requestId, case_id: z.string().uuid(), expected_revision: z.number().int().nonnegative(), facts: caseFactsSchema }).strict(),
  z.object({ type: z.literal('case.get'), request_id: requestId, case_id: z.string().uuid() }).strict(),
  z.object({ type: z.literal('case.report'), request_id: requestId, case_id: z.string().uuid(), expected_revision: z.number().int().nonnegative() }).strict(),
]);
