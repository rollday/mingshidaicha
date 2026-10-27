import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { commandSchema } from './contracts.ts';
import { caseFactsSchema, type CaseExtraction, type CaseFacts, type LoanResult, type RuleResult, type SourceMaterial } from './domain.ts';
import type { Config } from './config.ts';
import { AppError } from './errors.ts';
import { CaseModel } from './case-model.ts';
import { runPython } from './python.ts';
import { evaluateRules } from './rules.ts';
import { displayDecimal, generateReport, type AuditReport, type Correction } from './report.ts';
import { LenderSearchService, type LenderSearchResult } from './lender-search.ts';
import {OfficialInfoService} from './official-info.ts';
import type {Activity} from '../shared/progress.ts';

type Command = Extract<z.infer<typeof commandSchema>, { type: 'case.start' | 'case.confirm' | 'case.get' | 'case.report' | 'lender.search' | 'lender.detail' }>;
type Emit = (type: string, data: unknown) => void;
type Document = { path: string; mime: string };
type CaseRecord = {
  id: string; revision: number; status: 'review' | 'completed'; original: CaseFacts; facts: CaseFacts;
  extraction: CaseExtraction; materials: SourceMaterial[];
  history: { revision: number; confirmed_at: string; changes: Correction[] }[];
  report: AuditReport | null;
  lender_search: LenderSearchResult | null;
  activities:Activity[];
  checked:{case_id:string;revision:number;calculation:LoanResult|null;rules:RuleResult[]}|null;
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
  official: OfficialInfoService;
  records = new Map<string, CaseRecord>();
  constructor(settings: Config) { this.settings = settings; this.model = new CaseModel(settings); this.search = new LenderSearchService({url:settings.searchMcpURL,authorization:settings.searchAuthorization,timeout:settings.searchTimeout}); this.official=new OfficialInfoService(settings); }

  get(id: string) {
    const record = this.records.get(id);
    if (!record) throw new AppError('CASE_NOT_FOUND', '当前会话中没有该案件。', 404);
    return record;
  }
  view(record: CaseRecord) {
    return { case_id: record.id, revision: record.revision, status: record.status, facts: record.facts,
      evidence: record.extraction.evidence, questions: record.extraction.questions, conflicts: record.extraction.conflicts,
      materials: record.materials, history: record.history, corrections: differences(record.original, record.facts), report: record.report, lender_search: record.lender_search,activities:record.activities,checked:record.checked };
  }
  async execute(command: Command, signal: AbortSignal, emit: Emit, document: (id: string) => Document | undefined) {
    const send=emit;
    let activeRecord=command.type==='case.start'?undefined:this.get(command.case_id);
    const pending:Activity[]=[];
    const log=(stage:string,status:Activity['status'],message:string,extra:Partial<Pick<Activity,'document_id'|'page'|'total_pages'|'evidence_ids'|'rule_ids'|'url'>>={},kind:Activity['kind']='process')=>{
      const entry:Activity={id:randomUUID(),timestamp:new Date().toISOString(),revision:activeRecord?.revision??null,stage,status,message:message.slice(0,800),kind,...extra};
      const entries=activeRecord?.activities??pending;entries.push(entry);if(entries.length>180)entries.splice(0,entries.length-180);
      if(activeRecord?.report)activeRecord.report.processing_activity=[...entries];
      send('task.activity',entry);
    };
    const labels:Record<string,string>={parse_pdf:'正在读取 PDF 原文',read_images:'正在转录图片文字',extract_case:'正在抽取字段并核对原文依据',prepare_review:'正在准备核对信息',calculate:'正在按确认数据生成现金流并核算',check_rules:'正在对照检查规则',write_report:'正在撰写报告',read_official_source:'正在读取官方接口正文',search_license:'正在检索许可与持牌来源',search_registry:'正在检索企业登记来源',search_penalty:'正在检索监管处罚来源'};
    emit=(type,data)=>{send(type,data);if(type==='task.progress'){const value=data as {stage:string;document_id?:string};log(value.stage,'started',labels[value.stage]??'正在处理',{...(value.document_id?{document_id:value.document_id}:{})});}};
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
      for (const [documentIndex,item] of command.documents.entries()) {
        if (seen.has(item.document_id)) throw new AppError('DUPLICATE_DOCUMENT', '同一材料不能重复提交。');
        seen.add(item.document_id);
        const stored = document(item.document_id);
        if (!stored) throw new AppError('DOCUMENT_NOT_FOUND', '材料不存在或不属于当前会话。', 404);
        let pages: { page: number; text: string }[] = [];
        let visualPages: number[] = [];
        if (stored.mime === 'application/pdf') {
          emit('task.progress', { stage: 'parse_pdf', document_id: item.document_id });
          const parsed = await runPython(this.settings, 'parse_pdf', { path: stored.path, max_pages: this.settings.maxPdfPages }, signal,p=>log('parse_pdf','completed',`第 ${documentIndex+1}/${command.documents.length} 份材料：已读取第 ${p.page}/${p.total_pages} 页`,{document_id:item.document_id,page:p.page,total_pages:p.total_pages})) as { pages: { page: number; text: string }[] };
          pages = parsed.pages;
          visualPages = pages.filter(p => !p.text.trim()).map(p => p.page);
          emit('document.parsed', { document_id: item.document_id, ...parsed });
          log('parse_pdf','completed',`PDF 原文读取完成，共 ${pages.length} 页`,{document_id:item.document_id});
        } else visualPages = [1];
        if (visualPages.length) {
          emit('task.progress', { stage: 'read_images', document_id: item.document_id });
          const visual = await runPython(this.settings, 'prepare_visual', { path: stored.path, pages: visualPages, max_pages: 4 }, signal) as { images: { page: number; data: string }[] };
          const transcribed = await this.model.transcribe(visual.images, signal, progress('read_images'));
          log('read_images','completed',`已转录 ${transcribed.length} 页图片文字，金额仍需对照原图核对`,{document_id:item.document_id});
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
      const record: CaseRecord = { id: randomUUID(), revision: 0, status: 'review', original: structuredClone(extraction.facts), facts: structuredClone(extraction.facts), extraction, materials, history: [], report: null, lender_search: null,activities:pending,checked:null };
      activeRecord=record;
      log('review','completed',`已整理 ${extraction.evidence.length} 段原文依据、${extraction.questions.length} 项待确认信息，请先核对再计算`,{evidence_ids:extraction.evidence.slice(0,3).map(e=>e.id)},'analysis');
      this.records.set(record.id, record);
      emit('case.review', { ...this.view(record), requires_confirmation: true });
      return;
    }
    const record = this.get(command.case_id);
    if (record.revision !== command.expected_revision) throw new AppError('REVISION_CONFLICT', '案件已更新，请先读取最新版本。', 409);
    if(command.type==='lender.detail'){
      const lookup=record.lender_search;
      if(!lookup)throw new AppError('SEARCH_REQUIRED','请先检索机构的公开来源。',409);
      if(!lookup.categories.some(category=>category.sources.some(source=>source.url===command.url)))throw new AppError('SOURCE_NOT_FOUND','该链接不属于本次检索结果。',404);
      if(!lookup.official_documents?.[command.url] && Object.keys(lookup.official_documents??{}).length>=8)throw new AppError('DETAIL_LIMIT','每次检索最多保留八份官方详情。',429);
      emit('task.progress',{stage:'read_official_source'});
      const detail=await this.official.read(command.url,lookup.name,signal);
      checkpoint();
      lookup.official_documents={...lookup.official_documents,[command.url]:detail};
      log('read_official_source',detail.status==='retrieved'?'completed':'warning',detail.status==='retrieved'?`已读取官方正文；${detail.name_match==='subject_row'?'当事人栏匹配检索名称':detail.name_match==='text_only'?'正文提及该名称，未匹配独立当事人记录':'未匹配到完整机构名称'}`:'本次未能读取官方详情，不表示没有记录',{url:command.url},'analysis');
      if(record.report)record.report.public_source_search=lookup;
      emit('lender.result',{case_id:record.id,revision:record.revision,result:lookup});return;
    }
    if (command.type === 'lender.search') {
      const result = await this.search.search(command.name ?? record.facts.lender.name ?? '',signal,category => emit('task.progress',{stage:'search_'+category}),category=>{
        checkpoint();emit('lender.category',{category});
        log('search_'+category.kind,category.status==='unavailable'?'warning':'completed',`${{license:'许可与持牌',registry:'企业登记',penalty:'监管处罚'}[category.kind]}检索${category.status==='unavailable'?'未完成':`完成，返回 ${category.sources.length} 个公开页面`}`);
      });
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
      record.checked=null;
      emit('case.confirmed', { case_id: record.id, revision: record.revision, corrections: differences(record.original, record.facts) });
    } else if (!record.history.length) throw new AppError('CONFIRMATION_REQUIRED', '请先核对并确认事实，再生成报告。', 409);
    checkpoint();
    log('calculate','started','将按确认的到账、还款和费用核算；已含费用与独立支付费用分开处理',{},'analysis');
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
    log('calculate',calculation?'completed':'warning',calculation?`核算完成：独立支付费用合计 ${displayDecimal(calculation.summary.total_additional_fees)} 元，总成本 ${displayDecimal(calculation.summary.total_cost)} 元`:'现有材料不足以完成核算，后续只展示已知事实与待补充项',{},'analysis');
    emit('task.progress', { stage: 'check_rules' });
    const rules = evaluateRules(record.facts, calculation, record.extraction.evidence);
    record.checked={case_id:record.id,revision:record.revision,calculation,rules};
    emit('case.checked',record.checked);
    for(const rule of rules)log('check_rules','completed',`${rule.title}：${rule.reason}`,{rule_ids:[rule.rule_id],evidence_ids:rule.evidence_ids.slice(0,5)},'analysis');
    emit('task.progress', { stage: 'write_report' });
    const report = await generateReport(this.model, {
      facts: record.facts, calculation, calculation_error: calculationError,
      rules, evidence: record.extraction.evidence, corrections: differences(record.original, record.facts),
    }, signal, progress('write_report'),draft=>{
      emit('report.draft',draft);
      if(draft.status==='validating')log('validate_report','started',`第 ${draft.attempt} 次草稿已接收，正在校验金额占位符与规则引用`);
      if(draft.status==='retrying')log('write_report','warning','上一份草稿未通过校验，已撤回并重新撰写');
      if(draft.status==='discarded')log('write_report','warning',signal.aborted?'已取消报告草稿；已核算结果保留':'草稿不可用，改用确定性模板保留结果');
    });
    checkpoint();
    record.report = report; record.status = 'completed';
    report.public_source_search = record.lender_search;
    log('write_report','completed',report.generation.mode==='ai'?'报告已完成金额占位符与规则引用校验':'已生成确定性模板报告');
    report.processing_activity=[...record.activities];
    if (report.generation.mode === 'template') emit('report.warning', { case_id: record.id, code: report.generation.error_code, message: 'AI 报告暂不可用，已保留计算、规则和模板报告。' });
    emit('report.result', { case_id: record.id, revision: record.revision, report });
  }
}
