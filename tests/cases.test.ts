import assert from 'node:assert/strict';
import test from 'node:test';
import { config } from '../src/config.ts';
import { commandSchema } from '../src/contracts.ts';
import { caseFactsSchema } from '../src/domain.ts';
import { CaseWorkflow } from '../src/cases.ts';
import { displayDecimal, generateReport, type ReportInput } from '../src/report.ts';
import { CaseModel, locateQuote } from '../src/case-model.ts';
import {LenderSearchService} from '../src/lender-search.ts';

function facts() {
  return caseFactsSchema.parse({ borrower: { is_student: false, purpose: '普通消费' }, lender: { type: 'bank', internet_assisted: false },
    loan: { principal: '10000', disbursed: '10000', term_periods: 12, period_payment: '888.49', repay_method: 'equal_installment', start_date: '2026-09-01' },
    disclosure: { present: true, quoted_apr: '0.12', quoted_method: 'nominal', items_complete: true, contingent_disclosed: true },
    fees: [{ id: 'service', name: '服务费', amount: '50', timing: 'per_period', payee_type: 'platform', in_disclosure: false, included_in_cashflows: false, included_in_disclosed_cost: false, contingent: false }],
    funds_to: 'borrower', marketing_phrases: ['按合同约定还款'],
  });
}
function modelWriting(_system: string, content: any) {
  const input: ReportInput = JSON.parse(content);
  return { summary: '已按确认事实核算，额外费用合计{{summary.total_additional_fees}}，请核对明示项目。',
    findings: input.rules.filter(r => r.status === 'triggered').map(r => ({ rule_id: r.rule_id, explanation: '现有确认事实显示该项需要关注，请结合原文进一步核实。' })),
    actions: [{ rule_id: 'R03', text: '向贷款人索取完整收费清单并确认费用披露情况。' }],
    limitations: ['依据现有材料及用户确认信息，主体资质没有经过本系统联网核验。'],
  };
}

test('confirmation completes calculation, checks, AI report and revision history', async () => {
  const workflow = new CaseWorkflow({ ...config, apiKey: undefined });
  workflow.model.json = async (system, content) => modelWriting(system, content);
  const events: { type: string; data: any }[] = [];
  const emit = (type: string, data: unknown) => events.push({ type, data });
  await workflow.execute(commandSchema.parse({ type: 'case.start', request_id: 'a', manual_facts: facts() }) as any, new AbortController().signal, emit, () => undefined);
  const review = events.find(e => e.type === 'case.review')!.data;
  const changed = structuredClone(review.facts); changed.fees[0].amount = '55';
  await workflow.execute(commandSchema.parse({ type: 'case.confirm', request_id: 'b', case_id: review.case_id, expected_revision: 0, facts: changed }) as any, new AbortController().signal, emit, () => undefined);
  const report = events.find(e => e.type === 'report.result')!.data.report;
  assert.equal(report.generation.mode, 'ai');
  assert.match(report.narrative.summary, /660.00元/);
  assert.equal(report.calculation.summary.total_additional_fees, '660');
  assert.equal(report.rules.find((r: any) => r.rule_id === 'R02').status, 'triggered');
  assert.equal(report.rules.find((r: any) => r.rule_id === 'R03').status, 'triggered');
  assert.deepEqual(report.corrections, [{ field: 'fees[0].amount', before: '50', after: '55' }]);
  const snapshot = workflow.view(workflow.get(review.case_id));
  assert.equal(snapshot.revision, 1); assert.equal(snapshot.history.length, 1); assert.equal(snapshot.status, 'completed');
  await assert.rejects(workflow.execute({ type: 'case.confirm', request_id: 'stale', case_id: review.case_id, expected_revision: 0, facts: changed }, new AbortController().signal, emit, () => undefined), { code: 'REVISION_CONFLICT' });
  assert.equal(snapshot.revision, workflow.get(review.case_id).revision);
});

test('report requires confirmation and cases are scoped to their session workflow', async () => {
  const workflow = new CaseWorkflow({ ...config, apiKey: undefined });
  let id = '';
  await workflow.execute({ type: 'case.start', request_id: 'a', documents: [], manual_facts: facts() }, new AbortController().signal, (_type, data: any) => { id = data.case_id; }, () => undefined);
  await assert.rejects(workflow.execute({ type: 'case.report', request_id: 'b', case_id: id, expected_revision: 0 }, new AbortController().signal, () => {}, () => undefined), { code: 'CONFIRMATION_REQUIRED' });
  assert.throws(() => new CaseWorkflow({ ...config, apiKey: undefined }).get(id), { code: 'CASE_NOT_FOUND' });
});

