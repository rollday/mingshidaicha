import assert from 'node:assert/strict';
import test from 'node:test';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {CaseModel} from '../src/case-model.ts';
import {CaseWorkflow} from '../src/cases.ts';
import {config} from '../src/config.ts';
import {caseFactsSchema} from '../src/domain.ts';
import {reportPrefix} from '../src/report-stream.ts';
import {generateReport,type ReportInput} from '../src/report.ts';

const facts=()=>caseFactsSchema.parse({lender:{type:'bank',internet_assisted:false},loan:{principal:'10000',disbursed:'10000',term_periods:12,period_payment:'888.49',repay_method:'equal_installment',start_date:'2026-09-01'},disclosure:{present:true,items_complete:true,quoted_apr:'0.12',quoted_method:'nominal',contingent_disclosed:true},fees:[{id:'fee',name:'服务费',amount:'50',timing:'per_period',payee_type:'platform',contingent:false,in_disclosure:false,included_in_cashflows:false,included_in_disclosed_cost:false}]});
const writing=(content:string,summary='核算完成，额外费用合计{{summary.total_additional_fees}}。')=>{
  const input=JSON.parse(content) as ReportInput;
  return {summary,findings:input.rules.filter(r=>r.status==='triggered').map(r=>({rule_id:r.rule_id,explanation:'该项需要结合确认事实核对。'})),actions:[],limitations:['仅依据已提供材料和确认事实。']};
};

test('JSON prefix scanner decodes split escapes and exposes only narrative paths',()=>{
  const raw='{"private_prompt":"secret","summary":"第一行\\n金额\\u4e94\\\"元","findings":[{"rule_id":"R03","explanation":"待核对"}],"actions":[{"rule_id":null,"text":"索取清单"}],"limitations":["材料有限"]}';
  assert.equal(reportPrefix(raw)[0]?.text,'第一行\n金额五"元');
  assert.deepEqual(reportPrefix(raw).map(s=>s.kind),['summary','finding','action','limitation']);
  for(let n=1;n<raw.length;n++)assert(!JSON.stringify(reportPrefix(raw.slice(0,n))).includes('secret'));
  assert.equal(reportPrefix('{"summary":"金额\\u4e')[0]?.text,'金额');
  assert.equal(reportPrefix('{"summary":"引号\\')[0]?.text,'引号');
});

