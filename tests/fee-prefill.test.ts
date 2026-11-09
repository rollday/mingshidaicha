import test from 'node:test';
import assert from 'node:assert/strict';
import { caseFactsSchema, type CaseFacts, type Evidence } from '../src/domain.ts';
import { inferFeePrefills } from '../shared/fee-prefill.ts';

const make = (): CaseFacts => caseFactsSchema.parse({
  loan: { principal: '20000', disbursed: '18871', period_payment: '913.69', term_periods: 24,
    periods_per_year: 12, nominal_apr: '0.09', repay_method: 'equal_installment' },
  fees: [['服务费','600','upfront'],['咨询费','499','upfront'],['资料费','30','upfront'],['担保费','120','per_period'],['平台费','88','per_period']]
    .map(([name, amount, timing], i) => ({ id: `f${i}`, name, amount, timing, contingent: false })),
});
const evidence = (field: string, quote: string, id = field): Evidence => ({ id, field, quote, document_id: 'doc', page: 1 });
const upfront = () => [0,1,2].map(i => evidence(`fees[${i}].included_in_cashflows`, '扣除服务费600元、咨询费499元、资料费30元后，实际到账18871元。'));
const annuity = () => [
  evidence('loan.principal','本金20000元'), evidence('loan.period_payment','每期本息913.69元'),
  evidence('loan.term_periods','共24期'), evidence('loan.periods_per_year','按月还款'),
  evidence('loan.repay_method','采用等额本息'), evidence('loan.nominal_apr','月利率0.75%'),
];
const recurring = (text = '每期本息913.69元，另行收取担保费120元、平台费88元。') => [3,4].map(i => evidence(`fees[${i}].included_in_cashflows`, text));

test('synthetic v2 explicitly named additional fees and net deduction resolve all five fees', () => {
  const facts = make(), before = structuredClone(facts);
  const result = inferFeePrefills(facts, [...upfront(), ...recurring()], []);
  assert.deepEqual(result.map(r => r.value), [true,true,true,false,false]);
  assert.deepEqual(result.map(r => r.treatment), ['deducted_from_disbursement','deducted_from_disbursement','deducted_from_disbursement','separate_charge','separate_charge']);
  assert.deepEqual(facts, before);
});

test('synthetic v3 single net deduction and included recurring amounts use selected totals', () => {
  const facts = make(); facts.loan.disbursed = '15559';
  facts.fees = [caseFactsSchema.parse({ fees: [{id:'v3',name:'服务费',amount:'4441',timing:'upfront',contingent:false}] }).fees[0]!];
  assert.equal(inferFeePrefills(facts, [evidence('fees[0].amount','扣除服务费4441元后，实际到账15559元。')], [])[0]?.value, true);
  const included = make(); included.loan.period_payment = '1121.69';
  assert.deepEqual(inferFeePrefills(included, recurring('每期还款总额1121.69元，含担保费120元、平台费88元。'), []).map(r => r.value), [true,true]);
});

test('independently evidenced A1 allows co-collection only for verified standard annuity', () => {
  const quote = '担保费120元、平台费88元与每期本息一并扣划。';
  const facts = make(), proof = [...annuity(), ...recurring(quote)];
  const result = inferFeePrefills(facts, proof, []);
  assert.equal(result.length, 2); assert.ok(result.every(r => r.rule_id === 'A1_VERIFIED_ANNUITY' && !r.value));
  for (const field of ['loan.principal','loan.period_payment','loan.term_periods','loan.periods_per_year','loan.repay_method','loan.nominal_apr']) {
    assert.deepEqual(inferFeePrefills(facts, proof.filter(e => e.field !== field), []), [], field);
  }
  assert.deepEqual(inferFeePrefills(facts, recurring(quote), []), []);
  facts.loan.period_payment = '900'; assert.deepEqual(inferFeePrefills(facts, proof, []), []);
});

test('A1 is disabled for subsidies, hypothetical statements, missing rates and explicit schedules', () => {
  for (const change of [(f: CaseFacts) => { f.loan.nominal_apr = null; }, (f: CaseFacts) => { f.repayments = [{period:1,amount:'913.69'}]; }]) {
    const facts = make(); change(facts);
    assert.deepEqual(inferFeePrefills(facts, [...annuity(),...recurring('担保费120元、平台费88元每期收取。')], []), []);
  }
  for (const qualifier of ['首期补贴', '例如', '尾期调整']) {
    assert.deepEqual(inferFeePrefills(make(), [...annuity(), evidence('loan.nominal_apr',qualifier),...recurring('担保费120元、平台费88元每期收取。')], []), []);
  }
});

test('a mixed upfront deduction and separate payment never subtracts every upfront fee', () => {
  const facts = make(); facts.loan.disbursed = '19400';
  const es = [evidence('fees[0].amount','扣除服务费600元后，实际到账19400元。'),
    evidence('fees[1].amount','实际到账19400元，另行支付咨询费499元。')];
  assert.deepEqual(inferFeePrefills(facts, es, []).map(r => [r.fee_id,r.value]), [['f0',true],['f1',false]]);
});

