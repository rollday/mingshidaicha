/** Money and rates never pass through Number, including during display rounding. */
export function decimal(value: string | null | undefined, places = 2, shift = 0): string {
  if (value === null || value === undefined || !/^-?\d+(?:\.\d+)?$/.test(value)) return '—';
  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = value.replace(/^-/, '').split('.');
  const position = whole.length + shift;
  const expanded = (whole + fraction).padEnd(position + places + 1, '0');
  let scaled = BigInt(expanded.slice(0, position + places) || '0');
  if ((expanded[position + places] ?? '0') >= '5') scaled++;
  const digits = scaled.toString().padStart(places + 1, '0');
  const integer = (places ? digits.slice(0, -places) : digits).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (negative && scaled !== 0n ? '-' : '') + integer + (places ? '.' + digits.slice(-places) : '');
}
export const money = (value: string | null | undefined) => value == null ? '—' : decimal(value) + ' 元';
/** 金额数字，不含单位；整数金额不补 .00，便于大号数字块排版。 */
export const moneyPlain = (value: string | null | undefined) => {
  if (value == null) return '—';
  const text = decimal(value);
  return text.endsWith('.00') ? text.slice(0, -3) : text;
};
export const percent = (value: string | null | undefined) => value == null ? '—' : decimal(value, 2, 2) + '%';

const decimalPattern = /^-?\d+(?:\.\d+)?$/;

function toScaled(value: string, scale: number): bigint {
  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = value.replace(/^-/, '').split('.');
  const digits = BigInt((whole + fraction.padEnd(scale, '0')).replace(/^0+(?=\d)/, '') || '0');
  return negative ? -digits : digits;
}

function fromScaled(value: bigint, scale: number): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  let digits = absolute.toString();
  if (scale > 0) {
    digits = digits.padStart(scale + 1, '0');
    digits = digits.slice(0, -scale) + '.' + digits.slice(-scale);
    digits = digits.replace(/\.?0+$/, '');
  }
  return (negative && absolute !== 0n ? '-' : '') + digits;
}

function scaleOf(value: string): number {
  return value.split('.')[1]?.length ?? 0;
}

/** 金额加减：全程走 BigInt，避免浮点误差；任一输入非法时返回 null。 */
export function decimalAdd(a: string | null | undefined, b: string | null | undefined): string | null {
  if (a == null || b == null || !decimalPattern.test(a) || !decimalPattern.test(b)) return null;
  const scale = Math.max(scaleOf(a), scaleOf(b));
  return fromScaled(toScaled(a, scale) + toScaled(b, scale), scale);
}

export function decimalSub(a: string | null | undefined, b: string | null | undefined): string | null {
  if (a == null || b == null || !decimalPattern.test(a) || !decimalPattern.test(b)) return null;
  const scale = Math.max(scaleOf(a), scaleOf(b));
  return fromScaled(toScaled(a, scale) - toScaled(b, scale), scale);
}

/** 多项金额求和；没有任何可用金额时返回 null。 */
export function decimalSum(values: readonly (string | null | undefined)[]): string | null {
  let total: string | null = null;
  for (const value of values) {
    if (value == null) continue;
    if (!decimalPattern.test(value)) return null;
    total = total == null ? value : decimalAdd(total, value);
    if (total === null) return null;
  }
  return total;
}
export const triState = (value: boolean | null | undefined) => value === true ? '是' : value === false ? '否' : '待确认';
export const methodNames: Record<string, string> = { nominal: '名义年化', effective: '复利年化', simple: '单利年化', xirr: '按实际日期年化', unknown: '口径待确认' };
export function shiftDecimal(value: string, shift: number): string {
  const [whole = '0', fraction = ''] = value.split('.');
  const places = fraction.length - shift;
  const digits = (whole + fraction).replace(/^0+(?=\d)/, '') || '0';
  if (places <= 0) return (digits + '0'.repeat(-places)).replace(/^0+(?=\d)/, '');
  const expanded = digits.padStart(places + 1, '0');
  const tail = expanded.slice(-places).replace(/0+$/, '');
  return expanded.slice(0, -places) + (tail ? '.' + tail : '');
}
