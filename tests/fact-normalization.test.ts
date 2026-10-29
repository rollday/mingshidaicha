import assert from 'node:assert/strict';
import test from 'node:test';
import {CaseWorkflow} from '../src/cases.ts';
import {config} from '../src/config.ts';
import {caseFactsSchema} from '../src/domain.ts';
import {normalizeCaseFacts} from '../src/facts.ts';

const complete = () => caseFactsSchema.parse({loan:{start_date:'2026-09-01'},disclosure:{present:true,items_complete:true,contingent_disclosed:null}});
const fee = (contingent:boolean|null,in_disclosure:boolean|null) => ({id:'f',name:'费用',amount:null,timing:'unknown' as const,period:null,payee:null,payee_type:'unknown' as const,in_disclosure,included_in_cashflows:null,included_in_disclosed_cost:null,contingent});

test('complete table without a contingent row gets the requested default without mutating the input',()=>{
  const input=complete();const result=normalizeCaseFacts(input);
  assert.equal(input.disclosure.contingent_disclosed,null);
  assert.equal(result.disclosure.contingent_disclosed,false);
  input.fees=[fee(false,true),fee(true,false)];
  assert.equal(normalizeCaseFacts(input).disclosure.contingent_disclosed,false);
});

test('explicit values and incomplete or ambiguous disclosure remain untouched',()=>{
  for(const value of [true,false] as const){const facts=complete();facts.disclosure.contingent_disclosed=value;assert.equal(normalizeCaseFacts(facts).disclosure.contingent_disclosed,value);}
  for(const value of [null,false] as const){const facts=complete();facts.disclosure.present=value;assert.equal(normalizeCaseFacts(facts).disclosure.contingent_disclosed,null);}
  for(const value of [null,false] as const){const facts=complete();facts.disclosure.items_complete=value;assert.equal(normalizeCaseFacts(facts).disclosure.contingent_disclosed,null);}
  for(const [contingent,disclosed] of [[true,true],[true,null],[null,true],[null,null]] as const){const facts=complete();facts.fees=[fee(contingent,disclosed)];assert.equal(normalizeCaseFacts(facts).disclosure.contingent_disclosed,null);}
});

test('case confirmation normalizes facts and makes R10 trigger for a complete table without contingent rows',async()=>{
  const workflow=new CaseWorkflow({...config,apiKey:undefined});
  const original=complete();original.disclosure.items_complete=null;
  const events:{type:string;data:any}[]=[];const emit=(type:string,data:unknown)=>events.push({type,data});const signal=new AbortController().signal;
  await workflow.execute({type:'case.start',request_id:'start',documents:[],manual_facts:original},signal,emit,()=>undefined);
  const review=events.find(e=>e.type==='case.review')!.data;
  assert.equal(review.facts.disclosure.contingent_disclosed,null);
  const confirmed=structuredClone(review.facts);confirmed.disclosure.items_complete=true;
  await workflow.execute({type:'case.confirm',request_id:'confirm',case_id:review.case_id,expected_revision:0,facts:confirmed},signal,emit,()=>undefined);
  const report=events.find(e=>e.type==='report.result')!.data.report;
  assert.equal(report.facts.disclosure.contingent_disclosed,false);
  assert.equal(report.rules.find((r:any)=>r.rule_id==='R10').status,'triggered');
  assert(report.corrections.some((change:any)=>change.field==='disclosure.contingent_disclosed'&&change.after===false));
});