test('gross selected disbursement, mismatching totals and positive/negative contradictions stay unresolved', () => {
  const facts = make(); facts.loan.disbursed = '20000';
  assert.deepEqual(inferFeePrefills(facts, upfront(), []), []);
  const inc = recurring('每期还款总额1121.69元，含担保费120元、平台费88元。');
  assert.deepEqual(inferFeePrefills(make(), inc, []), []);
  facts.loan.period_payment = '1121.69';
  const conflicting = recurring('每期还款总额1121.69元，另行收取担保费120元、平台费88元。');
  assert.deepEqual(inferFeePrefills(facts, [...inc,...conflicting], []), []);
  assert.deepEqual(inferFeePrefills(facts, inc, [{field:'loan.period_payment',description:'冲突',evidence_ids:[]}]), []);
});

test('a different collection channel or unspecified net amount does not establish exclusion', () => {
  assert.deepEqual(inferFeePrefills(make(), recurring('担保费120元、平台费88元不与每期本息一并扣划。'), []), []);
  assert.deepEqual(inferFeePrefills(make(), [evidence('fees[0].amount','放款后另行支付服务费600元。')], []), []);
});

test('source fee IDs preserve evidence after reorder; modified names amounts and schedules require new support', () => {
  const source = make(), facts = structuredClone(source); facts.fees.reverse();
  const results = inferFeePrefills(facts, [...upfront(), ...recurring()], [], source);
  assert.equal(results.length,5); assert.equal(results[0]?.field,'fees[0].included_in_cashflows'); assert.equal(results[0]?.fee_id,'f4');
  facts.fees[0]!.amount = '99';
  assert.equal(inferFeePrefills(facts, recurring(), [], source).some(r => r.fee_id === 'f4'), false);
  facts.fees[1]!.name = '不同费用';
  assert.deepEqual(inferFeePrefills(facts, recurring(), [], source), []);
});

test('all three existing states get equivalent suggestions and sub-cent decimals are exact', () => {
  for (const state of [null,true,false]) {
    const facts = make(); facts.fees.forEach(f => { f.included_in_cashflows = state; });
    assert.deepEqual(inferFeePrefills(facts,[...upfront(),...recurring()],[]).map(r=>r.value),[true,true,true,false,false]);
  }
  const f = make(); f.loan.period_payment='0.3'; f.fees=f.fees.slice(3); f.fees[0]!.amount='0.1';f.fees[1]!.amount='0.2';
  const es=[0,1].map(i=>evidence(`fees[${i}].amount`,'每期还款总额0.3元，含担保费0.1元、平台费0.2元。'));
  assert.equal(inferFeePrefills(f,es,[]).length,2);
  f.fees[1]!.amount='0.2001';es.forEach(e=>{e.quote=e.quote.replace('0.2元','0.2001元');});
  assert.deepEqual(inferFeePrefills(f,es,[]),[]);
});

test('unsupported timing, contingent fees, unscoped evidence and duplicate names are not guessed', () => {
  const f=make(); f.fees[0]!.contingent=true;f.fees[1]!.timing='at_maturity';f.fees[2]!.name='服务费';
  assert.deepEqual(inferFeePrefills(f,upfront(),[]),[]);
  assert.deepEqual(inferFeePrefills(make(),[evidence('fees[88].amount','每期本息913.69元，另行收取担保费120元。')],[]),[]);
});

test('explicit named exclusion is usable but contradictory inclusion remains unresolved', () => {
  const f=make();
  const excluded=evidence('fees[3].included_in_cashflows','担保费120元未计入每期还款额913.69元内。');
  assert.equal(inferFeePrefills(f,[excluded],[])[0]?.value,false);
  const included=evidence('fees[3].included_in_cashflows','每期还款额913.69元，含担保费120元。','included');
  assert.deepEqual(inferFeePrefills(f,[excluded,included],[]),[]);
  assert.deepEqual(inferFeePrefills(f,[included,...annuity()],[]),[]);
});

test('partial browser edits never throw or generate suggestions', () => {
  for (const value of ['1.','abc','','-1','1e3','NaN','9'.repeat(81),1,undefined]) {
    const f=make(); (f.loan as unknown as Record<string, unknown>).principal=value;
    assert.doesNotThrow(()=>inferFeePrefills(f,upfront(),[])); assert.deepEqual(inferFeePrefills(f,upfront(),[]),[]);
    const fee=make(); (fee.fees[0] as unknown as Record<string, unknown>).amount=value;
    assert.deepEqual(inferFeePrefills(fee,upfront(),[]),[]);
  }
  for (const value of [0,-1,1.5,NaN,Infinity,'24',601]) {
    const f=make(); (f.loan as unknown as Record<string, unknown>).term_periods=value;
    assert.deepEqual(inferFeePrefills(f,upfront(),[]),[]);
  }
});

