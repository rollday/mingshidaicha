import assert from 'node:assert/strict';
import test from 'node:test';
import { CaseModel } from '../src/case-model.ts';
import { config } from '../src/config.ts';
import { caseFactsSchema } from '../src/domain.ts';
import { generateReport } from '../src/report.ts';

function mockModel(responses: string[]) {
  const model = new CaseModel({ ...config, apiKey: undefined });
  let calls = 0;
  model.client = { chat: { completions: { create: async () => {
    const content = responses[calls++];
    if (content === undefined) throw new Error('unexpected extra model call');
    return {controller:{abort(){}},async *[Symbol.asyncIterator](){yield {choices:[{finish_reason:'stop',delta:{content}}]};}};
  } } } } as unknown as NonNullable<CaseModel['client']>;
  return {model,calls:()=>calls};
}
const input=()=>({facts:caseFactsSchema.parse({}),calculation:null,calculation_error:null,rules:[],evidence:[],corrections:[]});

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
