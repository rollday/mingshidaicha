/** Versioned project grading. Colours are not statutory classifications. */
export const RULE_GRADING_POLICY='2026-10-28.v1' as const;
export type RuleNature='prohibited'|'disclosure'|'advisory';
export type RuleStatus='triggered'|'not_triggered'|'insufficient_data'|'not_applicable';
export type RuleLevel='red'|'yellow'|'blue';
export type RuleFactState='sufficient'|'insufficient'|'not_applicable';
export const natureLabels:Record<RuleNature,string>={prohibited:'禁止性核查',disclosure:'披露核查',advisory:'阅读提示'};
const defaults:Record<RuleNature,RuleLevel>={prohibited:'red',disclosure:'yellow',advisory:'blue'};
export function defaultRuleLevel(nature:RuleNature):RuleLevel{return defaults[nature];}
export function gradeRule(nature:RuleNature,status:RuleStatus){
  const default_level=defaultRuleLevel(nature);
  const level:RuleLevel=status==='triggered'?default_level:status==='insufficient_data'&&nature==='prohibited'?'yellow':'blue';
  const risk_level:Exclude<RuleLevel,'blue'>|null=status==='triggered'&&nature!=='advisory'?nature==='prohibited'?'red':'yellow':null;
  const fact_state:RuleFactState=status==='not_applicable'?'not_applicable':status==='insufficient_data'?'insufficient':'sufficient';
  return {nature,default_level,level,risk_level,fact_state,grading_policy:RULE_GRADING_POLICY};
}
export function summarizeRules(rules:ReadonlyArray<{nature:RuleNature;status:RuleStatus}>){
  const counts={confirmed_issues:0,pending_checks:0,advisory_hints:0,not_triggered:0,not_applicable:0};
  let level:RuleLevel='blue';
  for(const rule of rules){
    const grade=gradeRule(rule.nature,rule.status);
    if(rule.status==='insufficient_data')counts.pending_checks++;
    else if(rule.status==='not_triggered')counts.not_triggered++;
    else if(rule.status==='not_applicable')counts.not_applicable++;
    else if(rule.nature==='advisory')counts.advisory_hints++;
    else {counts.confirmed_issues++;if(grade.risk_level==='red')level='red';else if(level!=='red')level='yellow';}
  }
  return {level,counts,grading_policy:RULE_GRADING_POLICY};
}
export function rulePresentation(rule:{nature:RuleNature;status:RuleStatus}){
  const grade=gradeRule(rule.nature,rule.status);
  const tone=rule.status==='not_triggered'?'green':rule.status==='not_applicable'?'neutral':grade.level==='yellow'?'amber':grade.level;
  const label=rule.status==='not_triggered'?'未命中':rule.status==='not_applicable'?'不适用':rule.status==='insufficient_data'?'信息不足':rule.nature==='advisory'?'场景提示':'已命中';
  const levelLabel=rule.status==='insufficient_data'?'待核实':rule.status!=='triggered'?'':rule.nature==='prohibited'?'重点关注':rule.nature==='disclosure'?'披露需核对':'阅读提示';
  const factLabel=grade.fact_state==='sufficient'?'按当前确认信息可判定':grade.fact_state==='insufficient'?'待补充必要信息':'不在适用范围';
  return {...grade,tone,label,levelLabel,factLabel,natureLabel:natureLabels[rule.nature]};
}
