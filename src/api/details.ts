/**
 * 涨停表现明细接口（实测可复现、免登录、支持任意历史交易日）。
 *
 * 来源：App 切换日期时发出的真实 GET 请求，字段含义用 macOS 辅助功能树
 * 读取的 App 实际显示值逐项比对确认（2026-11-06：21 涨停 + 11 破板 = 32 行）。
 *
 *   a=DailyLimitPerformance  &Type=4&Order=0  -> 涨停个股，23 字段
 *   a=DailyLimitPerformance2 &Type=5&Order=1  -> 破板个股，18 字段
 *   a=DailyLimitIndex        &Day=...         -> 连板梯队 [一板,二板,...]
 *
 * 公共参数：c=HisHomeDingPan, Index=0, PidType=1, st=1000, Day=YYYY-MM-DD
 */
import { CONFIG, commonParams } from '../config.js';
import { debug } from '../logger.js';
import type { DetailRow, DayDetail } from '../types.js';

const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 12_000;

type Json = Record<string, unknown>;

interface ActionSpec {
  action: string;
  type: string;
  order: string;
}

async function fetchAction(day: string, spec: ActionSpec): Promise<unknown[]> {
  const params: Record<string, string> = {
    ...commonParams(),
    a: spec.action,
    c: 'HisHomeDingPan',
    Day: day,
    Index: '0',
    Order: spec.order,
    PidType: '1',
    Type: spec.type,
    st: '1000',
  };
  const url = `${CONFIG.apiBase}?${new URLSearchParams(params).toString()}`;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'User-Agent': CONFIG.userAgent, Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as Json;
      if (String(body.errcode ?? '0') !== '0') throw new Error(`errcode=${String(body.errcode)}`);
      const info = body.info;
      if (Array.isArray(info) && Array.isArray(info[0])) return info[0] as unknown[];
      return Array.isArray(info) ? info : [];
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) {
        const msg = err instanceof Error ? err.message : String(err);
        debug(`${spec.action} ${day} 第 ${attempt} 次失败（${msg}），重试`);
        await new Promise((r) => setTimeout(r, 350 * attempt));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/** 涨停时间戳是本地时区（CST）的 Unix 秒 */
export function formatLimitTime(ts: number): string {
  if (!Number.isFinite(ts) || ts < 1_000_000_000) return '';
  const d = new Date(ts * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function splitThemes(text: string): string[] {
  return text.split(/[、,，]/).map((s) => s.trim()).filter(Boolean);
}

/**
 * 涨停行 23 字段（索引经 App AX 树逐项比对）：
 * 0代码 1名称 4涨停时间戳 5题材 6封单 7最大封单 8主力净额 9主力买入 10主力卖出
 * 11成交额 12题材、板块 13实际流通 14实际换手 16回封标记 17振幅 18连板标注
 * 19板块代码 20题材家数 21价格 22涨幅
 */
function parseLimitRow(a: unknown[]): DetailRow | null {
  if (a.length < 23 || !/^\d{6}$/.test(str(a[0]))) return null;
  const themes = splitThemes(str(a[12]));
  const tags: string[] = [];
  if (num(a[16]) === 1) tags.push('回封');
  const boards = str(a[18]);
  if (boards) tags.push(boards);
  return {
    code: str(a[0]), name: str(a[1]), kind: 'limit',
    time: formatLimitTime(num(a[4])), boards,
    reason: str(a[5]), reasonCount: num(a[20]),
    themes, sector: themes.length > 1 ? themes[themes.length - 1]! : '',
    seal: num(a[6]), maxSeal: num(a[7]), mainNet: num(a[8]),
    mainBuy: num(a[9]), mainSell: num(a[10]), amount: num(a[11]),
    floatCap: num(a[13]), turnover: num(a[14]), amplitude: num(a[17]),
    price: num(a[21]), change: num(a[22]),
    tags,
  };
}

/**
 * 破板行 18 字段：0代码 1名称 4价格 5涨幅 6题材、板块 7-9资金(常为0)
 * 10成交额 11实际流通 12实际换手 14振幅 17炸板前封单
 */
function parseBrokenRow(a: unknown[]): DetailRow | null {
  if (a.length < 18 || !/^\d{6}$/.test(str(a[0]))) return null;
  const themes = splitThemes(str(a[6]));
  return {
    code: str(a[0]), name: str(a[1]), kind: 'broken',
    time: '', boards: '',
    reason: themes[0] ?? '', reasonCount: 0,
    themes, sector: themes.length > 1 ? themes[themes.length - 1]! : '',
    seal: num(a[17]), maxSeal: 0, mainNet: num(a[7]),
    mainBuy: num(a[8]), mainSell: num(a[9]), amount: num(a[10]),
    floatCap: num(a[11]), turnover: num(a[12]), amplitude: num(a[14]),
    price: num(a[4]), change: num(a[5]),
    tags: ['破板'],
  };
}

async function fetchLadder(day: string): Promise<number[]> {
  const params: Record<string, string> = {
    ...commonParams(), a: 'DailyLimitIndex', c: 'HisHomeDingPan', Day: day,
  };
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(`${CONFIG.apiBase}?${new URLSearchParams(params).toString()}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'User-Agent': CONFIG.userAgent },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as Json;
      return Array.isArray(body.info) ? (body.info as unknown[]).map(num) : [];
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 350 * attempt));
    }
  }
  debug(`DailyLimitIndex ${day} 失败：${lastError instanceof Error ? lastError.message : String(lastError)}`);
  return [];
}

export interface DayFetchResult {
  detail: DayDetail | null;
  failures: string[];
}

/** 拉取单个交易日的完整涨停表现（涨停 + 破板 + 连板梯队） */
export async function fetchDayDetail(day: string): Promise<DayFetchResult> {
  const specs: Array<{ key: string; spec: ActionSpec }> = [
    { key: 'limit', spec: { action: 'DailyLimitPerformance', type: '4', order: '0' } },
    { key: 'broken', spec: { action: 'DailyLimitPerformance2', type: '5', order: '1' } },
  ];
  const [ladder, ...results] = await Promise.all([
    fetchLadder(day),
    ...specs.map((s) => fetchAction(day, s.spec).catch(() => [] as unknown[])),
  ]);
  const failures: string[] = [];
  const parsed: DetailRow[] = [];
  specs.forEach((s, i) => {
    const raw = results[i];
    if (!raw || raw.length === 0) { failures.push(s.spec.action); return; }
    const fn = s.key === 'limit' ? parseLimitRow : parseBrokenRow;
    let count = 0;
    for (const item of raw) {
      if (!Array.isArray(item)) continue;
      const row = fn(item);
      if (row) { parsed.push(row); count += 1; }
    }
    if (count === 0) failures.push(`${s.spec.action}(无有效行)`);
  });

  const limitRows = parsed.filter((r) => r.kind === 'limit');
  const brokenRows = parsed.filter((r) => r.kind === 'broken');
  const totalSeal = limitRows.reduce((sum, r) => sum + r.seal, 0);
  const reasonCounts: Record<string, number> = {};
  for (const r of limitRows) if (r.reason) reasonCounts[r.reason] = (reasonCounts[r.reason] ?? 0) + 1;

  return {
    detail: {
      day,
      ladder,
      rows: parsed,
      stats: {
        limitCount: limitRows.length,
        brokenCount: brokenRows.length,
        totalSeal,
        avgSeal: limitRows.length ? Math.round(totalSeal / limitRows.length) : 0,
        reasonCounts,
      },
    },
    failures,
  };
}

/** 全年交易日与每日概览：ChangeStatistics 一次返回约 1000 个交易日 */
export interface TradingDay {
  day: string;
  strong: number;
  limitUp: number;
  ladderHeight: number;
  sharpDrop: number;
}

export async function fetchTradingDays(): Promise<TradingDay[]> {
  const params: Record<string, string> = {
    ...commonParams(), a: 'ChangeStatistics', c: 'HisHomeDingPan', Index: '0', st: '1000',
  };
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(`${CONFIG.apiBase}?${new URLSearchParams(params).toString()}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'User-Agent': CONFIG.userAgent },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as Json;
      if (!Array.isArray(body.info)) return [];
      return (body.info as unknown[])
        .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x))
        .map((x) => ({
          day: str(x.Day), strong: num(x.strong), limitUp: num(x.ztjs),
          ladderHeight: num(x.lbgd), sharpDrop: num(x.df_num),
        }))
        .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.day))
        .sort((a, b) => a.day.localeCompare(b.day));
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
