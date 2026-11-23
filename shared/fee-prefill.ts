import type { CaseExtraction, CaseFacts, Evidence, SourceMaterial } from '../src/domain.ts';

export type FeePrefill = {
  fee_id: string; field: string; value: boolean;
  treatment: 'in_period_payment' | 'deducted_from_disbursement' | 'separate_charge';
  rule_id: string; reason: string; evidence_ids: string[];
};
const clean = (s: string) => s.normalize('NFKC').replace(/\s/g, '').replace(/\d{1,3}(?:,\d{3})+(?:\.\d+)?/g, n => n.replace(/,/g, ''));
const feeName = (s: string) => clean(s).replace(/\((?:每期|每月|放款(?:日|时)一次性(?:扣费|扣除|收取)?)\)$/, '');
const path = (s: string) => s.replace(/^facts\./, '');
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const num = '(\\d+(?:\\.\\d+)?)';
const end = '(?:元|人民币|(?=[,，、;；。()（）]|$))';
const total = '(?:每期|每月)(?:还款总额|还款合计|应还总额|应还合计|扣款总额|还款额|应还本息|本息|应还|还款)(?:为|[:：])?(?:人民币)?' + num + end;
const receipt = '(?:实际到账(?:净额)?|到账净额|实收净额)(?:为|[:：])?' + num + end;
const unsafe = /如果|假设|假定|示例|例如|举例|示范|示意|仅供|不适用|拟扣除|预计到账|将扣除|可能|若|除非|仅在/;
// The browser calls this while fields are being edited, before schema parsing.
function validNumbers(facts: CaseFacts): boolean {
  const money = (n: unknown) => n === null || (typeof n === 'string' && n.length <= 80 && /^\d+(?:\.\d+)?$/.test(n));
  return [facts.loan.principal, facts.loan.disbursed, facts.loan.period_payment, facts.loan.nominal_apr,
    ...facts.fees.map(f => f.amount), ...facts.repayments.map(r => r.amount)].every(money)
    && (facts.loan.term_periods === null || (Number.isInteger(facts.loan.term_periods) && facts.loan.term_periods >= 1 && facts.loan.term_periods <= 600))
    && Number.isInteger(facts.loan.periods_per_year) && facts.loan.periods_per_year >= 1 && facts.loan.periods_per_year <= 366;
}
function decimal(s: string): [bigint, bigint] {
  const [a, b = ''] = s.split('.');
  return [BigInt(a! + b), 10n ** BigInt(b.length)];
}
function eq(a: string, b: string): boolean {
  const [x, sx] = decimal(a), [y, sy] = decimal(b); return x * sy === y * sx;
}
function sumFits(amounts: string[], principal: string, disbursed = '0', exact = false): boolean {
  const all = [principal, disbursed, ...amounts];
  const scale = 10n ** BigInt(Math.max(...all.map(s => s.split('.')[1]?.length ?? 0)));
  const ints = all.map(s => { const [n, d] = decimal(s); return n * (scale / d); });
  const sum = ints.slice(2).reduce((a, b) => a + b, 0n);
  const capacity = ints[0]! - ints[1]!;
  return exact ? sum === capacity : sum <= capacity;
}
function components(s: string): { name: string; amount: string }[] | null {
  const values = s.replace(/[)）]$/, '').split(/[,，、]|以及|及|和/);
  const rows = values.map(item => /^([^\d:：()（）]{1,80}?)(?:为|[:：])?(?:人民币)?(\d+(?:\.\d+)?)元?$/.exec(item));
  if (rows.some(row => !row)) return null;
  return rows.map(row => ({ name: row![1]!, amount: row![2]! }));
}
function contains(rows: ReturnType<typeof components>, name: string, amount: string): boolean {
  return !!rows?.some(row => row.name === name && eq(row.amount, amount));
}

type BoundFee = { value: boolean; amounts: string[]; base?: string; total?: string };
const statedTotal = '(?:每月|每期)(?:还款总额|应还总额|应还合计|合计应付|还款额|还款合计|应还|还款)(?:为|[:：])?(?:人民币)?' + num + '元';
const breakdown = new RegExp(statedTotal + '(?:\\(其中|,其中):?([^。;；)]+?)(?=[)。;；]|$)', 'g');

