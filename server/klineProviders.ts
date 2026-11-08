/**
 * 日K公开行情接口适配层（零依赖，原生 fetch）。
 *
 * 数据源实测结论（2026-11-07）：
 * - 腾讯财经 fqkline/get：沪深主板/创业板/科创板均返回今年全量日K，
 *   但不支持分号批量（返回 "param error"），且北交所 bj 只返回当日 1 根 K。
 * - 东方财富 push2his：沪深京全覆盖，字段更全（成交额/涨跌幅/振幅/换手率）。
 * - 腾讯对科创板 688/689 返回的成交量单位是「股」，其余板块是「手」；
 *   东财统一为「手」。入库前统一归一为「手」。
 * - 两源 qfq（前复权）价格口径一致，auto 模式回退不会造成价格跳变。
 *
 * auto 策略：北交所直接走东财；其余腾讯优先，失败/空数据自动回退东财。
 */
import type {
  KlineAdjust, KlineProvider, KlineRow, KlineSource,
} from '../shared/types.js';
import { eastmoneySecid, marketOf, tencentSymbol } from './lib/stockCode.js';
import { acquireRequestSlot } from './lib/rateLimiter.js';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TENCENT_URL = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get';
const EASTMONEY_URL = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [600, 2_000, 6_000];
/** 腾讯返回 501/429 视为限流，冷却期内 auto 模式直接走东财 */
const PROVIDER_COOLDOWN_MS = 90_000;
let tencentCooldownUntil = 0;

export interface FetchKlineOptions {
  code: string;
  from: string;
  to: string;
  adjust: KlineAdjust;
  source: KlineSource;
  signal?: AbortSignal;
}

export interface ProviderAttempt {
  provider: KlineProvider;
  ok: boolean;
  message: string;
}

export interface FetchKlineResult {
  rows: KlineRow[];
  provider: KlineProvider;
  attempts: ProviderAttempt[];
  /** 行情源返回的股票名称（东财带 name；腾讯从 qt 取） */
  name?: string;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const toNum = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const compactDate = (day: string): string => day.replace(/-/g, '');

function signalFor(outer?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return outer ? AbortSignal.any([outer, timeout]) : timeout;
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  // 全局限速：所有源共享令牌，避免并发数被调大后打爆公开接口
  await acquireRequestSlot();
  if (signal?.aborted) throw new Error('任务已取消');
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json, text/plain, */*' },
    signal: signalFor(signal),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`响应不是 JSON（前 60 字符：${text.slice(0, 60)}）`);
  }
}

async function withRetry<T>(
  label: string, fn: () => Promise<T>, signal?: AbortSignal,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (signal?.aborted) throw new Error('任务已取消');
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (signal?.aborted) throw err;
      if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAYS_MS[attempt - 1] ?? 6_000);
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`${label} 重试 ${MAX_ATTEMPTS} 次仍失败：${message}`);
}

/**
 * 腾讯的成交量在科创板是「股」，需归一为「手」。
 * 除以 100 后四舍五入，与东财的整数手口径一致（实测 2639746→26397、5459319→54593）。
 */
function normalizeTencentVolume(code: string, raw: number): number {
  return /^(688|689)/.test(code) ? Math.round(raw / 100) : raw;
}

/**
 * 用本序列前一根收盘价推算涨跌幅/振幅。
 * 腾讯不提供这两个字段，本地补齐可让前端表格与蜡烛图口径统一。
 */
function derivePct(rows: KlineRow[]): void {
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    if (row.changePct === null) {
      const prev = i > 0 ? rows[i - 1]!.close : NaN;
      row.changePct = Number.isFinite(prev) && prev > 0
        ? Number(((row.close - prev) / prev * 100).toFixed(2)) : null;
    }
    if (row.amplitude === null) {
      const prev = i > 0 ? rows[i - 1]!.close : NaN;
      row.amplitude = Number.isFinite(prev) && prev > 0
        ? Number(((row.high - row.low) / prev * 100).toFixed(2)) : null;
    }
  }
}

function calendarDays(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 365;
  return Math.max(1, Math.round((b - a) / 86_400_000));
}

interface TencentKlineResponse {
  code: number;
  msg?: string;
  data?: Record<string, Record<string, unknown> & {
    day?: unknown[]; qfqday?: unknown[]; hfqday?: unknown[];
    qt?: Record<string, string[]>;
  }>;
}

async function fetchFromTencent(options: FetchKlineOptions): Promise<{ rows: KlineRow[]; name?: string }> {
  const { code, from, to, adjust, signal } = options;
  const symbol = tencentSymbol(code);
  // 交易日约为自然日的 70%，留足余量；腾讯按 from/to 截取，limit 只是上限
  const limit = Math.min(2000, Math.max(320, Math.ceil(calendarDays(from, to) * 0.8) + 60));
  const fq = adjust === 'none' ? '' : adjust;
  const param = `${symbol},day,${from},${to},${limit},${fq}`;
  const url = `${TENCENT_URL}?param=${encodeURIComponent(param)}`;
  const payload = await withRetry('腾讯财经', () => getJson(url, signal), signal) as TencentKlineResponse;

  if (payload.code !== 0 || (payload.msg && payload.msg !== '')) {
    throw new Error(`腾讯接口返回异常：code=${payload.code} msg=${payload.msg ?? ''}`);
  }
  const bucket = payload.data?.[symbol];
  if (!bucket) return { rows: [] };
  const key = adjust === 'hfq' ? 'hfqday' : adjust === 'qfq' ? 'qfqday' : 'day';
  const raw = (bucket[key] ?? bucket.day ?? []) as unknown[][];
  const rows: KlineRow[] = [];
  for (const item of raw) {
    if (!Array.isArray(item) || item.length < 6) continue;
    const day = String(item[0] ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < from || day > to) continue;
    rows.push({
      code, day,
      open: toNum(item[1]), close: toNum(item[2]),
      high: toNum(item[3]), low: toNum(item[4]),
      volume: normalizeTencentVolume(code, toNum(item[5])),
      amount: null, changePct: null, amplitude: null, turnover: null,
      source: 'tencent', adjust,
    });
  }
  rows.sort((a, b) => a.day.localeCompare(b.day));
  derivePct(rows);
  const quote = bucket.qt?.[symbol];
  return { rows, ...(quote?.[1] ? { name: quote[1] } : {}) };
}

interface EastmoneyKlineResponse {
  rc: number;
  data?: { name?: string; klines?: string[] } | null;
}

async function fetchFromEastmoney(options: FetchKlineOptions): Promise<{ rows: KlineRow[]; name?: string }> {
  const { code, from, to, adjust, signal } = options;
  const fqt = adjust === 'qfq' ? '1' : adjust === 'hfq' ? '2' : '0';
  const params = new URLSearchParams({
    secid: eastmoneySecid(code),
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
    klt: '101', fqt, beg: compactDate(from), end: compactDate(to),
  });
  const url = `${EASTMONEY_URL}?${params.toString()}`;
  const payload = await withRetry('东方财富', () => getJson(url, signal), signal) as EastmoneyKlineResponse;
  if (payload.rc !== 0 || !payload.data) return { rows: [] };
  const rows: KlineRow[] = [];
  for (const line of payload.data.klines ?? []) {
    const f = line.split(',');
    if (f.length < 6) continue;
    const day = f[0] ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < from || day > to) continue;
    rows.push({
      code, day,
      open: toNum(f[1]), close: toNum(f[2]), high: toNum(f[3]), low: toNum(f[4]),
      volume: toNum(f[5]),
      amount: f[6] !== undefined ? toNum(f[6]) : null,
      amplitude: f[7] !== undefined ? toNum(f[7]) : null,
      changePct: f[8] !== undefined ? toNum(f[8]) : null,
      turnover: f[10] !== undefined ? toNum(f[10]) : null,
      source: 'eastmoney', adjust,
    });
  }
  rows.sort((a, b) => a.day.localeCompare(b.day));
  derivePct(rows);
  return { rows, ...(payload.data.name ? { name: payload.data.name } : {}) };
}

