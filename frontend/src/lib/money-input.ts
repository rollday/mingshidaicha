import { shiftDecimal } from './format.ts';

/** Accepts what people actually paste: "10,000", "¥10000", "1.2万", "10000元". Returns a stored decimal string or null. */
export function parseMoneyText(text: string): string | null {
  let value = text.trim().replace(/[¥￥,，\s]/g, '').replace(/^人民币/, '').replace(/元$/, '');
  if (!value) return null;
  let scale = 0;
  if (value.endsWith('万')) { value = value.slice(0, -1); scale = 4; }
  else if (value.endsWith('亿')) { value = value.slice(0, -1); scale = 8; }
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
  const shifted = scale === 0 ? value : shiftDecimal(value, scale);
  return /^\d+(?:\.\d+)?$/.test(shifted) ? shifted : null;
}

/** Percent text like "12" or "12.5%" becomes the stored rate "0.12". */
export function parsePercentText(text: string): string | null {
  const value = text.trim().replace(/[%％\s]/g, '');
  if (!value) return null;
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
  return shiftDecimal(value, -2);
}

export function percentDraft(value: string | null): string {
  return value === null ? '' : shiftDecimal(value, 2);
}
