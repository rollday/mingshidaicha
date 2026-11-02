import assert from 'node:assert/strict';
import test from 'node:test';
import { CaseModel } from '../src/case-model.ts';
import { config } from '../src/config.ts';
import { caseFactsSchema } from '../src/domain.ts';
import { generateReport } from '../src/report.ts';
import { gradeRule } from '../shared/rule-policy.ts';

function mockModel(responses: string[]) {
  const model = new CaseModel({ ...config, apiKey: undefined });
  let calls = 0;
  const systems: string[] = [];
  model.client = { chat: { completions: { create: async (request: any) => {
    systems.push(String(request.messages?.[0]?.content ?? ''));
    const content = responses[calls++];
    if (content === undefined) throw new Error('unexpected extra model call');
    return {controller:{abort(){}},async *[Symbol.asyncIterator](){yield {choices:[{finish_reason:'stop',delta:{content}}]};}};
  } } } } as unknown as NonNullable<CaseModel['client']>;
  return {model,calls:()=>calls,systems};
}
const input=()=>({facts:caseFactsSchema.parse({}),calculation:null,calculation_error:null,rules:[],evidence:[],corrections:[]});
const calculatedInput=()=>({
  facts:caseFactsSchema.parse({loan:{principal:'1000',disbursed:'1000',term_periods:12,period_payment:'100',start_date:'2026-09-01'},disclosure:{present:true,quoted_apr:'0.12',quoted_method:'nominal',items_complete:true,contingent_disclosed:true}}),
  calculation:{input:{},calculation:{cashflows:[],nominal_apr:'0.12',effective_apr:'0.12',simple_apr:'0.12',xirr_apr:null,comparison:{method:'nominal',method_basis:'explicit' as const,disclosed_method:'nominal',quoted_apr:'0.12',computed_apr:'0.12',gap_pp:'0',exceeds_tolerance:false}},summary:{principal:'1000',disbursed:'1000',total_repayment:'1200',total_additional_fees:'0',total_payment:'1200',total_cost:'200'},fee_totals:[]},
  calculation_error:null,rules:[],evidence:[],corrections:[],
});

test('JSON retry retracts the invalid stream before emitting the replacement',async()=>{
  const fixture=mockModel(['{"summary":"第一版草稿"','{"summary":"第二版报告","findings":[],"actions":[],"limitations":["资料有限"]}']);
  const drafts:any[]=[];
  const report=await generateReport(fixture.model,input(),new AbortController().signal,()=>{},draft=>drafts.push(structuredClone(draft)));
  assert.equal(fixture.calls(),2);assert.equal(report.generation.mode,'ai');assert.equal(report.generation.attempts,2);
  assert.equal(report.conclusion.summary,'第二版报告');
  const retry=drafts.findIndex(d=>d.status==='retrying');assert(retry>=0);assert.deepEqual(drafts[retry].sections,[]);
  assert(!JSON.stringify(drafts.slice(retry)).includes('第一版草稿'));
});

test('report validation repair and invalid JSON share one retry budget',async()=>{
  const fixture=mockModel(['{"summary":"包含非法数字99","findings":[],"actions":[],"limitations":["资料有限"]}','not json']);
  const report=await generateReport(fixture.model,input(),new AbortController().signal,()=>{});
  assert.equal(fixture.calls(),2);assert.equal(report.generation.mode,'template');assert.equal(report.generation.attempts,2);
  assert.equal(report.generation.error_code,'MODEL_INVALID_JSON');
});

test('narratives may repeat an approved token value but receive a precise retry for an invented number',async()=>{
  const fixture=mockModel([
    '{"summary":"明示年化12.00%，但还有99.00%的未知费用。","findings":[],"actions":[],"limitations":["资料有限"]}',
    '{"summary":"明示年化12.00%，与按材料重算结果一致。","findings":[],"actions":[],"limitations":["资料有限"]}',
  ]);
  const report=await generateReport(fixture.model,calculatedInput(),new AbortController().signal,()=>{});
  assert.equal(fixture.calls(),2);
  assert.equal(report.generation.mode,'ai');
  assert.equal(report.conclusion.summary,'明示年化12.00%，与按材料重算结果一致。');
  assert.match(fixture.systems[1]!,/未经许可的数字 99\.00/);
  assert.doesNotMatch(fixture.systems[1]!,/错误为REPORT_UNSUPPORTED_CLAIM/);
});

test('template fallback summary uses the concrete triggered-rule reason',async()=>{
  const model=new CaseModel({...config,apiKey:undefined});
  model.json=async()=>({summary:'包含非法数字99',findings:[],actions:[],limitations:['资料有限']});
  const rule={rule_id:'R03',title:'正常履约费用披露',status:'triggered' as const,reason:'已确认 1 项正常履约费用未列入明示表，且未计入披露成本。',action:'核对合同费用与明示表。',citation:null,evidence_ids:[],...gradeRule('disclosure','triggered')};
  const report=await generateReport(model,{...input(),rules:[rule]},new AbortController().signal,()=>{});
  assert.equal(report.generation.mode,'template');
  assert.match(report.conclusion.summary,/本次核查确认 1 项需要关注/);
  assert.match(report.conclusion.summary,/正常履约费用未列入明示表/);
  assert.doesNotMatch(report.conclusion.summary,/已完成现金流计算/);
});

test('summary drops a vague evidence-reference sentence instead of showing it at the top',async()=>{
  const fixture=mockModel(['{"summary":"本次核查确认费用披露存在差异。表外收费与总成本差异分别依据上述已确认事实。","findings":[],"actions":[],"limitations":["资料有限"]}']);
  const report=await generateReport(fixture.model,calculatedInput(),new AbortController().signal,()=>{});
  assert.equal(report.generation.mode,'ai');
  assert.equal(report.narrative.summary,'本次核查确认费用披露存在差异。');
  assert.doesNotMatch(report.narrative.summary,/上述已确认事实/);
});