function providerOrder(code: string, source: KlineSource): KlineProvider[] {
  if (source === 'tencent') return ['tencent'];
  if (source === 'eastmoney') return ['eastmoney'];
  // auto：腾讯历史日K不覆盖北交所，直接走东财
  if (marketOf(code) === 'bj') return ['eastmoney'];
  // 腾讯 501/429 限流冷却期内，跳过注定失败的腾讯请求，直接走东财
  if (Date.now() < tencentCooldownUntil) return ['eastmoney'];
  return ['tencent', 'eastmoney'];
}

export function tencentIsCoolingDown(): boolean {
  return Date.now() < tencentCooldownUntil;
}

/**
 * 抓取单只票的日K。返回空数组表示接口正常但该票无数据（退市/长期停牌/代码不存在）。
 * 所有源都异常时抛错，由任务层记为 failed。
 */
export async function fetchDailyKline(options: FetchKlineOptions): Promise<FetchKlineResult> {
  const order = providerOrder(options.code, options.source);
  const attempts: ProviderAttempt[] = [];
  for (const provider of order) {
    try {
      const result = provider === 'tencent'
        ? await fetchFromTencent(options)
        : await fetchFromEastmoney(options);
      if (result.rows.length > 0) {
        attempts.push({ provider, ok: true, message: `${result.rows.length} 根日K` });
        return { rows: result.rows, provider, attempts, ...(result.name ? { name: result.name } : {}) };
      }
      attempts.push({ provider, ok: false, message: '接口正常但未返回数据' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // 命中限流就让腾讯冷却，避免后续每只票都白等 4 次重试
      if (provider === 'tencent' && /HTTP (429|501|503)|fetch failed/i.test(message)) {
        tencentCooldownUntil = Date.now() + PROVIDER_COOLDOWN_MS;
      }
      attempts.push({ provider, ok: false, message });
    }
  }
  const detail = attempts.map((a) => `${a.provider}: ${a.message}`).join('；');
  throw new Error(`全部数据源均无有效日K（${detail}）`);
}

export const KLINE_SOURCES: Array<{ key: KlineSource; label: string; hint: string }> = [
  { key: 'auto', label: '腾讯优先（自动兜底）', hint: '沪深用腾讯；北交所与失败自动切东财' },
  { key: 'tencent', label: '仅腾讯财经', hint: 'fqkline/get，北交所无历史日K' },
  { key: 'eastmoney', label: '仅东方财富', hint: 'push2his，沪深京全覆盖且字段最全' },
];