function boundFee(facts: CaseFacts, fee: CaseFacts['fees'][number], quote: string): BoundFee | undefined {
  if (fee.contingent !== false || fee.amount === null || unsafe.test(quote)) return;
  const name = feeName(fee.name);
  if (!name) return;
  const loan = facts.loan;
  if (fee.timing === 'upfront' && loan.principal !== null && loan.disbursed !== null) {
    const match = quote.match(new RegExp('(?:放款(?:日|时))[^。;；]{0,35}一次性收取' + escape(name) + num +
      '元,从(?:借款|贷款)?本金中(?:直接)?扣除[。，,;；](?:\\d+\\.\\d+)?(?:故)?实际到账(?:净额|金额)?[:：]?(?:人民币)?' + num + '元'));
    if (match && eq(match[1]!, fee.amount) && eq(match[2]!, loan.disbursed) &&
        sumFits([fee.amount], loan.principal, loan.disbursed, true)) return { value: true, amounts: [fee.amount] };
  }
  if (fee.timing !== 'per_period' || facts.repayments.length || loan.repay_method !== 'equal_installment' || loan.period_payment === null) return;
  // A table or clause can state the total with the fee inside parentheses:
  // "每期还款人民币1120元（含每期服务费120元）". The named amount must match,
  // the total must equal the selected payment, and the fee must fit inside it.
  const inclusive = new RegExp(total + '(?:[（(])(?:其中|内含)?(?:已)?(?:包含|包括|含)' +
    '(?:每期|每月)?' + escape(name) + num + '元[）)]', 'g');
  for (const match of quote.matchAll(inclusive)) {
    if (eq(match[1]!, loan.period_payment) && eq(match[2]!, fee.amount) &&
        sumFits([fee.amount], loan.period_payment)) return { value: true, amounts: [fee.amount], total: match[1] };
  }
  // A schedule note can decompose the payment with an equation:
  // "每期还款1120元=本金1000元+服务费120元". Every named component must parse,
  // the sum must equal both the stated total and the selected payment exactly.
  const equation = new RegExp(total + '[=＝]([^。;；)）]+)', 'g');
  for (const match of quote.matchAll(equation)) {
    const rows = components(match[2]!.replace(/\+/g, '、'));
    if (!rows || rows.filter(row => row.name === name).length !== 1 || !contains(rows, name, fee.amount)) continue;
    if (!sumFits(rows.map(row => row.amount), match[1]!, '0', true)) continue;
    if (eq(match[1]!, loan.period_payment)) return { value: true, amounts: rows.map(row => row.amount), total: match[1] };
  }
  for (const match of quote.matchAll(breakdown)) {
    const content = match[2]!.replace(/(?:^|[+、,])(?:每期|每月)(?:偿还|支付|应还)?/g, separator => separator.replace(/[^+、,]/g, ''));
    const rows = components(content.replace(/\+/g, '、'));
    if (!rows || rows.filter(row => row.name === name).length !== 1 || !contains(rows, name, fee.amount)) continue;
    if (!sumFits(rows.map(row => row.amount), match[1]!, '0', true)) continue;
    const base = rows.filter(row => /^(?:借款|贷款)?(?:本息|本金)$/.test(row.name));
    if (eq(match[1]!, loan.period_payment)) return { value: true, amounts: rows.map(row => row.amount), base: base.length === 1 ? base[0]!.amount : undefined, total: match[1] };
    if (base.length === 1 && eq(base[0]!.amount, loan.period_payment)) return { value: false, amounts: [fee.amount], base: base[0]!.amount, total: match[1] };
  }
}

function excludedFromBase(name: string, amount: string): RegExp {
  return new RegExp(
    '(?:除(?:每期)?(?:应还)?贷款本息外[^。;；]{0,65}(?:另行|另外|额外|另)(?:收取|扣收|支付|收|付|计费)' +
    escape(name) + amount + '元|' + escape(name) + '不(?:包含|计入)在每期应还贷款本息之内)', 'g');
}

