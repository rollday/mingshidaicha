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
export const percent = (value: string | null | undefined) => value == null ? '—' : decimal(value, 2, 2) + '%';
export const triState = (value: boolean | null | undefined) => value === true ? '是' : value === false ? '否' : '待确认';
export const methodNames: Record<string, string> = { nominal: '名义年化', effective: '复利年化', simple: '到期单利年化', xirr: '按实际日期年化', unknown: '口径待确认' };
export function shiftDecimal(value: string, shift: number): string {
  const [whole = '0', fraction = ''] = value.split('.');
  const places = fraction.length - shift;
  const digits = (whole + fraction).replace(/^0+(?=\d)/, '') || '0';
  if (places <= 0) return (digits + '0'.repeat(-places)).replace(/^0+(?=\d)/, '');
  const expanded = digits.padStart(places + 1, '0');
  const tail = expanded.slice(-places).replace(/0+$/, '');
  return expanded.slice(0, -places) + (tail ? '.' + tail : '');
}
