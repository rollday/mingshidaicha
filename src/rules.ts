import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CaseFacts, Evidence, LoanResult, RuleResult } from './domain.ts';
import {defaultRuleLevel,gradeRule,type RuleNature} from '../shared/rule-policy.ts';

type Citation = NonNullable<RuleResult['citation']>;
type RuleDefinition = {
  id: string;
  title: string;
  nature:RuleNature;
  default_level:RuleResult['default_level'];
  effective_date: string | null;
  citation: Citation | null;
};

const regulationData = JSON.parse(
  readFileSync(resolve('data/regulations.json'), 'utf8'),
) as { rules: RuleDefinition[] };
const rules = new Map(regulationData.rules.map((rule) => [rule.id, rule]));
for(const rule of rules.values()){
  if(!['prohibited','disclosure','advisory'].includes(rule.nature) || rule.default_level!==defaultRuleLevel(rule.nature))throw new Error(`Invalid rule grading metadata: ${rule.id}`);
}

function evidenceIds(evidence: Evidence[], fields: string[]): string[] {
  const wanted = fields.map((field) => field.toLowerCase());
  return [...new Set(evidence
    .filter((item) => typeof item.id === 'string' && item.id.length > 0)
    .filter((item) => wanted.some((field) => item.field.toLowerCase().includes(field)))
    .map((item) => item.id))];
}

function result(
  id: string,
  status: RuleResult['status'],
  reason: string,
  action: string,
  ids: string[] = [],
): RuleResult {
  const definition = rules.get(id);
  if (!definition) throw new Error(`Missing regulation data for ${id}`);
  return {
    rule_id: id,
    title: definition.title,
    status,
    ...gradeRule(definition.nature,status),
    reason,
    action,
    citation: definition.citation,
    evidence_ids: ids,
  };
}

function temporalStatus(
  id: string,
  facts: CaseFacts,
  asOf: string,
  ids: string[],
): RuleResult | null {
  const definition = rules.get(id);
  if (!definition?.effective_date) return null;
  const start = facts.loan.start_date;
  if (!start) {
    return result(id, 'insufficient_data', '贷款发生日期未知，无法判断该规则是否适用。', '补充贷款合同或放款日期。', ids);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return result(id, 'insufficient_data', '贷款日期或核查日期格式无效，无法判断规则适用期间。', '核对并补充有效日期。', ids);
  }
  if (asOf < definition.effective_date) {
    return result(id, 'not_applicable', `核查日期早于规则施行日 ${definition.effective_date}。`, '无需按该项新规判断；可按业务发生时有效的规定另行核查。', ids);
  }
  if (start < definition.effective_date) {
    return result(id, 'not_applicable', `贷款发生于规则施行日 ${definition.effective_date} 之前，不直接套用该项新规。`, '如需判断存量业务，请核对当时有效的规定及过渡安排。', ids);
  }
  return null;
}

const disclosureFields = ['disclosure', '明示', '综合融资成本', '息费'];
const feeFields = ['fee', '费用', '息费', '增信', '担保'];
const marketingPatterns = [
  /零利息|无利息|免利息|零息|免息|无息/,
  /百分之百通过|100\s*%\s*通过|包过|必过/,
  /不查征信|不看征信|无视征信/,
  /无门槛|零门槛/,
];

