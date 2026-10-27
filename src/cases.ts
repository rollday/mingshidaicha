import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { commandSchema } from './contracts.ts';
import { caseFactsSchema, type CaseExtraction, type CaseFacts, type LoanResult, type SourceMaterial } from './domain.ts';
import type { Config } from './config.ts';
import { AppError } from './errors.ts';
import { CaseModel } from './case-model.ts';
import { runPython } from './python.ts';
import { evaluateRules } from './rules.ts';
import { generateReport, type AuditReport, type Correction } from './report.ts';
import { LenderSearchService, type LenderSearchResult } from './lender-search.ts';

type Command = Extract<z.infer<typeof commandSchema>, { type: 'case.start' | 'case.confirm' | 'case.get' | 'case.report' | 'lender.search' }>;
type Emit = (type: string, data: unknown) => void;
type Document = { path: string; mime: string };
type CaseRecord = {
  id: string; revision: number; status: 'review' | 'completed'; original: CaseFacts; facts: CaseFacts;
  extraction: CaseExtraction; materials: SourceMaterial[];
  history: { revision: number; confirmed_at: string; changes: Correction[] }[];
  report: AuditReport | null;
  lender_search: LenderSearchResult | null;
};

export function differences(before: unknown, after: unknown, path = ''): Correction[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (before !== null && after !== null && typeof before === 'object' && typeof after === 'object' && Array.isArray(before) === Array.isArray(after)) {
    const a = before as Record<string, unknown>, b = after as Record<string, unknown>;
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap(key => differences(a[key] ?? null, b[key] ?? null, path ? Array.isArray(after) ? `${path}[${key}]` : `${path}.${key}` : key));
  }
  return [{ field: path, before: before ?? null, after: after ?? null }];
}

export class CaseWorkflow {
  settings: Config;
  model: CaseModel;
  search: LenderSearchService;
  records = new Map<string, CaseRecord>();
  constructor(settings: Config) { this.settings = settings; this.model = new CaseModel(settings); this.search = new LenderSearchService({url:settings.searchMcpURL,authorization:settings.searchAuthorization,timeout:settings.searchTimeout}); }

