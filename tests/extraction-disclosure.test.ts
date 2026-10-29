import assert from 'node:assert/strict';
import test from 'node:test';
import { CaseModel } from '../src/case-model.ts';
import { caseFactsSchema } from '../src/domain.ts';
import { config } from '../src/config.ts';

test('extraction does not turn unproven missing disclosure into confirmed defects', async () => {
  const model = new CaseModel({ ...config, apiKey: undefined });
  model.json = async () => ({
    facts: caseFactsSchema.parse({disclosure:{present:true,items_complete:false,contingent_disclosed:false}}),
    evidence: [
      {id:'a',field:'disclosure.items_complete',document_id:'d',page:1,quote:'收取方式：按月'},
      {id:'b',field:'disclosure.contingent_disclosed',document_id:'d',page:1,quote:'逾期罚息按日计算'},
    ], questions:[],conflicts:[],
  });
  const result=await model.extract([{id:'d',role:'disclosure',pages:[{page:1,text:'收取方式：按月。逾期罚息按日计算。'}]}],undefined,new AbortController().signal,()=>{});
  assert.equal(result.facts.disclosure.items_complete,null);
  assert.equal(result.facts.disclosure.contingent_disclosed,null);
  assert(result.questions.some(q=>q.field==='disclosure.items_complete'));
  assert(result.questions.some(q=>q.field==='disclosure.contingent_disclosed'));
});

test('explicit negative disclosure statements remain available for human confirmation', async () => {
  const model = new CaseModel({ ...config, apiKey: undefined });
  model.json = async () => ({
    facts: caseFactsSchema.parse({disclosure:{present:true,items_complete:false,contingent_disclosed:false}}),
    evidence:[
      {id:'a',field:'disclosure.items_complete',document_id:'d',page:1,quote:'明示表未列收费主体'},
      {id:'b',field:'disclosure.contingent_disclosed',document_id:'d',page:1,quote:'合同未披露违约金'},
    ],questions:[],conflicts:[],
  });
  const result=await model.extract([{id:'d',role:'disclosure',pages:[{page:1,text:'明示表未列收费主体。合同未披露违约金。'}]}],undefined,new AbortController().signal,()=>{});
  assert.equal(result.facts.disclosure.items_complete,false);
  assert.equal(result.facts.disclosure.contingent_disclosed,false);
});

test('an omitted fee is distinct from a missing required column', async () => {
  const model = new CaseModel({ ...config, apiKey: undefined });
  model.json = async () => ({facts:caseFactsSchema.parse({disclosure:{present:true,items_complete:false}}),evidence:[{id:'a',field:'disclosure.items_complete',document_id:'d',page:1,quote:'管理费未列入上述综合融资成本明示表'}],questions:[],conflicts:[]});
  const result=await model.extract([{id:'d',role:'contract',pages:[{page:1,text:'管理费未列入上述综合融资成本明示表。'}]}],undefined,new AbortController().signal,()=>{});
  assert.equal(result.facts.disclosure.items_complete,null);
});

test('assumed interest method is retained in the report even when AI omits it', async () => {
  const {generateReport}=await import('../src/report.ts');
  const {evaluateRules}=await import('../src/rules.ts');
  const facts=caseFactsSchema.parse({loan:{principal:'1000',disbursed:'1000',term_periods:1,periods_per_year:1,repay_method:'bullet',period_payment:'1100',start_date:'2026-09-01'},disclosure:{present:true,items_complete:true,quoted_apr:'0.08',quoted_method:'unknown',contingent_disclosed:true},borrower:{is_student:false},lender:{type:'bank',internet_assisted:false},marketing_phrases:['按合同还款']});
  const calculation={input:{},calculation:{cashflows:[],nominal_apr:'0.1',effective_apr:'0.1',simple_apr:'0.1',xirr_apr:null,comparison:{method:'simple',method_basis:'assumed_simple' as const,disclosed_method:'unknown',quoted_apr:'0.08',computed_apr:'0.1',gap_pp:'2',exceeds_tolerance:true}},summary:{principal:'1000',disbursed:'1000',total_repayment:'1100',total_additional_fees:'0',total_cost:'100'},fee_totals:[]};
  const model=new CaseModel({...config,apiKey:undefined});
  model.json=async()=>({summary:'费用与标注有差额。',findings:[],actions:[],limitations:['以确认的资料为准。']});
  const report=await generateReport(model,{facts,calculation,calculation_error:null,rules:evaluateRules(facts,calculation,[]),evidence:[],corrections:[]},new AbortController().signal,()=>{});
  assert.match(report.conclusion.summary,/按单利推定.*待确认/);
  assert(report.narrative.limitations.some(value=>value.includes('按单利推定')));
});

test('AI cannot label an explicitly nominal calculation as an assumed simple rate', async () => {
  const {generateReport}=await import('../src/report.ts');
  const facts=caseFactsSchema.parse({disclosure:{quoted_apr:'0.1',quoted_method:'nominal'}});
  const calculation={input:{},calculation:{cashflows:[],nominal_apr:'0.1',effective_apr:'0.105',simple_apr:null,xirr_apr:null,comparison:{method:'nominal',method_basis:'explicit' as const,disclosed_method:'nominal',quoted_apr:'0.1',computed_apr:'0.1',gap_pp:'0',exceeds_tolerance:false}},summary:{principal:'1000',disbursed:'1000',total_repayment:'1100',total_additional_fees:'0',total_cost:'100'},fee_totals:[]};
  const model=new CaseModel({...config,apiKey:undefined});
  model.json=async()=>({summary:'按单利推定口径核算。',findings:[],actions:[],limitations:['以确认的资料为准。']});
  const report=await generateReport(model,{facts,calculation,calculation_error:null,rules:[],evidence:[],corrections:[]},new AbortController().signal,()=>{});
  assert.equal(report.generation.mode,'template');assert.equal(report.generation.error_code,'REPORT_UNSUPPORTED_CLAIM');assert.doesNotMatch(report.conclusion.summary,/单利推定/);
  const partial=await generateReport(model,{facts,calculation:null,calculation_error:null,rules:[],evidence:[],corrections:[]},new AbortController().signal,()=>{});
  assert.equal(partial.generation.mode,'template');assert.doesNotMatch(partial.conclusion.summary,/单利推定/);
});
