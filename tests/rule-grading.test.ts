import test from 'node:test';
import assert from 'node:assert/strict';
import {caseFactsSchema,type CaseFacts,type LoanResult} from '../src/domain.ts';
import {evaluateRules} from '../src/rules.ts';
import {gradeRule,summarizeRules,RULE_GRADING_POLICY,type RuleNature,type RuleStatus} from '../shared/rule-policy.ts';
import {CaseModel} from '../src/case-model.ts';
import {config} from '../src/config.ts';
import {generateReport} from '../src/report.ts';

const facts=()=>caseFactsSchema.parse({borrower:{is_student:false,purpose:'普通消费'},lender:{type:'bank',internet_assisted:false,licensed:null},loan:{principal:'10000',disbursed:'10000',term_periods:12,period_payment:'888.49',repay_method:'equal_installment',start_date:'2026-09-01'},disclosure:{present:true,items_complete:true,contingent_disclosed:true},marketing_phrases:['按合同约定还款']});
const byId=(f:CaseFacts,id:string)=>evaluateRules(f,null,[]).find(rule=>rule.rule_id===id)!;

test('all twelve nature/status combinations have explicit dynamic levels and risk accounting',()=>{
  const expected={
    prohibited:{triggered:['red','red'],insufficient_data:['yellow',null],not_triggered:['blue',null],not_applicable:['blue',null]},
    disclosure:{triggered:['yellow','yellow'],insufficient_data:['blue',null],not_triggered:['blue',null],not_applicable:['blue',null]},
    advisory:{triggered:['blue',null],insufficient_data:['blue',null],not_triggered:['blue',null],not_applicable:['blue',null]},
  };
  for(const [nature,statuses] of Object.entries(expected))for(const [status,[level,risk]] of Object.entries(statuses)){
    const result=gradeRule(nature as RuleNature,status as RuleStatus);
    assert.equal(result.level,level,`${nature}/${status}`);assert.equal(result.risk_level,risk);
    assert.equal(result.grading_policy,RULE_GRADING_POLICY);
    assert.equal(result.fact_state,status==='insufficient_data'?'insufficient':status==='not_applicable'?'not_applicable':'sufficient');
  }
});

test('metadata defines every R01-R10 nature; matched disclosure and advisory rules never become red',()=>{
  const f=facts();f.disclosure.present=false;f.disclosure.contingent_disclosed=false;f.borrower.purpose='职业培训';f.funds_to='training_provider';f.marketing_phrases=['零利息'];
  const rows=evaluateRules(f,null,[]);
  const expected=['disclosure','disclosure','prohibited','disclosure','prohibited','prohibited','prohibited','advisory','advisory','disclosure'];
  assert.deepEqual(rows.map(rule=>rule.nature),expected);
  for(const id of ['R01','R10']){const row=rows.find(r=>r.rule_id===id)!;assert.equal(row.status,'triggered');assert.equal(row.level,'yellow');}
  for(const id of ['R08','R09']){const row=rows.find(r=>r.rule_id===id)!;assert.equal(row.status,'triggered');assert.equal(row.level,'blue');assert.equal(row.risk_level,null);}
});

test('known negative constituent and known non-applicability survive missing dates',()=>{
  const f=facts();f.loan.start_date=null;
  assert.equal(byId(f,'R06').status,'not_triggered');assert.equal(byId(f,'R07').status,'not_applicable');
  f.lender.type='microloan';f.borrower.is_student=true;f.lender.internet_consumer_loan=false;
  assert.equal(byId(f,'R05').status,'not_applicable');assert.equal(byId(f,'R06').status,'not_triggered');
  f.lender.internet_consumer_loan=null;assert.equal(byId(f,'R06').status,'insufficient_data');assert.equal(byId(f,'R06').risk_level,null);
  f.loan.start_date='2026-09-01';f.lender.internet_consumer_loan=true;
  assert.equal(byId(f,'R06').status,'triggered');assert.equal(byId(f,'R06').level,'red');
});

test('unknown licence is pending; a negative confirmed input is distinguished from a search absence',()=>{
  const f=facts();f.borrower.is_student=true;
  const unknown=byId(f,'R07');assert.equal(unknown.status,'insufficient_data');assert.equal(unknown.level,'yellow');assert.equal(unknown.risk_level,null);assert.match(unknown.reason,/不能等同/);
  f.lender.licensed=false;const denied=byId(f,'R07');assert.equal(denied.status,'triggered');assert.equal(denied.level,'red');assert.match(denied.reason,/未据此完成官方资质核验/);
  f.borrower.is_student=false;const outside=byId(f,'R07');assert.equal(outside.status,'not_applicable');assert.equal(outside.risk_level,null);assert.match(outside.reason,/不是在校学生/);
});

test('R05 requires assisted-lending scope and stays non-risk until determined',()=>{
  const f=facts();f.fees=[{id:'fee',name:'平台服务费',amount:'50',timing:'per_period',period:null,payee:'示例平台',payee_type:'platform',contingent:false,in_disclosure:true,included_in_cashflows:false,included_in_disclosed_cost:true}];
  assert.equal(byId(f,'R05').status,'not_applicable');
  f.lender.internet_assisted=null;assert.equal(byId(f,'R05').status,'insufficient_data');assert.equal(byId(f,'R05').risk_level,null);
  f.lender.internet_assisted=true;assert.equal(byId(f,'R05').status,'triggered');assert.equal(byId(f,'R05').level,'red');
  f.lender.type='microloan';assert.equal(byId(f,'R05').status,'not_applicable');
});

test('summary counts partition the rules without promoting pending checks or hints into issues',()=>{
  const summary=summarizeRules([{nature:'prohibited',status:'insufficient_data'},{nature:'disclosure',status:'insufficient_data'},{nature:'advisory',status:'triggered'},{nature:'prohibited',status:'not_triggered'},{nature:'prohibited',status:'not_applicable'}]);
  assert.equal(summary.level,'blue');assert.deepEqual(summary.counts,{confirmed_issues:0,pending_checks:2,advisory_hints:1,not_triggered:1,not_applicable:1});
  assert.equal(summarizeRules([{nature:'disclosure',status:'triggered'}]).level,'yellow');
  assert.equal(summarizeRules([{nature:'prohibited',status:'triggered'}]).level,'red');
});

test('a partial template report remains blue with explicit incompleteness rather than a false risk issue',async()=>{
  const f=facts();f.borrower.is_student=null;f.disclosure.present=null;f.disclosure.items_complete=null;
  const rules=evaluateRules(f,null,[]);
  const report=await generateReport(new CaseModel({...config,apiKey:undefined}),{facts:f,calculation:null,calculation_error:{code:'MISSING_FIELDS',message:'missing'},rules,evidence:[],corrections:[]},new AbortController().signal,()=>{});
  assert.equal(report.conclusion.level,'blue');assert.equal(report.conclusion.counts.confirmed_issues,0);assert(report.conclusion.counts.pending_checks>0);
  assert.equal(report.conclusion.partial,true);assert.equal(report.conclusion.information_incomplete,true);assert.equal(report.grading_policy,RULE_GRADING_POLICY);
});