export function resolveFeeBreakdownConflicts(output: CaseExtraction): void {
  const { facts, evidence } = output;
  if (!validNumbers(facts)) return;
  output.conflicts = output.conflicts.filter(conflict => {
    const match = path(conflict.field).match(/^fees\[(\d+)\]\.included_in_cashflows$/);
    const fee = match ? facts.fees[Number(match[1])] : undefined;
    if (!fee || fee.timing !== 'per_period' || fee.amount === null) return true;
    const name = feeName(fee.name);
    const linked = conflict.evidence_ids.map(id => evidence.find(item => item.id === id));
    if (linked.length < 2 || linked.some(item => !item)) return true;
    const quotes = linked.map(item => clean(item!.quote));
    const proof = quotes.map(quote => boundFee(facts, fee, quote)).find(item => item?.base && item.total && !eq(item.base, item.total));
    if (!proof || !quotes.some(quote => excludedFromBase(name, num).test(quote))) return true;
    return quotes.some(quote => {
      const ownProof = boundFee(facts, fee, quote);
      if (ownProof?.base && ownProof.total) return !eq(ownProof.base, proof.base!) || !eq(ownProof.total, proof.total!);
      if (unsafe.test(quote)) return true;
      const baseStatement = [...quote.matchAll(excludedFromBase(name, num))].find(item => !item[1] || eq(item[1]!, fee.amount!));
      if (baseStatement) return /不(?:包含|计入)|另(?:收|付|支付)/.test(quote.replace(baseStatement[0], ''));
      // A table's named, per-period fee row may repeat that the fee is included.
      const repeated = quote.match(new RegExp('^每期费用\\(' + escape(name) + '\\)' + num + '元/期[^。]{0,125}已计入每期还款现金流'));
      return !repeated || !eq(repeated[1]!, fee.amount!);
    });
  });
}

/** Keep the exact clauses when the model quotes only part of a fee breakdown. */
export function addFeeBreakdownEvidence(output: CaseExtraction, materials: SourceMaterial[]): void {
  if (!validNumbers(output.facts)) return;
  for (const [index, fee] of output.facts.fees.entries()) {
    if (fee.contingent !== false || fee.amount === null || !['upfront', 'per_period'].includes(fee.timing)) continue;
    const field = `fees[${index}].included_in_cashflows`;
    const seen = new Set(output.evidence.filter(item => path(item.field) === field).map(item => clean(item.quote)));
    for (const material of materials) for (const page of material.pages) {
      const raw = page.text.split('\n');
      const labelOnly = /^[\s*【】\[\]]*(?:每期|每月)(?:还款|应还)(?:总额|合计|额)?\s*[:：]?\s*$/;
      for (let n = 0; n < raw.length; n++) {
        if (!/每期|每月|放款/.test(raw[n]!)) continue;
        // PDF tables put a row label and its value on separate lines. A
        // standalone label may borrow the following value line so the joined
        // span itself is the exact source quote; windows never cross it twice.
        const borrow = labelOnly.test(raw[n]!) && n + 1 < raw.length && /\d/.test(raw[n + 1]!) ? 1 : 0;
        for (let length = 1 + borrow; length <= 3 + borrow; length++) {
          const quote = raw.slice(n, n + length).join('\n').trim();
          const compact = clean(quote);
          if (quote.length > 600 || !boundFee(output.facts, fee, compact)) continue;
          if (!seen.has(compact)) {
            let id = `bound-fee-${index}-${output.evidence.length}`;
            while (output.evidence.some(existing => existing.id === id)) id += '-source';
            output.evidence.push({ id, field, quote, document_id: material.id, page: page.page,
              source_type: material.vision ? 'vision_transcript' : 'text' });
            seen.add(compact);
          }
          break;
        }
      }
    }
  }
}
// Every quotation assigned to an A1 numeric field must bind the selected
// value to that field's meaning. An unrelated matching number is no support.
function boundNumberEvidence(evidence: Evidence[], field: string, amount: string, expression: string): Evidence[] {
  const matches = evidence.filter(e => path(e.field) === field);
  return matches.length && matches.every(e => {
    const values = [...clean(e.quote).matchAll(new RegExp(expression, 'g'))];
    return values.length > 0 && values.every(m => eq(m[1]!, amount));
  }) ? matches : [];
}

