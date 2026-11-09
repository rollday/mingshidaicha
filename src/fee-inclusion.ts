import type { CaseExtraction } from './domain.ts';

const fieldPath = (field: string) => field.replace(/^facts\./, '');
const compact = (value: string) => value.normalize('NFKC').replace(/\s/g, '')
  .replace(/\d{1,3}(?:,\d{3})+(?:\.\d+)?/g, amount => amount.replace(/,/g, ''));
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const numeric = '(\\d+(?:\\.\\d+)?)';
const moneyEnd = '(?:元|人民币|(?=[，,、；;。()（）]|$))';
const recurringTotal = '(?:每期|每月)(?:还款总额|还款合计|应还总额|应还合计|扣款总额|还款额)(?:为|[:：])?' + numeric + moneyEnd;
const netReceipt = '(?:实际到账(?:净额)?|到账净额|实收净额)(?:为|[:：])?' + numeric + moneyEnd;

// All comparisons use decimal integers, including sub-cent source amounts.
function integers(values: string[]): bigint[] {
  const scale = Math.max(...values.map(value => value.split('.')[1]?.length ?? 0));
  return values.map(value => {
    const [whole, fraction = ''] = value.split('.');
    return BigInt(whole! + fraction.padEnd(scale, '0'));
  });
}
function equal(left: string, right: string): boolean {
  const [a, b] = integers([left, right]);
  return a === b;
}
function within(values: string[], upper: string, subtract = '0'): boolean {
  const [limit, deduction, ...amounts] = integers([upper, subtract, ...values]);
  return amounts.reduce((sum, amount) => sum + amount, 0n) <= limit! - deduction!;
}

function namedAmount(text: string, name: string, amount: string): boolean {
  // Only read the initial fee list. Later prose containing the same amount is
  // not evidence that the named fee is a component of the selected total.
  const items = text.replace(/[)）]$/, '').split(/[，,、]|以及|及|和/);
  const component = /^([^\d:：()（）]{1,80})(?:为|[:：])?(\d+(?:\.\d+)?)元?$/;
  if (!items.every(item => component.test(item))) return false;
  return items.some(item => {
    const match = component.exec(item)!;
    return match[1] === name && equal(match[2]!, amount);
  });
}

function supportsRecurring(quote: string, name: string, amount: string, payment: string): boolean {
  const total = recurringTotal;
  const forward = new RegExp(total + '(?:[，,（(])?(?:其中)?(?:已)?(?:包含|包括|含)([^。；;]+)', 'g');
  if ([...quote.matchAll(forward)].some(match => equal(match[1]!, payment) && namedAmount(match[2]!, name, amount))) return true;
  const reverse = new RegExp('(?:^|[，,。；;])' + escape(name) + '(?:为|[:：])?' + numeric
    + '元(?:已)?(?:包含|包括|计入|纳入)在?' + total + '(?:中|内)', 'g');
  return [...quote.matchAll(reverse)].some(match => equal(match[1]!, amount) && equal(match[2]!, payment));
}

function supportsUpfront(quote: string, name: string, amount: string, disbursed: string): boolean {
  const receipt = netReceipt;
  const forward = new RegExp('(?:已)?(?:扣除|扣减)([^。；;]+?)(?:后[，,]?|[，,])' + receipt, 'g');
  if ([...quote.matchAll(forward)].some(match => equal(match[2]!, disbursed) && namedAmount(match[1]!, name, amount))) return true;
  const reverse = new RegExp(receipt + '[，,（(](?:其中)?已(?:扣除|扣减)([^。；;]+)', 'g');
  return [...quote.matchAll(reverse)].some(match => equal(match[1]!, disbursed) && namedAmount(match[2]!, name, amount));
}

/** Validate model assertions only. Explicit user confirmations bypass this guard. */
export function guardFeeInclusion(output: CaseExtraction): void {
  const { loan, fees, repayments } = output.facts;
  const initiallyIncluded = fees.filter(fee => fee.included_in_cashflows === true && fee.contingent !== true);
  const upfront = initiallyIncluded.filter(fee => fee.timing === 'upfront');
  const recurring = initiallyIncluded.filter(fee => fee.timing === 'per_period');
  const known = (group: typeof fees) => group.every(fee => fee.amount !== null);
  const upfrontFits = loan.principal !== null && loan.disbursed !== null && known(upfront)
    && within(upfront.map(fee => fee.amount!), loan.principal, loan.disbursed);
  const recurringFits = loan.period_payment !== null && known(recurring)
    && within(recurring.map(fee => fee.amount!), loan.period_payment);

  for (const [index, fee] of fees.entries()) {
    if (fee.included_in_cashflows !== true || fee.contingent === true) continue;
    const path = `fees[${index}].included_in_cashflows`;
    const name = compact(fee.name);
    const evidence = output.evidence.filter(item => fieldPath(item.field) === path).map(item => compact(item.quote));
    const ambiguousName = !name || fees.filter(other => compact(other.name) === name).length !== 1;
    const relevantFields = [path, `fees[${index}].amount`, 'loan.principal', 'loan.disbursed', 'loan.period_payment', 'repayments'];
    const conflict = output.conflicts.some(item => {
      const field = fieldPath(item.field);
      return relevantFields.some(relevant => relevant === field || relevant.startsWith(field + '.') || relevant.startsWith(field + '['));
    });
    // A contradictory quotation cannot be rescued by another positive quotation.
    const negative = evidence.some(quote => /(?:不|未|尚未|并未|没有|并非|不是)[^。；;]{0,20}(?:包含|包括|含|扣除|扣减|计入|纳入)|另(?:收|付|计)|额外|如果|假设|假定|示例|例如|举例|示范|示意|仅供|不适用|拟扣除|预计到账|将扣除|可能/.test(quote));
    // Do not cherry-pick a matching total while ignoring a different total in
    // the same supporting quote or another quote for this inclusion assertion.
    const selected = fee.timing === 'upfront' ? loan.disbursed : loan.period_payment;
    const totals = fee.timing === 'upfront' ? netReceipt : recurringTotal;
    const mismatchedTotal = selected !== null && evidence.some(quote =>
      [...quote.matchAll(new RegExp(totals, 'g'))].some(match => !equal(match[1]!, selected)));
    const valid = !ambiguousName && !conflict && !negative && !mismatchedTotal && fee.amount !== null && evidence.some(quote => {
      if (fee.timing === 'upfront' && upfrontFits) return supportsUpfront(quote, name, fee.amount!, loan.disbursed!);
      // A period_payment cannot establish inclusion in an explicit or varying schedule.
      if (fee.timing === 'per_period' && recurringFits && repayments.length === 0 && loan.repay_method === 'equal_installment') {
        return supportsRecurring(quote, name, fee.amount!, loan.period_payment!);
      }
      return false;
    });
    if (valid) continue;
    fee.included_in_cashflows = null;
    if (!output.questions.some(question => fieldPath(question.field) === path)) output.questions.push({ field: path,
      question: fee.timing === 'upfront'
        ? `请确认“${fee.name}”是否已从所填实际到账金额中扣除，并核对扣费后的净到账金额；不能仅凭同日收费判断。`
        : `请确认所填每期还款额是否已经包含“${fee.name}”；一并扣划不代表金额已经包含，请核对含费还款总额。` });
  }
}
