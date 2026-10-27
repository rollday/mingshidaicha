/** Wire types derive from the backend; this module has no runtime imports. */
import type { input } from 'zod';
import type { commandSchema } from '../src/contracts.ts';
import type { CaseWorkflow } from '../src/cases.ts';
import type { samples } from '../src/samples.ts';
import type {Activity,ReportDraft} from './progress.ts';
export type {Activity,ReportDraft,DraftSection} from './progress.ts';
export type { CaseFacts, Evidence, LoanResult, RuleResult, SourceMaterial } from '../src/domain.ts';
export type { AuditReport, Correction } from '../src/report.ts';
export type { LenderSearchResult, LenderSearchCategory, LenderSearchSource } from '../src/lender-search.ts';
export type {OfficialDocument} from '../src/official-info.ts';
export type ClientCommand = input<typeof commandSchema>;
export type CaseSnapshot = ReturnType<CaseWorkflow['view']>;
export type CaseReview = CaseSnapshot & { requires_confirmation: true };
export type Sample = (typeof samples)[number];
export type Session = { session_id: string; session_token: string; websocket_path: string; expires_in_seconds: number };
export type ApiError = { code: string; message: string; details?: unknown };
export type DocumentParsed = {
  document_id: string; page_count: number; needs_vision: boolean;
  pages: { page: number; width: number; height: number; rotation?: number; text: string; blocks: LayoutText[]; words?: LayoutText[] }[];
};
export type LayoutText = { bbox: [number, number, number, number]; display_bbox?: [number, number, number, number]; text: string };
type Envelope<T extends string, D> = { version: 1; type: T; request_id: string | null; timestamp: string; data: D };
export type ServerEvent =
  | Envelope<'session.ready', { session_id: string }>
  | Envelope<'pong' | 'task.cancel.accepted', Record<string, never>>
  | Envelope<'task.started', { operation: string }>
  | Envelope<'task.progress', { stage: string; document_id?: string }>
  | Envelope<'model.progress', { received_bytes: number; stage?: string }>
  | Envelope<'task.activity',Activity>
  | Envelope<'report.draft',ReportDraft>
  | Envelope<'lender.category',{category:import('../src/lender-search.ts').LenderSearchCategory}>
  | Envelope<'document.parsed', DocumentParsed>
  | Envelope<'case.review', CaseReview>
  | Envelope<'case.snapshot', CaseSnapshot>
  | Envelope<'case.confirmed', Pick<CaseSnapshot, 'case_id' | 'revision' | 'corrections'>>
  | Envelope<'case.checked', { case_id: string; revision: number; calculation: import('../src/domain.ts').LoanResult | null; rules: import('../src/domain.ts').RuleResult[] }>
  | Envelope<'case.calculation_unavailable', ApiError & { case_id: string; missing_fields: string[] }>
  | Envelope<'report.warning', ApiError & { case_id: string }>
  | Envelope<'report.result', { case_id: string; revision: number; report: import('../src/report.ts').AuditReport }>
  | Envelope<'lender.result', {case_id:string;revision:number;result:import('../src/lender-search.ts').LenderSearchResult}>
  | Envelope<'task.completed', { elapsed_ms: number }>
  | Envelope<'task.error' | 'request.error', ApiError>;