test('scoped forward exclusions, explicit outside-amount fees, P2 and P4 bind selected amounts', () => {
  const f=make();
  for (const quote of ['每期还款总额913.69元，不包含担保费120元、平台费88元。',
    '每期本息913.69元，在该金额之外另行收取担保费120元、平台费88元。']) {
    assert.deepEqual(inferFeePrefills(f,recurring(quote),[]).map(r=>r.value),[false,false]);
  }
  f.loan.period_payment='1121.69';
  for (const quote of ['担保费120元已计入每期还款总额1121.69元内。',
    '每期还款总额1121.69元，担保费120元已计入上述还款额。']) {
    assert.equal(inferFeePrefills(f,[evidence('fees[3].amount',quote)],[])[0]?.value,true);
    f.fees[3]!.amount='121'; assert.deepEqual(inferFeePrefills(f,[evidence('fees[3].amount',quote)],[]),[]);f.fees[3]!.amount='120';
  }
  const pos=recurring('每期还款总额1121.69元，含担保费120元、平台费88元。');
  const neg=recurring('每期还款总额1121.69元，不包含担保费120元、平台费88元。');
  assert.deepEqual(inferFeePrefills(f,[...pos,...neg],[]),[]);
});

test('A1 rejects negated repayment methods and conflicting or negated rate evidence', () => {
  for (const [field,quote] of [['loan.repay_method','非等额本息'],['loan.repay_method','不是等额本息'],
    ['loan.nominal_apr','不是月利率0.75%'],['loan.nominal_apr','月利率0.8%'],
    ['loan.nominal_apr','月利率0.75%，年利率8%']]) {
    const es=[...annuity(),evidence(field!,quote!,'contradiction'),...recurring('担保费120元、平台费88元每期收取。')];
    assert.deepEqual(inferFeePrefills(make(),es,[]),[],quote!);
  }
});

test('an unbound same-fee separate charge cannot resurrect a rejected upfront inclusion', () => {
  const f=make(); f.loan.disbursed='19400';
  const positive='扣除服务费600元后，实际到账19400元。';
  for (const statement of ['服务费600元额外收取。','服务费另行收取。','另外支付服务费600元。',
    '服务费600元已免收。','若服务费600元已支付则不再扣除。']) {
    const quote=positive+statement;
    assert.deepEqual(inferFeePrefills(f,[evidence('fees[0].included_in_cashflows',quote)],[]),[],statement);
    assert.deepEqual(inferFeePrefills(f,[evidence('fees[0].included_in_cashflows',positive),
      evidence('fees[0].amount',statement,'other')],[]),[],statement);
  }
  assert.deepEqual(inferFeePrefills(f,[evidence('fees[0].amount','服务费600元额外收取。')],[]),[]);
  assert.equal(inferFeePrefills(f,[evidence('fees[0].included_in_cashflows',positive+'资料费30元额外收取。')],[])[0]?.value,true);
});

test('A1 binds principal, payment and full term instead of unrelated matching numbers', () => {
  const recurringProof=recurring('担保费120元、平台费88元每期收取。');
  for (const [field,quote] of [
    ['loan.principal','贷款本金18000元，担保最高金额20000元'],
    ['loan.principal','贷款本金20000元，实际借款本金18000元'],
    ['loan.principal','担保最高金额20000元'],
    ['loan.term_periods','共36期，其中前24期享受折扣'],
    ['loan.term_periods','共36期，其中前24期按时支付'],
    ['loan.term_periods','共24期，实际共36期'],
    ['loan.period_payment','每期本息900元，担保费用合计913.69元'],
    ['loan.principal','贷款本金20000元，减免利息'],
  ]) {
    const es=annuity().map(e=>e.field===field?evidence(field!,quote!):e);
    assert.deepEqual(inferFeePrefills(make(),[...es,...recurringProof],[]),[],quote!);
  }
  for (const [field,quote] of [['loan.principal','贷款本金18000元'],['loan.term_periods','共36期'],['loan.period_payment','每期本息900元']]) {
    assert.deepEqual(inferFeePrefills(make(),[...annuity(),evidence(field!,quote!,'contradiction'),...recurringProof],[]),[],quote!);
  }
});

test('A1 requires affirmative ordinary-loan semantics and rejects inclusion hidden in a fee quotation', () => {
  const feeProof=recurring('担保费120元、平台费88元每期收取。');
  for (const [field,quote] of [['loan.periods_per_year','不按月还款'],['loan.term_periods','本合同不采用24期'],
    ['loan.repay_method','禁止采用等额本息'],['loan.nominal_apr','逾期年利率9%'],
    ['loan.nominal_apr','罚息年利率9%'],['loan.nominal_apr','综合年利率9%'],
    ['loan.repay_method','无需采用等额本息'],['loan.periods_per_year','季度还款，每月提醒'],
  ]) {
    const es=annuity().map(e=>e.field===field?evidence(field!,quote!):e);
    assert.deepEqual(inferFeePrefills(make(),[...es,...feeProof],[]),[],quote!);
  }
  for (const quote of ['每期还款913.69元（内含担保费120元）。','每期担保费120元已免收。',
    '每期担保费120元予以减收。','每期担保费120元无需支付。']) {
    assert.deepEqual(inferFeePrefills(make(),[...annuity(),evidence('fees[3].amount',quote)],[]),[],quote);
  }
});