test('SDK forwards actual deltas before the upstream response finishes',async t=>{
  const gate=Promise.withResolvers<void>(),seen=Promise.withResolvers<void>();
  const server=createServer(async(req,res)=>{
    for await(const _ of req){}
    res.writeHead(200,{'content-type':'text/event-stream'});res.flushHeaders();
    const chunk=(content:string,finish:string|null=null)=>'data: '+JSON.stringify({id:'test',object:'chat.completion.chunk',created:0,model:'test',choices:[{index:0,delta:{content},finish_reason:finish}]})+'\n\n';
    res.write(chunk('{"summary":"正在生成'));
    await gate.promise;
    res.end(chunk('"}','stop')+'data: [DONE]\n\n');
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{gate.resolve();server.closeAllConnections();return new Promise<void>(r=>server.close(()=>r()));});
  const address=server.address();assert(address&&typeof address==='object');
  const model=new CaseModel({...config,apiKey:'test-only',baseURL:`http://127.0.0.1:${address.port}/v1`});
  let completed=false;const deltas:string[]=[];
  const pending=model.json('test','{}',AbortSignal.timeout(5000),()=>{},delta=>{deltas.push(delta);seen.resolve();}).then(value=>{completed=true;return value;});
  await seen.promise;assert.equal(completed,false);assert.equal(deltas.join(''),'{"summary":"正在生成');
  gate.resolve();assert.deepEqual(await pending,{summary:'正在生成'});
});

test('calculation, rule evidence and report draft arrive while final report is still blocked',async()=>{
  const workflow=new CaseWorkflow({...config,apiKey:undefined});
  const gate=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>();
  workflow.model.json=async(_system,content,_signal,_progress,delta)=>{
    const result=writing(String(content));delta?.(JSON.stringify(result));entered.resolve();await gate.promise;return result;
  };
  const events:{type:string;data:any}[]=[];const emit=(type:string,data:unknown)=>events.push({type,data});
  const signal=new AbortController().signal;
  await workflow.execute({type:'case.start',request_id:'start',documents:[],manual_facts:facts()},signal,emit,()=>undefined);
  const review=events.find(e=>e.type==='case.review')!.data;
  const pending=workflow.execute({type:'case.confirm',request_id:'confirm',case_id:review.case_id,expected_revision:0,facts:review.facts},signal,emit,()=>undefined);
  await entered.promise;
  assert(events.some(e=>e.type==='case.checked'));
  assert(!events.some(e=>e.type==='report.result'));
  const draft=events.find(e=>e.type==='report.draft'&&e.data.sections.length)?.data;
  assert.match(draft.sections[0].text,/600\.00元/);assert(!draft.sections[0].text.includes('{{'));
  const snapshot=workflow.view(workflow.get(review.case_id));
  assert.equal(snapshot.checked?.calculation?.summary.total_additional_fees,'600');
  assert(snapshot.activities.some(a=>a.kind==='analysis'&&a.rule_ids?.length));
  assert.equal(snapshot.report,null);
  gate.resolve();await pending;
  const report=workflow.get(review.case_id).report!;assert.equal(report.generation.mode,'ai');
  assert(report.processing_activity.length>0);assert(!JSON.stringify(report.processing_activity).includes('allowed_tokens'));
});

test('failed draft is withdrawn before retry and cancellation retains only checked results',async()=>{
  const workflow=new CaseWorkflow({...config,apiKey:undefined});
  let attempt=0;const entered=Promise.withResolvers<void>();
  workflow.model.json=async(_system,content,signal,_progress,delta)=>{
    attempt++;const value=writing(String(content),attempt===1?'第一份待核对草稿。':'第二份草稿。');
    if(attempt===1)value.findings=[];
    delta?.(JSON.stringify(value));
    if(attempt===2){entered.resolve();await new Promise<void>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));}
    return value;
  };
  const events:{type:string;data:any}[]=[];const emit=(type:string,data:unknown)=>events.push({type,data});
  const controller=new AbortController();
  await workflow.execute({type:'case.start',request_id:'start',documents:[],manual_facts:facts()},controller.signal,emit,()=>undefined);
  const review=events.find(e=>e.type==='case.review')!.data;
  const pending=workflow.execute({type:'case.confirm',request_id:'confirm',case_id:review.case_id,expected_revision:0,facts:review.facts},controller.signal,emit,()=>undefined);
  const rejected=assert.rejects(pending,{code:'TASK_CANCELLED'});
  await entered.promise;
  const drafts=events.filter(e=>e.type==='report.draft').map(e=>e.data);
  assert(drafts.some(d=>d.attempt===1&&d.sections.some((s:any)=>s.text.includes('第一份'))));
  assert(drafts.some(d=>d.status==='retrying'&&d.sections.length===0));
  assert(drafts.filter(d=>d.attempt===2).every(d=>!JSON.stringify(d).includes('第一份')));
  controller.abort();await rejected;
  const last=events.filter(e=>e.type==='report.draft').at(-1)!.data;
  assert.equal(last.status,'discarded');assert.deepEqual(last.sections,[]);
  assert(workflow.get(review.case_id).checked);assert.equal(workflow.get(review.case_id).report,null);
});

test('drafts render trusted placeholders but never forward raw unsupported amounts or private JSON fields',async()=>{
  const model=new CaseModel({...config,apiKey:undefined});
  model.json=async(_system,_content,_signal,_progress,delta)=>{
    delta?.('{"summary":"本金{{loan.principal}}元，');
    delta?.('另有9999元","findings":[],"actions":[],"limitations":["材料有限"],"private_prompt":"secret"}');
    return {summary:'本金9999元',findings:[],actions:[],limitations:['材料有限']};
  };
  const drafts:any[]=[];
  const report=await generateReport(model,{facts:facts(),calculation:null,calculation_error:null,rules:[],evidence:[],corrections:[]},new AbortController().signal,()=>{},draft=>drafts.push(structuredClone(draft)));
  assert.equal(report.generation.mode,'template');
  const texts=JSON.stringify(drafts.map(d=>d.sections));
  assert(texts.includes('10000.00元'));assert(!texts.includes('9999'));assert(!texts.includes('secret'));
  assert.equal(drafts.at(-1).status,'discarded');assert.deepEqual(drafts.at(-1).sections,[]);
});
