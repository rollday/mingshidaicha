import test from 'node:test';
import assert from 'node:assert/strict';
import { caseFactsSchema } from '../src/domain.ts';
import { feeNeedsAprReview, feeEvidence, invalidateFeePrefills, manualFeeEdits } from '../frontend/src/lib/fee-review.ts';
import type { FeePrefill } from '../shared/fee-prefill.ts';
const source = () => caseFactsSchema.parse({ loan:{period_payment:'1100'}, fees:[
  {id:'a',name:'服务费',amount:'100',timing:'per_period',contingent:false,included_in_cashflows:true},
  {id:'b',name:'担保费',amount:'20',timing:'per_period',contingent:false,included_in_cashflows:null},
] });
const automatic: FeePrefill[] = [{fee_id:'a',field:'fees[0].included_in_cashflows',value:true,treatment:'in_period_payment',rule_id:'test',reason:'test',evidence_ids:['e']}];
test('APR blockers depend on missing cash-flow facts, not fee names or disclosure-only fields', () => {
  const facts=source();
  assert.equal(feeNeedsAprReview(facts.fees[0]!),false);
  assert.equal(feeNeedsAprReview(facts.fees[1]!),true);
  assert.equal(feeNeedsAprReview({...facts.fees[0]!,amount:null}),true);
  assert.equal(feeNeedsAprReview({...facts.fees[1]!,contingent:true}),false);
});
test('fee evidence retains original identity after deleting earlier fee', () => {
  const facts=source();
  const evidence=[{id:'e',field:'fees[1].included_in_cashflows',document_id:'d',page:1,quote:'担保费另收'}];
  assert.deepEqual(feeEvidence(facts.fees[1]!.id,facts,evidence),evidence);
  assert.deepEqual(feeEvidence('new',facts,evidence),[]);
});
test('changing payment basis clears automatic inclusion while retaining explicit user decisions', () => {
  const before=source(), after=structuredClone(before);
  after.loan.period_payment='1000';
  assert.equal(invalidateFeePrefills(before,after,automatic,new Set()).fees[0]!.included_in_cashflows,null);
  assert.equal(invalidateFeePrefills(before,after,automatic,new Set(['a'])).fees[0]!.included_in_cashflows,true);
  assert.equal(invalidateFeePrefills(before,before,automatic,new Set()).fees[0]!.included_in_cashflows,true);
});

test('reopened adopted suggestion remains automatic despite its correction; explicit manual decisions survive', () => {
  const facts=source();
  const corrections=[{field:'fees[0].included_in_cashflows',fee_id:'a',before:null,after:true}];
  const reopened={facts,corrections,manual_fee_ids:[]};
  const changed=structuredClone(facts);
  changed.loan.period_payment='900';
  assert.equal(manualFeeEdits(reopened).size,0);
  assert.equal(invalidateFeePrefills(facts,changed,automatic,manualFeeEdits(reopened)).fees[0]!.included_in_cashflows,null);
  const manuallyConfirmed={...reopened,manual_fee_ids:['a']};
  assert.equal(invalidateFeePrefills(facts,changed,automatic,manualFeeEdits(manuallyConfirmed)).fees[0]!.included_in_cashflows,true);
  assert.deepEqual([...manualFeeEdits({facts,corrections})],['a']);
});