function affirmativeEvidence(evidence: Evidence[], field: string, expression: RegExp): Evidence[] {
  const rows = evidence.filter(e => path(e.field) === field);
  return rows.every(e => expression.test(clean(e.quote))) ? rows : [];
}

// This is an independent annuity calculation, never a schedule generated from
// the selected payment. Rational arithmetic rounds the result once, to cents.
function annuityCents(principal: string, apr: string, periods: number, ppy: number): bigint | null {
  if (apr.length > 18 || principal.length > 18 || periods > 600) return null;
  const [p, ps] = decimal(principal), [a, as] = decimal(apr), b = as * BigInt(ppy);
  let numerator: bigint, denominator: bigint;
  if (a === 0n) { numerator = p * 100n; denominator = ps * BigInt(periods); }
  else {
    const power = (a + b) ** BigInt(periods);
    numerator = p * a * power * 100n;
    denominator = ps * b * (power - b ** BigInt(periods));
  }
  return (2n * numerator + denominator) / (2n * denominator);
}
function arithmeticEvidence(facts: CaseFacts, evidence: Evidence[]): Evidence[] | null {
  const l = facts.loan;
  if (facts.repayments.length || l.repay_method !== 'equal_installment' || l.periods_per_year !== 12 ||
      l.principal === null || l.nominal_apr === null || l.period_payment === null || l.term_periods === null) return null;
  const related = evidence.filter(e => path(e.field).startsWith('loan.'));
  // A1 is deliberately narrower than contractual calculation. Any negation,
  // exception or nonstandard rate context defeats this optional inference.
  if (related.some(e => /不|未|非|禁止|不得|无须|无需|逾期|罚息|违约|综合|按季|季度|年度|半年|贴息|补贴|折扣|打折|减免|优惠|宽限|尾款|尾期|末期调整|等额本金|先息后本|到期一次|按年|不等额|按日|免息期|砍头息|平息|日利率|提前|返还|抵扣|(?:非|不是|并非|不采用|不按|不适用|不以).{0,6}(?:等额本息|月利率|年利率)|有效年利率|实际年利率|综合年利率/.test(clean(e.quote)) || unsafe.test(clean(e.quote)))) return null;
  const groups = [boundNumberEvidence(evidence, 'loan.principal', l.principal,
      '(?:借款|贷款)?本金(?:金额)?(?:为|[:：])?' + num + end),
    boundNumberEvidence(evidence, 'loan.period_payment', l.period_payment, total),
    boundNumberEvidence(evidence, 'loan.term_periods', String(l.term_periods),
      '(?:共|总计|合计|(?:借款|贷款)?期限(?:为|[:：])?|分期(?:为|[:：])?|^)' + num + '(?:期|个月)'),
    affirmativeEvidence(evidence, 'loan.periods_per_year', /按月还款|每月还款|月度还款|每年12期|还款周期(?:为|[:：])?月/),
    affirmativeEvidence(evidence, 'loan.repay_method', /(?:采用|还款方式(?:为|[:：])?|^)等额本息(?:还款|方式|法|$|[，,。；;])/),
    evidence.filter(e => path(e.field) === 'loan.nominal_apr')];
  if (groups[3]!.some(e => /每年(?!12期)\d+期|每周|按周|每季|按季|按年|每两个月/.test(clean(e.quote)))) return null;
  const rates = groups[5]!;
  if (rates.some(e => {
    const matches = [...clean(e.quote).matchAll(/(月利率|年利率|名义年利率)(?:为|[:：])?(\d+(?:\.\d+)?)%/g)];
    return !matches.length || matches.some(m => {
      const [n, scale] = decimal(m[2]!), [a, as] = decimal(l.nominal_apr!);
      return n * BigInt(m[1] === '月利率' ? 12 : 1) * as !== a * scale * 100n;
    });
  })) return null;
  if (groups.some(g => !g.length)) return null;
  const expected = annuityCents(l.principal, l.nominal_apr, l.term_periods, l.periods_per_year);
  const [payment, scale] = decimal(l.period_payment);
  if (expected === null || expected * scale !== payment * 100n) return null;
  return groups.flat();
}