  get(id: string) {
    const record = this.records.get(id);
    if (!record) throw new AppError('CASE_NOT_FOUND', '当前会话中没有该案件。', 404);
    return record;
  }
  view(record: CaseRecord) {
    return { case_id: record.id, revision: record.revision, status: record.status, facts: record.facts,
      evidence: record.extraction.evidence, questions: record.extraction.questions, conflicts: record.extraction.conflicts,
      materials: record.materials, history: record.history, corrections: differences(record.original, record.facts), report: record.report, lender_search: record.lender_search };
  }
  async execute(command: Command, signal: AbortSignal, emit: Emit, document: (id: string) => Document | undefined) {
    const checkpoint = () => { if (signal.aborted) throw new AppError('TASK_CANCELLED', '任务已取消。', 499); };
    const progress = (stage: string) => {
      let last = 0;
      return (bytes: number) => { if (Date.now() - last > 250) { last = Date.now(); emit('model.progress', { stage, received_bytes: bytes }); } };
    };
    if (command.type === 'case.get') { emit('case.snapshot', this.view(this.get(command.case_id))); return; }
    if (command.type === 'case.start') {
      if (this.records.size >= 5) throw new AppError('CASE_LIMIT', '每个会话最多保留五个案件。', 429);
      if (!command.manual_facts && !command.documents.length && !command.text?.trim()) throw new AppError('EMPTY_CASE', '请上传材料、输入文字或使用手工录入。');
      if (command.manual_facts && (command.documents.length || command.text)) throw new AppError('AMBIGUOUS_INPUT', '手工录入与模型抽取应分别提交。');
      const materials: SourceMaterial[] = [];
      const seen = new Set<string>();
      for (const item of command.documents) {
        if (seen.has(item.document_id)) throw new AppError('DUPLICATE_DOCUMENT', '同一材料不能重复提交。');
        seen.add(item.document_id);
        const stored = document(item.document_id);
        if (!stored) throw new AppError('DOCUMENT_NOT_FOUND', '材料不存在或不属于当前会话。', 404);
        let pages: { page: number; text: string }[] = [];
        let visualPages: number[] = [];
        if (stored.mime === 'application/pdf') {
          emit('task.progress', { stage: 'parse_pdf', document_id: item.document_id });
          const parsed = await runPython(this.settings, 'parse_pdf', { path: stored.path, max_pages: this.settings.maxPdfPages }, signal) as { pages: { page: number; text: string }[] };
          pages = parsed.pages;
          visualPages = pages.filter(p => !p.text.trim()).map(p => p.page);
          emit('document.parsed', { document_id: item.document_id, ...parsed });
        } else visualPages = [1];
        if (visualPages.length) {
          emit('task.progress', { stage: 'read_images', document_id: item.document_id });
          const visual = await runPython(this.settings, 'prepare_visual', { path: stored.path, pages: visualPages, max_pages: 4 }, signal) as { images: { page: number; data: string }[] };
          const transcribed = await this.model.transcribe(visual.images, signal, progress('read_images'));
          const textPages = new Map(pages.map(p => [p.page, p]));
          for (const page of transcribed) textPages.set(page.page, page);
          pages = [...textPages.values()].sort((a, b) => a.page - b.page);
        }
        materials.push({ id: item.document_id, role: item.role, pages, vision: visualPages.length > 0 });
      }
      if (command.text?.trim()) materials.push({ id: 'text', role: 'other', pages: [{ page: 1, text: command.text }] });
      if (materials.reduce((n, m) => n + m.pages.reduce((a, p) => a + p.text.length, 0), 0) > 200000) throw new AppError('DOCUMENT_TOO_LONG', '合并后的材料过长，请拆分。', 413);
      checkpoint();
      emit('task.progress', { stage: command.manual_facts ? 'prepare_review' : 'extract_case' });
      const extraction: CaseExtraction = command.manual_facts ? { facts: command.manual_facts, evidence: [], questions: [], conflicts: [] }
        : await this.model.extract(materials, command.context, signal, progress('extract_case'));
      if (typeof command.context?.is_student === 'boolean') extraction.facts.borrower.is_student = command.context.is_student;
      if (command.context?.purpose && command.context.purpose !== 'unknown') extraction.facts.borrower.purpose = command.context.purpose;
      checkpoint();
      const record: CaseRecord = { id: randomUUID(), revision: 0, status: 'review', original: structuredClone(extraction.facts), facts: structuredClone(extraction.facts), extraction, materials, history: [], report: null, lender_search: null };
      this.records.set(record.id, record);
      emit('case.review', { ...this.view(record), requires_confirmation: true });
      return;
    }
    const record = this.get(command.case_id);
    if (record.revision !== command.expected_revision) throw new AppError('REVISION_CONFLICT', '案件已更新，请先读取最新版本。', 409);
    if (command.type === 'lender.search') {
      const result = await this.search.search(command.name ?? record.facts.lender.name ?? '',signal,category => emit('task.progress',{stage:'search_'+category}));
      checkpoint(); record.lender_search = result;
      if (record.report) record.report.public_source_search = result;
      emit('lender.result',{case_id:record.id,revision:record.revision,result});
      return;
    }
    if (command.type === 'case.confirm') {
      const facts = caseFactsSchema.parse(command.facts);
      const duplicateFees = new Set(facts.fees.map(f => f.id)).size !== facts.fees.length;
      if (duplicateFees) throw new AppError('DUPLICATE_FEE', '费用编号重复，请核对费用清单。');
      record.history.push({ revision: record.revision + 1, confirmed_at: new Date().toISOString(), changes: differences(record.facts, facts) });
      record.revision++;
      record.facts = structuredClone(facts);
      record.status = 'review'; record.report = null;
      record.lender_search = null;
      emit('case.confirmed', { case_id: record.id, revision: record.revision, corrections: differences(record.original, record.facts) });
    } else if (!record.history.length) throw new AppError('CONFIRMATION_REQUIRED', '请先核对并确认事实，再生成报告。', 409);
    checkpoint();
    emit('task.progress', { stage: 'calculate' });
    let calculation: LoanResult | null = null, calculationError: { code: string; message: string } | null = null;
    try { calculation = await runPython(this.settings, 'calculate_loan', record.facts, signal) as LoanResult; }
    catch (error) {
      if (signal.aborted) throw error;
      if (!(error instanceof AppError) || error.status !== 422) throw error;
      calculationError = { code: error.code, message: error.message };
      const missing = (error.details as { fields?: string[] } | undefined)?.fields ?? [];
      for (const field of missing) if (!record.extraction.questions.some(q => q.field === field)) record.extraction.questions.push({ field, question: '请补充或确认该字段后重新计算。' });
      emit('case.calculation_unavailable', { case_id: record.id, ...calculationError, missing_fields: missing });
    }
    checkpoint();
    emit('task.progress', { stage: 'check_rules' });
    const rules = evaluateRules(record.facts, calculation, record.extraction.evidence);
    emit('case.checked', { case_id: record.id, revision: record.revision, calculation, rules });
    emit('task.progress', { stage: 'write_report' });
    const report = await generateReport(this.model, {
      facts: record.facts, calculation, calculation_error: calculationError,
      rules, evidence: record.extraction.evidence, corrections: differences(record.original, record.facts),
    }, signal, progress('write_report'));
    checkpoint();
    record.report = report; record.status = 'completed';
    report.public_source_search = record.lender_search;
    if (report.generation.mode === 'template') emit('report.warning', { case_id: record.id, code: report.generation.error_code, message: 'AI 报告暂不可用，已保留计算、规则和模板报告。' });
    emit('report.result', { case_id: record.id, revision: record.revision, report });
  }
}
