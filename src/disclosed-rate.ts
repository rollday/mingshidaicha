import type { CaseExtraction, CaseFacts, Evidence, SourceMaterial } from './domain.ts';

type Method = CaseFacts['disclosure']['quoted_method'];
type Rate = { value: string; method: Method; quote: string };
type RateSource = Rate & { material: SourceMaterial; page: number };

const annualTotal = /^(?:借款)?(?:正常履约)?(?:年化综合(?:融资|资金)成本(?:率)?|综合(?:融资|资金)成本\s*(?:[（(]?年化(?:利率)?[）)]?|率)|(?:明示|披露)(?:综合融资成本)?年化(?:利率)?)\s*[:：]?\s*(?:\((名义|复利|单利|XIRR)\)\s*)?(\d{1,6}(?:\.\d{1,18})?)\s*%(.*)$/i;
const englishTotal = /^disclosed\s+(?:(nominal|effective|simple|xirr)\s+)?annual\s+total\s+financing\s+cost\s*:\s*(\d{1,6}(?:\.\d{1,18})?)\s*%(.*)$/i;
const annual = /^(?:贷款利息\s*)?年化(?:利率)?\s*[:：]?\s*(?:\((名义|复利|单利|XIRR)\)\s*)?(\d{1,6}(?:\.\d{1,18})?)\s*%(.*)$/i;
const tableTitle = /^\s*(?:个人(?:消费)?贷款)?综合(?:融资|资金)成本明示表\s*$/m;
const rateFields = new Set(['disclosure.quoted_apr', 'disclosure.quoted_method']);

function canonicalMethod(label: string): Method {
  if (/^(?:nominal|名义)/i.test(label)) return 'nominal';
  if (/^(?:effective|复利|有效年化)/i.test(label)) return 'effective';
  if (/^(?:simple|单利)/i.test(label)) return 'simple';
  if (/^(?:xirr|按实际日期年化)/i.test(label)) return 'xirr';
  return 'unknown';
}

function monthlyPair(annual: string, monthly: string): boolean {
  const parts = [annual, monthly].map(value => value.split('.'));
  const precision = Math.max(...parts.map(([, fraction]) => fraction?.length ?? 0));
  const scale = ([whole, fraction = '']: string[]) => ({
    value: BigInt(whole! + fraction.padEnd(precision, '0')),
    unit: 10n ** BigInt(precision - fraction.length),
  });
  const a = scale(parts[0]!), m = scale(parts[1]!);
  if (!a.value || !m.value) return false; // A pair of zeros establishes no conversion convention.
  const difference = a.value - 12n * m.value;
  return 2n * (difference < 0n ? -difference : difference) <= a.unit + 12n * m.unit;
}

function parseRate(quote: string, patterns: RegExp[]): Rate | null {
  const clean = quote.normalize('NFKC').replace(/[*【】\[\]]/g, '').replace(/\s+/g, ' ').trim();
  const match = patterns.map(pattern => clean.match(pattern)).find(Boolean);
  if (!match) return null;
  const [, before = '', percent = '', trailing = ''] = match;
  const after = trailing.match(/^\s*[,、(（]?\s*(?:按)?(名义|复利|有效年化|单利|XIRR|按实际日期年化)/i)?.[1]
    ?? trailing.match(/^\s*[（(][^）)]*[,，、;；]\s*(名义|复利|有效年化|单利|XIRR)(?:口径|计息|年化)?[^）)]*[）)]/i)?.[1] ?? '';
  const stated = canonicalMethod(before || after);
  const monthly = trailing.match(/^\s*\(\s*月利率\s*[:：]?\s*(\d{1,6}(?:\.\d{1,18})?)\s*%\s*\)/)?.[1];
  const [whole, fraction = ''] = percent.split('.');
  const decimals = fraction.length + 2;
  const digits = BigInt(whole! + fraction).toString().padStart(decimals + 1, '0');
  const tail = digits.slice(-decimals).replace(/0+$/, '');
  return {
    value: digits.slice(0, -decimals) + (tail ? '.' + tail : ''),
    method: stated === 'unknown' && monthly && monthlyPair(percent, monthly) ? 'nominal' : stated,
    quote,
  };
}