/** Suggestions are relative to the selected amounts. Never mutates facts.
 * Evidence must already have passed the extraction's source-quotation checks.
 * Callers retain control over user edits and whether suggestions are applied.
 */
export function inferFeePrefills(facts: CaseFacts, evidence: Evidence[], conflicts: CaseExtraction['conflicts'], sourceFacts: CaseFacts = facts): FeePrefill[] {
  const results: FeePrefill[] = [];
  if (!validNumbers(facts)) return results;
  const arithmetic = arithmeticEvidence(facts, evidence);
  for (const [index, fee] of facts.fees.entries()) {
    if (fee.contingent !== false || fee.amount === null || !['upfront', 'per_period'].includes(fee.timing)) continue;
    const oldIndex = sourceFacts.fees.findIndex(f => f.id === fee.id);
    if (oldIndex < 0 || facts.fees.filter(f => f.id === fee.id).length !== 1 || sourceFacts.fees.filter(f => f.id === fee.id).length !== 1) continue;
    const name = feeName(fee.name), old = sourceFacts.fees[oldIndex]!;
    const sameTimingAndName = (other: CaseFacts['fees'][number]) => other.timing === fee.timing && feeName(other.name) === name;
    if (!name || !sameTimingAndName(old) || facts.fees.filter(sameTimingAndName).length !== 1 ||
        sourceFacts.fees.filter(sameTimingAndName).length !== 1) continue;
    const prefix = `fees[${oldIndex}]`, affected = [prefix, 'loan', 'repayments'];
    if (conflicts.some(c => affected.some(a => path(c.field) === a || path(c.field).startsWith(a + '.') || path(c.field).startsWith(a + '[') || a.startsWith(path(c.field) + '[')))) continue;
    const loanFields = fee.timing === 'upfront' ? ['loan.disbursed', 'loan.principal'] : ['loan.period_payment'];
    // Contingent-cost disclosure statements ("不含逾期罚息等或有成本") concern
    // other charges, not this confirmed normal fee's inclusion; they must not
    // veto its verified bindings.
    const relevant = evidence.filter(e => (path(e.field).startsWith(prefix + '.') && path(e.field) !== prefix + '.contingent') ||
      (loanFields.includes(path(e.field)) && clean(e.quote).includes(name)));
    if (!relevant.length || relevant.some(e => unsafe.test(clean(e.quote)))) continue;
    const positive: { e: Evidence; amounts: string[] }[] = [], negative: Evidence[] = [];
    let contradictory = false, unboundSeparate = false;
    const selected = fee.timing === 'upfront' ? facts.loan.disbursed : facts.loan.period_payment;
    if (selected === null || (fee.timing === 'per_period' && (facts.repayments.length || facts.loan.repay_method !== 'equal_installment'))) continue;
    const bindings = new Map(relevant.map(e => [e.id, boundFee(facts, fee, clean(e.quote))]));
    const boundTotals = [...bindings.values()].flatMap(binding => [binding?.base, binding?.total].filter(x => x !== undefined));
    const feeToken = escape(name) + '(?:为|[:：])?' + num + '元';
    for (const e of relevant) {
      const quote = clean(e.quote);
      const binding = bindings.get(e.id);
      if (binding?.value === true) positive.push({ e, amounts: binding.amounts });
      if (binding?.value === false) negative.push(e);
      // A second, named statement of separate collection can contradict an
      // inclusion even without repeating the selected total. It never alone
      // establishes a false suggestion relative to that total.
      const looseFee = escape(name) + '(?:(?:为|[:：])?' + num + '元)?';
      const collection = '(?:另行|另外|额外|单独|另)(?:收取|扣收|支付|收|付|计费)';
      const baseExclusion = excludedFromBase(name, '(?:为|[:：])?' + num);
      const otherStatements = boundTotals.length ? quote.replace(baseExclusion, '') : quote;
      const separateFromBase = otherStatements !== quote;
      if (new RegExp(looseFee + '(?:[,，])?(?:需|须|应)?' + collection).test(otherStatements) ||
          new RegExp(collection + looseFee).test(otherStatements)) unboundSeparate = true;
      const waiver = '(?:免收|免除|减免|取消|不收取|(?:无需|无须|不必)(?:支付|缴纳|收取))';
      if (new RegExp(looseFee + '(?:已|予以)?' + waiver).test(quote) || new RegExp(waiver + looseFee).test(quote)) contradictory = true;
      // Only a negation explicitly binding the named fee to the selected total
      // establishes exclusion; generic negations remain blockers.
      const reverseExclusion = fee.timing === 'per_period' && [...quote.matchAll(new RegExp(
        '(?:^|[,，。；;])' + feeToken + '(?:未|不)(?:包含|计入|纳入)在?' + total + '(?:中|内)?', 'g'))]
        .some(m => eq(m[1]!, fee.amount!) && eq(m[2]!, selected));
      const forwardExclusion = fee.timing === 'per_period' && [...quote.matchAll(new RegExp(
        total + '[,，](?:其中)?(?:不|未)(?:包含|包括|含)([^。；;]+)', 'g'))]
        .some(m => eq(m[1]!, selected) && contains(components(m[2]!), name, fee.amount!));
      const explicitExclusion = reverseExclusion || forwardExclusion;
      if (explicitExclusion) negative.push(e);
      if (!explicitExclusion && /(?:不|未|尚未|并未|没有|并非|不是)[^。；;]{0,20}(?:包含|包括|含|扣除|扣减|计入|纳入)/.test(otherStatements)) contradictory = true;
      const totals = [...quote.matchAll(new RegExp(fee.timing === 'upfront' ? receipt : total, 'g'))];
      const canMentionBaseAndTotal = binding || separateFromBase || path(e.field) === 'loan.period_payment';
      if (totals.some(match => !eq(match[1]!, selected) && (!canMentionBaseAndTotal || !boundTotals.some(value => eq(value, match[1]!))))) {
        contradictory = true;
        continue;
      }
      if (fee.timing === 'per_period') {
        for (const m of quote.matchAll(new RegExp(total + '(?:[,，(（])?(?:其中)?(?:已)?(?:包含|包括|含)([^。；;]+)', 'g'))) {
          const rows = components(m[2]!);
          if (eq(m[1]!, selected) && contains(rows, name, fee.amount)) positive.push({ e, amounts: rows!.map(r => r.amount) });
        }
        for (const m of quote.matchAll(new RegExp('(?:^|[,，。；;])' + feeToken + '(?:已)?(?:包含|包括|计入|纳入)在?' + total + '(?:中|内)', 'g'))) {
          if (eq(m[1]!, fee.amount) && eq(m[2]!, selected)) positive.push({ e, amounts: [fee.amount] });
        }
        // A same-paragraph back-reference must bind a named amount to the
        // immediately preceding selected total, not some earlier loan figure.
        for (const m of quote.matchAll(new RegExp(total + '[,，。；;]' + feeToken + '(?:已)?(?:计入|纳入|包含在)上述还款(?:总)?额(?:中|内)?', 'g'))) {
          if (eq(m[1]!, selected) && eq(m[2]!, fee.amount)) positive.push({ e, amounts: [fee.amount] });
        }
        // An explicit total/base and an additional named component must occur
        // together. Merely using another collection channel is insufficient.
        for (const m of quote.matchAll(new RegExp(total + '[,，;；](?:在(?:该|上述)金额之外[,，]?)?(?:另行|另外|额外|另)(?:收取|扣收|支付|收|加)([^。；;]+)', 'g'))) {
          if (eq(m[1]!, selected) && contains(components(m[2]!), name, fee.amount)) negative.push(e);
        }
      } else {
        for (const m of quote.matchAll(new RegExp('(?:已)?(?:扣除|扣减)([^。；;]+?)(?:后[,，]?|[,，])' + receipt, 'g'))) {
          const rows = components(m[1]!);
          if (eq(m[2]!, selected) && contains(rows, name, fee.amount)) positive.push({ e, amounts: rows!.map(r => r.amount) });
        }
        for (const m of quote.matchAll(new RegExp(receipt + '[,，(（](?:其中)?已(?:扣除|扣减)([^。；;]+)', 'g'))) {
          const rows = components(m[2]!);
          if (eq(m[1]!, selected) && contains(rows, name, fee.amount)) positive.push({ e, amounts: rows!.map(r => r.amount) });
        }
        for (const m of quote.matchAll(new RegExp(receipt + '[,，;；](?:放款后)?(?:由借款人)?(?:另行|另外|额外)(?:支付|收取|扣收)([^。；;]+)', 'g'))) {
          if (eq(m[1]!, selected) && contains(components(m[2]!), name, fee.amount)) negative.push(e);
        }
      }
    }
    if (contradictory || (positive.length && (negative.length || unboundSeparate))) continue;
    const isUpfront = fee.timing === 'upfront';
    let value: boolean, rule: string, reason: string, used: Evidence[];
    if (positive.length) {
      if (!isUpfront && arithmetic && !eq(fee.amount, '0')) continue;
      if (isUpfront && facts.loan.principal === null) continue;
      const valid = positive.filter(p => sumFits(p.amounts, isUpfront ? facts.loan.principal! : selected, isUpfront ? selected : '0'));
      if (valid.length !== positive.length) continue;
      value = true; rule = isUpfront ? 'U_NET_NAMED' : 'P_TOTAL_NAMED'; used = valid.map(p => p.e);
      reason = isUpfront ? `原文明示扣除此项后实际到账${selected}元，与所填净到账一致。` : `原文明示每期还款${selected}元已包含此项费用，名称及金额一致。`;
    } else if (negative.length) {
      value = false; rule = isUpfront ? 'U_SEPARATE_NAMED' : 'N_SEPARATE_NAMED'; used = negative;
      reason = `原文明示此项费用在所填${isUpfront ? '到账' : '每期还款'}${selected}元之外另行支付。`;
    } else if (!isUpfront && arithmetic && relevant.some(e => {
      const quote = clean(e.quote);
      return /每期|每月|按月/.test(quote) && [...quote.matchAll(new RegExp(feeToken, 'g'))].some(m => eq(m[1]!, fee.amount!));
    }) && !relevant.some(e => /含|包括|计入|纳入|不收|免收|免除|减免|减收|补贴|返还|抵扣|折扣|优惠|取消|无需|无须|逾期|罚息|违约/.test(clean(e.quote))) && !eq(fee.amount, '0')) {
      value = false; rule = 'A1_VERIFIED_ANNUITY'; used = [...arithmetic, ...relevant];
      reason = `独立核对本金、月度等额本息方式、期数及利率，按分取整的本息为${selected}元，与所填还款额相同；原文另列此项每期费用。`;
    } else continue;
    results.push({ fee_id: fee.id, field: `fees[${index}].included_in_cashflows`, value,
      treatment: value ? isUpfront ? 'deducted_from_disbursement' : 'in_period_payment' : 'separate_charge',
      rule_id: rule, reason, evidence_ids: [...new Set(used.map(e => e.id))] });
  }
  // Independent assertions must also fit together, including existing confirmed
  // inclusions. Never accept several individually plausible but impossible sums.
  const included = facts.fees.filter(f => f.contingent === false && f.amount !== null &&
    (results.find(r => r.fee_id === f.id)?.value ?? f.included_in_cashflows) === true);
  const bad = new Set<string>();
  for (const timing of ['upfront', 'per_period']) {
    const amounts = included.filter(f => f.timing === timing).map(f => f.amount!);
    const limit = timing === 'upfront' ? facts.loan.principal : facts.loan.period_payment;
    const deduction = timing === 'upfront' ? facts.loan.disbursed : '0';
    if (limit !== null && deduction !== null && !sumFits(amounts, limit, deduction)) bad.add(timing);
  }
  return results.filter(r => !r.value || !bad.has(facts.fees.find(f => f.id === r.fee_id)!.timing));
}
