/**
 * A 股代码 → 市场 / 行情源 symbol 映射。
 * 沪深：60/68→sh，00/30→sz；北交所：43/83/87/92→bj。
 * 腾讯历史日K不支持北交所（只返回当日一根），北交所必须走东方财富，
 * 因此市场判定必须与 provider 选择共用同一套规则。
 */
export type StockMarket = 'sh' | 'sz' | 'bj';

export function marketOf(code: string): StockMarket {
  if (/^(4|8|9)/.test(code)) return 'bj';
  if (code.startsWith('6')) return 'sh';
  return 'sz';
}

/** 腾讯财经 fqkline 的 symbol，例如 sh600000 / sz002160 / bj920199 */
export function tencentSymbol(code: string): string {
  return `${marketOf(code)}${code}`;
}

/** 东方财富 push2his 的 secid：沪市 1.，深市与北交所 0. */
export function eastmoneySecid(code: string): string {
  return `${marketOf(code) === 'sh' ? '1' : '0'}.${code}`;
}

export function isSixDigitCode(value: string): boolean {
  return /^\d{6}$/.test(value);
}