// PDF tables split a label and its value across lines. Join a standalone rate
// line to the label line above it, keeping the exact source span as the quote.
function rateLines(pageText: string): { text: string; start: number }[] {
  const lines = pageText.split('\n').map(line => line.replace(/\r$/, ''));
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) { starts.push(offset); offset += line.length + 1; }
  const labelOnly = /^[\s*【】\[】]*(?:借款)?(?:正常履约)?(?:年化综合(?:融资|资金)成本(?:率)?|综合(?:融资|资金)成本\s*(?:[（(]?年化(?:利率)?[）)]?|率)|(?:明示|披露)(?:综合融资成本)?年化(?:利率)?)\s*[:：]?\s*$/i;
  const rateLine = /^\s*\d{1,6}(?:\.\d{1,18})?\s*%/;
  const out: { text: string; start: number }[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    out.push({ text: line, start: starts[index]! });
    if (index + 1 < lines.length && labelOnly.test(line.normalize('NFKC')) && rateLine.test(lines[index + 1]!)) {
      out.push({ text: line + '\n' + lines[index + 1], start: starts[index]! });
    }
  }
  return out;
}

/** Use source lines for an aggregate APR and its method, even if the model omitted them. */
export function groundDisclosedRate(extraction: CaseExtraction, materials: SourceMaterial[]): void {
  const totals: RateSource[] = [], interestOnly: RateSource[] = [];
  const potentialNormalFees = extraction.facts.fees.some(fee => fee.contingent !== true && !/^0+(?:\.0+)?$/.test(fee.amount ?? ''));
  for (const material of materials) {
    for (const page of material.pages) {
      for (const line of rateLines(page.text)) {
        const total = parseRate(line.text, [annualTotal, englishTotal]);
        if (total) totals.push({ ...total, material, page: page.page });
      }
      if (potentialNormalFees || !tableTitle.test(page.text)) continue;
      const none = /^(?:其他息费|其他费用)\s*\n\s*无\s*$/m.test(page.text);
      const singleMaturity = /到期日?一次性偿还本金[^。]{0,130}及利息[^。]{0,85}合计/.test(page.text) &&
        !/^(?:其他息费|其他费用|[^\n]*服务费|[^\n]*担保费|[^\n]*扣费)\s*$/m.test(page.text);
      if (!none && !singleMaturity) continue;
      const row = page.text.match(/^贷款利息[^\S\n]*\n[^\n]+/m)?.[0];
      const rate = row && parseRate(row, [annual]);
      if (rate) interestOnly.push({ ...rate, material, page: page.page });
    }
  }

  // A verified model quotation may join a label and value split by a PDF line break.
  for (const item of extraction.evidence.filter(item => rateFields.has(item.field))) {
    const material = materials.find(source => source.id === item.document_id);
    if (!material || item.page === null) continue;
    const rate = parseRate(item.quote, [annualTotal, englishTotal]);
    if (rate) totals.push({ ...rate, material, page: item.page });
  }
  const candidates = totals.length ? totals : interestOnly;
  const values = new Set(candidates.map(item => item.value));
  const methods = new Set(candidates.map(item => item.method).filter(method => method !== 'unknown'));
  const quote = values.size === 1 ? candidates[0] : undefined;
  const method: Method = quote && methods.size === 1 ? [...methods][0]! : 'unknown';
  const hadRate = extraction.facts.disclosure.quoted_apr !== null;
  extraction.facts.disclosure.quoted_apr = quote?.value ?? null;
  extraction.facts.disclosure.quoted_method = method;
  const removed = new Set(extraction.evidence.filter(item => rateFields.has(item.field)).map(item => item.id));
  extraction.evidence = extraction.evidence.filter(item => !removed.has(item.id));
  for (const conflict of extraction.conflicts) conflict.evidence_ids = conflict.evidence_ids.filter(id => !removed.has(id));
  const addEvidence = (field: string, item: RateSource) => {
    let id = 'disclosed-rate-' + (field.endsWith('method') ? 'method' : 'value');
    while (extraction.evidence.some(existing => existing.id === id)) id += '-source';
    const evidence: Evidence = { id, field, document_id: item.material.id, page: item.page, quote: item.quote };
    if (item.material.vision) evidence.source_type = 'vision_transcript';
    extraction.evidence.push(evidence);
  };
  if (quote) {
    addEvidence('disclosure.quoted_apr', quote);
    const methodSource = candidates.find(item => item.method === method);
    if (method !== 'unknown' && methodSource) addEvidence('disclosure.quoted_method', methodSource);
  }
  if (values.size > 1 || (!quote && hadRate)) {
    extraction.questions.push({ field: 'disclosure.quoted_apr', question: '请核对材料中披露的综合融资成本年化及其适用范围。' });
  }
  if (quote && method === 'unknown' && !extraction.questions.some(question => question.field === 'disclosure.quoted_method')) {
    extraction.questions.push({ field: 'disclosure.quoted_method', question: '材料中的这项年化采用什么计算口径？' });
  }
}