test('public source search stays versioned and never mutates licensing facts or risk rules',async()=>{
  const workflow=new CaseWorkflow({...config,apiKey:undefined});
  workflow.search=new LenderSearchService({url:'https://search.example/mcp',timeout:1000},async()=>({content:[{type:'text',text:'[1] Title: 示例银行公告\nURL: https://www.nfra.gov.cn/example\n[Text]: 示例银行相关公开信息'}]}));
  let id='';const emit=(type:string,data:any)=>{if(type==='case.review')id=data.case_id;};
  const original=facts();original.lender.name='示例银行';
  const signal=new AbortController().signal;
  await workflow.execute({type:'case.start',request_id:'a',documents:[],manual_facts:original},signal,emit,()=>undefined);
  await workflow.execute({type:'case.confirm',request_id:'b',case_id:id,expected_revision:0,facts:original},signal,emit,()=>undefined);
  const record=workflow.get(id),before=structuredClone(record.report!.rules);
  await workflow.execute({type:'lender.search',request_id:'c',case_id:id,expected_revision:1},signal,emit,()=>undefined);
  assert.equal(record.facts.lender.licensed,null);assert.deepEqual(record.report!.rules,before);assert.equal(record.revision,1);
  assert.equal(record.report!.public_source_search?.name,'示例银行');
  assert.equal(record.lender_search?.license_determination,'not_performed');
  await assert.rejects(workflow.execute({type:'lender.search',request_id:'d',case_id:id,expected_revision:0},signal,emit,()=>undefined),{code:'REVISION_CONFLICT'});
  await workflow.execute({type:'case.confirm',request_id:'e',case_id:id,expected_revision:1,facts:original},signal,emit,()=>undefined);
  assert.equal(record.lender_search,null);assert.equal(record.report!.public_source_search,null);
});

test('missing calculation data yields a clearly partial template report during model outage', async () => {
  const workflow = new CaseWorkflow({ ...config, apiKey: undefined });
  const partial = facts(); partial.loan.disbursed = null;
  let review: any, report: any;
  const emit = (type: string, data: any) => { if (type === 'case.review') review = data; if (type === 'report.result') report = data.report; };
  await workflow.execute({ type: 'case.start', request_id: 'a', documents: [], manual_facts: partial }, new AbortController().signal, emit, () => undefined);
  await workflow.execute({ type: 'case.confirm', request_id: 'b', case_id: review.case_id, expected_revision: 0, facts: partial }, new AbortController().signal, emit, () => undefined);
  assert.equal(report.conclusion.partial, true); assert.equal(report.calculation, null);
  assert.equal(report.generation.mode, 'template'); assert.equal(report.calculation_error.code, 'MISSING_FIELDS');
  assert.equal(report.rules.find((r: any) => r.rule_id === 'R02').status, 'insufficient_data');
});

test('AI writing containing invented numbers or unrelated rules is rejected without losing facts', async () => {
  const model = new CaseModel({ ...config, apiKey: undefined });
  model.json = async () => ({ summary: '实际年化99%。', findings: [], actions: [], limitations: ['仅供参考。'] });
  const input: ReportInput = { facts: facts(), calculation: null, calculation_error: null, rules: [], evidence: [], corrections: [] };
  let report = await generateReport(model, input, new AbortController().signal, () => {});
  assert.equal(report.generation.mode, 'template'); assert.equal(report.generation.error_code, 'REPORT_UNSUPPORTED_CLAIM');
  model.json = async () => ({ summary: '需要核实。', findings: [{ rule_id: 'R99', explanation: '需核实。' }], actions: [], limitations: ['仅供参考。'] });
  report = await generateReport(model, input, new AbortController().signal, () => {});
  assert.equal(report.generation.error_code, 'REPORT_INVALID_REFERENCE'); assert.deepEqual(report.facts, input.facts);
});

test('display formatting preserves large decimals and performs only string/BigInt rounding', () => {
  assert.equal(displayDecimal('123456789012345678901234.995'), '123456789012345678901235.00');
  assert.equal(displayDecimal('0.126', 2, 2), '12.60');
  assert.equal(displayDecimal('-0.005', 2, 2), '-0.50');
});

test('rendering does not duplicate units adjacent to trusted numeric placeholders', async () => {
  const model = new CaseModel({ ...config, apiKey: undefined });
  model.json = async () => ({ summary: '本金{{loan.principal}}元，共{{loan.term_periods}}期。', findings: [], actions: [], limitations: ['仅根据提供材料。'] });
  const report = await generateReport(model, { facts: facts(), calculation: null, calculation_error: null, rules: [], evidence: [], corrections: [] }, new AbortController().signal, () => {});
  assert.equal(report.generation.mode, 'ai');
  assert.equal(report.narrative.summary, '本金10000.00元，共12期。');
});

test('layout-only quote matching restores source text and never changes a number', () => {
  assert.equal(locateQuote('实际到账 10000\n元。', '实际到账10000元。'), '实际到账 10000\n元。');
  assert.equal(locateQuote('实际到账 10000\n元。', '实际到账10001元。'), null);
  assert.equal(locateQuote('实际到账10000元。', '实际到账10000元，另收费。'), null);
});

test('report makes at most one repair attempt and can reference confirmed correction values', async () => {
  const model = new CaseModel({ ...config, apiKey: undefined });
  let calls = 0;
  model.json = async () => ++calls === 1
    ? { summary: '服务费从50元改为55元。', findings: [], actions: [], limitations: ['依据确认事实。'] }
    : { summary: '服务费从{{corrections.0.before}}调整为{{corrections.0.after}}。', findings: [], actions: [], limitations: ['依据确认事实。'] };
  const report = await generateReport(model, { facts: facts(), calculation: null, calculation_error: null, rules: [], evidence: [], corrections: [{ field: 'fees[0].amount', before: '50', after: '55' }] }, new AbortController().signal, () => {});
  assert.equal(calls, 2); assert.equal(report.generation.mode, 'ai'); assert.equal(report.generation.attempts, 2);
  assert.equal(report.narrative.summary, '服务费从50.00元调整为55.00元。');
});