export function evaluateRules(
  facts: CaseFacts,
  resultValue: LoanResult | null,
  evidence: Evidence[],
  options?: { as_of?: string },
): RuleResult[] {
  const asOf = options?.as_of ?? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const dateSensitive = ['R01', 'R02', 'R03', 'R04', 'R05', 'R06', 'R07', 'R10'];
  const temporal = new Map<string, RuleResult>();
  for (const id of dateSensitive) {
    const ids = evidenceIds(evidence, id === 'R06' || id === 'R07' ? ['student', '学生', 'lender', '放贷'] : disclosureFields.concat(feeFields));
    const status = temporalStatus(id, facts, asOf, ids);
    if (status) temporal.set(id, status);
  }

  const output: RuleResult[] = [];
  const push = (id: string, status: RuleResult['status'], reason: string, action: string, fields = disclosureFields) => {
    const dated=temporal.get(id);
    // A known false constituent cannot become a suspected issue merely because
    // another (irrelevant) input, such as the start date, remains unknown.
    const decisive=status==='not_applicable' || status==='not_triggered'&&dated?.status!=='not_applicable';
    output.push(!decisive&&dated ? dated : result(id,status,reason,action,evidenceIds(evidence,fields)));
  };

  push('R01', facts.disclosure.present === false || facts.disclosure.items_complete === false
    ? 'triggered'
    : facts.disclosure.present === true && facts.disclosure.items_complete === true
      ? 'not_triggered'
      : 'insufficient_data',
  facts.disclosure.present === false || facts.disclosure.items_complete === false
    ? '现有事实明确显示综合融资成本明示表缺失或项目不完整。'
    : facts.disclosure.present === true && facts.disclosure.items_complete === true
      ? '现有事实标记明示表存在且项目完整；本规则未发现明确缺项。'
      : '明示表是否存在或项目是否完整未知，不能据此视为合规。',
  '核对明示表是否列明本金、各息费项目、收取方式、标准、主体及年化综合成本。');

  const comparison = resultValue?.calculation.comparison;
  const assumed = comparison?.method_basis === 'assumed_simple';
  push('R02', assumed ? 'insufficient_data' : comparison?.exceeds_tolerance === true ? 'triggered' : comparison?.exceeds_tolerance === false ? 'not_triggered' : 'insufficient_data',
    assumed && comparison?.exceeds_tolerance === true
      ? '按单利推定的重算差额超过项目容差；原披露口径未确认，须核实后才能判断是否真正存在差异。'
      : assumed && comparison?.exceeds_tolerance === false
        ? '按单利推定的重算差额未超过项目容差；原披露口径仍需确认。'
        : assumed ? '已按单利推定重算，但缺少可比较的标注值或披露口径尚未确认。'
      : comparison?.exceeds_tolerance === true
    ? '同口径自算值与标注值的差异超过本项目设置的容差；该阈值不是违法认定标准。'
      : comparison?.exceeds_tolerance === false
        ? '同口径重算值与披露值的差异未超过本项目设置的容差。'
        : '缺少可比较的计算结果或明确的披露口径，暂不能判断差异。',
    '核实实际到账和还款安排，并明确明示表采用的年化口径。');

  const normalFees = facts.fees.filter((fee) => fee.contingent === false);
  const undisclosedNormal = normalFees.filter((fee) => fee.in_disclosure === false);
  const unknownNormalDisclosure = facts.fees.some(fee => fee.contingent === null) || normalFees.some((fee) => fee.in_disclosure === null);
  push('R03', undisclosedNormal.length
    ? 'triggered'
    : unknownNormalDisclosure || facts.disclosure.items_complete !== true
      ? 'insufficient_data'
      : 'not_triggered',
  undisclosedNormal.length
    ? `已确认 ${undisclosedNormal.length} 项正常履约费用未列入明示表。`
    : unknownNormalDisclosure || facts.disclosure.items_complete !== true
      ? '正常履约费用的披露情况或费用清单完整性未知。'
      : '已知正常履约费用均列入明示表，或明示项目完整且未发现缺项。',
  '逐项核对利息、分期费及其他正常履约费用的披露。', feeFields.concat(disclosureFields));

  const enhancementFees = normalFees.filter((fee) => fee.payee_type === 'guarantor' || /增信|担保/.test(fee.name));
  const omittedEnhancement = enhancementFees.filter((fee) => fee.included_in_disclosed_cost === false);
  const unknownEnhancement = facts.fees.some(fee => fee.contingent === null) || enhancementFees.some((fee) => fee.included_in_disclosed_cost === null);
  push('R04', omittedEnhancement.length
    ? 'triggered'
    : unknownEnhancement || facts.disclosure.items_complete !== true
      ? 'insufficient_data'
      : 'not_triggered',
  omittedEnhancement.length
    ? `已确认 ${omittedEnhancement.length} 项正常增信费用未计入披露的综合融资成本。`
    : unknownEnhancement || facts.disclosure.items_complete !== true
      ? '是否存在或是否计入正常增信费用未知。'
      : '已知正常增信费用均已计入，或完整披露事实未显示该项缺失。',
  '核对担保、保证保险等正常增信费用是否纳入综合融资成本计算。', feeFields.concat(disclosureFields));

  // A known platform fee does not cease to be a fee because its amount or
  // disclosure status is unknown. An explicitly zero amount is not a charge.
  const directPlatformFees = normalFees.filter((fee) => fee.payee_type === 'platform' && (fee.amount === null || /[1-9]/.test(fee.amount)));
  if (!['bank', 'consumer_finance'].includes(facts.lender.type)) {
    push('R05', facts.lender.type === 'unknown' ? 'insufficient_data' : 'not_applicable',
      facts.lender.type === 'unknown' ? '放贷主体类型未知，且字段不足以确认是否属于互联网助贷。' : '当前类型无法确认属于该通知适用或参照执行的主体范围。',
      '核实放贷主体及业务合作模式后再判断平台收费规则。', feeFields);
  } else if (facts.lender.internet_assisted === false) {
    push('R05', 'not_applicable', '已确认不属于商业银行互联网助贷业务。', '按实际业务模式核实其他收费要求。', feeFields);
  } else if (facts.lender.internet_assisted === true && directPlatformFees.length) {
    push('R05', 'triggered', '已确认属于商业银行互联网助贷业务，且存在平台向借款人直接收取的正常履约收费项目；收费金额和是否列在明示表中分别核对。', '向贷款人核实平台收费安排及费用收取依据。', feeFields);
  } else if (facts.lender.internet_assisted === true && facts.disclosure.items_complete === true && facts.fees.every(fee => fee.contingent === true || fee.contingent === false && fee.payee_type !== 'unknown')) {
    push('R05', 'not_triggered', '已确认的完整费用清单未显示平台直接收费。', '保留费用清单和实际扣款记录。', feeFields);
  } else if (directPlatformFees.length) {
    push('R05', 'insufficient_data', '发现平台收款的正常费用，但当前事实不能证明该贷款属于商业银行互联网助贷业务；不据此断言违规。', '核实业务是否属于商业银行互联网助贷，并核对平台收费主体与资金流。', feeFields);
  } else {
    push('R05', 'insufficient_data', '当前字段不能确认商业银行互联网助贷业务适用性，也不能排除平台直接收费。', '核实业务模式及平台是否向借款人直接收取息费。', feeFields);
  }

  const studentConditions = [facts.lender.type === 'microloan', facts.borrower.is_student === true, facts.lender.internet_consumer_loan === true];
  const studentHasFalse = facts.lender.type !== 'unknown' && facts.lender.type !== 'microloan'
    || facts.borrower.is_student === false || facts.lender.internet_consumer_loan === false;
  const onlineClue = facts.lender.internet_consumer_loan === null && evidence.some(item =>
    /(?:internet_consumer_loan|loan|lender|贷款|借款)/i.test(item.field) && /线上|在线|网络申请|互联网|\bAPP\b/i.test(item.quote)
    && !/(?:未|不|非|没有|禁止)(?:通过|使用|采用|在线|线上|互联网|网络|APP)/i.test(item.quote));
  push('R06', studentHasFalse ? 'not_triggered' : studentConditions.every(Boolean) ? 'triggered' : 'insufficient_data',
    studentHasFalse
      ? '小额贷款公司、在校学生、互联网消费贷款三个条件至少一个已明确不成立。'
      : studentConditions.every(Boolean)
        ? '三个条件均明确为真：放贷主体为小额贷款公司、借款人为在校学生、贷款为互联网消费贷款。'
        : onlineClue
          ? '材料存在线上或互联网办理线索，但仍需核实其是否为互联网消费贷款；三项条件未全部确认。'
          : '三项适用条件中至少一项未知；不得把未知条件当作成立或不成立。',
    '核实放贷主体、在校身份及贷款产品属性；该提示不替代个案法律判断。', ['学生', 'student', '放贷', '贷款', 'lender', 'loan']);

  push('R07', facts.borrower.is_student === false ? 'not_applicable' : facts.borrower.is_student === null ? 'insufficient_data' : facts.lender.licensed === false ? 'triggered' : facts.lender.licensed === true ? 'not_triggered' : 'insufficient_data',
    facts.borrower.is_student===false?'已确认借款人不是在校学生，不套用本条针对大学生信贷服务的资质核查。':facts.borrower.is_student===null?'借款人是否为在校学生未知，无法判断本条资质核查的适用性。':facts.lender.licensed === false
    ? '用户确认的信息将主体资质标记为否，命中本项核查条件；本系统未据此完成官方资质核验或作出违法结论。'
      : facts.lender.licensed === true
        ? '用户确认的信息将主体资质标记为是；本系统未进行牌照联网核验。'
        : '主体资质未知；未查到公开信息不能等同于未获批准，不据此认定存在资质问题。',
    '通过监管部门官方渠道核验主体名称、业务范围及适用许可。', ['资质', 'licensed', '放贷', 'lender']);

  const purpose = facts.borrower.purpose.toLowerCase();
  const targetPurpose = /培训|教育|求职|就业|美容|医美|整形/.test(purpose);
  const directThirdParty = facts.funds_to === 'training_provider' || facts.funds_to === 'third_party';
  push('R08', targetPurpose && directThirdParty
    ? 'triggered'
    : targetPurpose && facts.funds_to === 'unknown' || purpose === 'unknown'
      ? 'insufficient_data'
      : !targetPurpose ? 'not_applicable' : 'not_triggered',
  targetPurpose && directThirdParty
    ? '用途涉及培训、求职或美容，且资金流向服务提供方或其他第三方；仅作风险提示，不作违法判断。'
    : targetPurpose && facts.funds_to === 'unknown' || purpose === 'unknown'
      ? '用途或资金去向信息不足，无法判断场景特征。'
      : !targetPurpose ? '未识别到培训、求职或美容类用途特征。' : '虽识别到相关用途，但现有事实显示资金未直接支付给第三方。',
  '核实合同用途、资金支付路径及实际服务；该场景提示的官方依据待核实。', ['用途', 'purpose', '资金', 'funds']);

  const matchingPhrases = facts.marketing_phrases.filter((phrase) => marketingPatterns.some((pattern) => pattern.test(phrase)));
  push('R09', matchingPhrases.length ? 'triggered' : facts.marketing_phrases.length ? 'not_triggered' : 'insufficient_data',
    matchingPhrases.length
      ? `营销文本命中需人工核验的绝对化或低门槛话术（${matchingPhrases.length} 项）；仅作蓝色提示，不作违法判断。`
      : facts.marketing_phrases.length
        ? '已提供营销文本，未命中当前确定性提示词；这不代表营销内容整体合规。'
        : '未提供可检查的营销文本，不能视为不存在相关话术。',
    '人工核对原始营销页面、适用对象和上下文；本规则提示词范围及法律依据待核实。', ['营销', 'marketing']);

  const contingentFees = facts.fees.filter((fee) => fee.contingent === true);
  push('R10', facts.disclosure.contingent_disclosed === false
    ? 'triggered'
    : facts.disclosure.contingent_disclosed === true
      ? 'not_triggered'
      : contingentFees.length
        ? 'insufficient_data'
        : 'insufficient_data',
  facts.disclosure.contingent_disclosed === false
    ? '当前事实标记或有成本未披露；完整明示表没有或有成本行时也按此默认，请核对材料。'
    : facts.disclosure.contingent_disclosed === true
      ? '事实标记或有成本披露完整；本规则未发现明确缺失。'
      : '或有成本披露情况未知；或有费用不作为正常履约费用触发红色费用提示。',
  '逐项核对逾期、挪用等违约情况下的或有成本、标准及收取主体。', feeFields.concat(disclosureFields));

  return output;
}
