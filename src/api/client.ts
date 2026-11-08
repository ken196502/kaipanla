import { CONFIG, commonParams } from '../config.js';
import { debug, warn } from '../logger.js';
import { fetchDayDetail } from './details.js';
import type {
  BrokenBoardPoint, HistoryPoint, LimitUpRow, Overview, SharpWithdrawal, WeightSector,
} from '../types.js';

type Json = Record<string, unknown>;

interface CallSpec {
  action: string;
  method: 'GET' | 'POST';
  controller: string;
  /** 日期参数名：GET 用 Day，POST 用 Date */
  dateParam?: 'Day' | 'Date';
  extra?: Record<string, string>;
}

/** 全部为实测可复现、免登录的接口 */
export const VERIFIED_ENDPOINTS: CallSpec[] = [
  { action: 'DailyLimitIndex', method: 'GET', controller: 'HisHomeDingPan', dateParam: 'Day' },
  { action: 'MarketStockZDNum', method: 'POST', controller: 'HisHomeDingPan', dateParam: 'Date' },
  { action: 'ZhangTingExpression', method: 'GET', controller: 'HisHomeDingPan', dateParam: 'Day' },
  { action: 'ChangeStatistics', method: 'GET', controller: 'HisHomeDingPan', extra: { Index: '0', st: '1000' } },
  { action: 'ZhangTingPoBan', method: 'POST', controller: 'HisHomeDingPan', dateParam: 'Date' },
  // 实测：这三个 action 的日期参数名是 Day（不是 Date），GET/POST 均可
  { action: 'SharpWithdrawalList', method: 'GET', controller: 'HisHomeDingPan', dateParam: 'Day' },
  { action: 'HisZhangFuDetail', method: 'GET', controller: 'HisHomeDingPan', dateParam: 'Day' },
  { action: 'WeightPerformance', method: 'GET', controller: 'HisHomeDingPan', dateParam: 'Day' },
  { action: 'MarketCapacityKLine', method: 'POST', controller: 'HisHomeDingPan', dateParam: 'Date' },
];

const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 12_000;

async function call(spec: CallSpec, day: string, extra: Record<string, string> = {}): Promise<Json> {
  const params: Record<string, string> = {
    ...commonParams(),
    a: spec.action,
    c: spec.controller,
    ...(spec.dateParam ? { [spec.dateParam]: day } : {}),
    ...(spec.extra ?? {}),
    ...extra,
  };
  const encoded = new URLSearchParams(params).toString();
  const headers: Record<string, string> = { 'User-Agent': CONFIG.userAgent, Accept: 'application/json' };
  const init: RequestInit = { method: spec.method, headers };
  let url = CONFIG.apiBase;
  if (spec.method === 'GET') {
    url = `${url}?${encoded}`;
  } else {
    init.body = encoded;
    headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=utf-8';
  }
  debug(`${spec.method} ${spec.action} ${spec.dateParam ?? ''}=${day}`);

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      // 每次重试都新建 timeout signal（AbortSignal.timeout 不可复用）
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as Json;
      if (String(body.errcode ?? '0') !== '0') throw new Error(`errcode=${String(body.errcode)}`);
      return body;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) {
        const msg = err instanceof Error ? err.message : String(err);
        debug(`${spec.action} 第 ${attempt} 次取数失败（${msg}），${300 * attempt}ms 后重试`);
        await new Promise((r) => setTimeout(r, 300 * attempt));
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

function parseHistory(info: unknown): HistoryPoint[] {
  if (!Array.isArray(info)) return [];
  return info
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x))
    .map((x) => ({
      day: str(x.Day), strong: num(x.strong), limitUp: num(x.ztjs),
      ladderHeight: num(x.lbgd), sharpDrop: num(x.df_num),
    }))
    .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.day));
}

function parseBroken(info: unknown): BrokenBoardPoint[] {
  if (!Array.isArray(info)) return [];
  return info
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => ({ day: str(x.Day), broken: num(x.PBS), ratio: num(x.TZB) }))
    .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.day));
}

function parseWithdrawals(info: unknown): SharpWithdrawal[] {
  if (!Array.isArray(info)) return [];
  return info
    .filter((x): x is unknown[] => Array.isArray(x) && x.length >= 6)
    .map((x) => ({ code: str(x[0]), name: str(x[1]), price: num(x[4]), drop: num(x[5]) }));
}

function parseWeight(info: unknown): { up: WeightSector[]; down: WeightSector[] } {
  const toSector = (v: unknown): WeightSector[] => {
    if (!Array.isArray(v)) return [];
    return v
      .filter((x): x is unknown[] => Array.isArray(x) && x.length >= 6)
      .map((x) => ({
        plateCode: str(x[0]), plateName: str(x[1]), change: num(x[2]),
        leaderCode: str(x[3]), leaderName: str(x[4]), leaderChange: num(x[5]),
      }));
  };
  const obj = info && typeof info === 'object' && !Array.isArray(info) ? (info as Record<string, unknown>) : {};
  return { up: toSector(obj.SZ), down: toSector(obj.XD) };
}

export interface OverviewResult {
  overview: Overview;
  okCount: number;
  failCount: number;
  notes: string[];
}

/** 并行拉取全部概览接口；单个失败不影响其余 */
export async function loadOverview(day: string): Promise<OverviewResult> {
  const results = await Promise.allSettled(VERIFIED_ENDPOINTS.map((spec) => call(spec, day)));
  const data = new Map<string, Json>();
  const notes: string[] = [];
  let okCount = 0;
  let failCount = 0;
  results.forEach((r, i) => {
    const action = VERIFIED_ENDPOINTS[i]!.action;
    if (r.status === 'fulfilled') {
      data.set(action, r.value);
      okCount += 1;
    } else {
      failCount += 1;
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      warn(`${action} 取数失败：${msg}`);
      notes.push(`${action} 未返回`);
    }
  });

  const countInfo = data.get('MarketStockZDNum')?.info;
  const countObj = countInfo && typeof countInfo === 'object' && !Array.isArray(countInfo)
    ? (countInfo as Record<string, unknown>) : {};
  const exprRaw = Array.isArray(data.get('ZhangTingExpression')?.info)
    ? (data.get('ZhangTingExpression')!.info as unknown[]) : [];
  const distInfo = data.get('HisZhangFuDetail')?.info;
  const distribution: Record<string, number> = {};
  if (distInfo && typeof distInfo === 'object' && !Array.isArray(distInfo)) {
    for (const [k, v] of Object.entries(distInfo as Record<string, unknown>)) distribution[k] = num(v);
  }
  const capInfo = data.get('MarketCapacityKLine')?.info;
  const marketCapacity = Array.isArray(capInfo)
    ? capInfo
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .map((x) => ({ day: str(x.Date), value: num(x.lastPoint) }))
      .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.day))
    : [];

  const ladder = Array.isArray(data.get('DailyLimitIndex')?.info)
    ? (data.get('DailyLimitIndex')!.info as unknown[]).map(num)
    : [];
  const history = parseHistory(data.get('ChangeStatistics')?.info);

  const overview: Overview = {
    date: day,
    ladder,
    ladderLabels: ['一板', '二板', '三板', '四板', '更高'],
    limitUpCount: countObj.SJZT !== undefined ? num(countObj.SJZT) : null,
    limitDownCount: countObj.SJDT !== undefined ? num(countObj.SJDT) : null,
    expression: exprRaw.filter((v): v is number => typeof v === 'number'),
    expressionHint: str(exprRaw.find((v) => typeof v === 'string')),
    history,
    brokenBoard: parseBroken(data.get('ZhangTingPoBan')?.info),
    withdrawals: parseWithdrawals(data.get('SharpWithdrawalList')?.info),
    distribution,
    weightSectors: parseWeight(data.get('WeightPerformance')?.info),
    marketCapacity,
  };
  return { overview, okCount, failCount, notes };
}

function formatWan(v: number): string {
  if (!v) return '—';
  const a = Math.abs(v);
  if (a >= 1e8) return `${(v / 1e8).toFixed(2)}亿`;
  if (a >= 1e4) return `${(v / 1e4).toFixed(0)}万`;
  return String(v);
}

/**
 * 明细列表：直接使用实测可复现的 GET + Day 接口（免登录、可回溯任意交易日），
 * 字段索引由 App 辅助功能树的真实显示值逐项校准。
 */
export async function loadDetailRows(day: string): Promise<{ rows: LimitUpRow[]; source: string }> {
  try {
    const result = await fetchDayDetail(day);
    if (!result.detail) return { rows: [], source: '明细接口未返回数据' };
    const rows: LimitUpRow[] = result.detail.rows.map((r) => ({
      code: r.code,
      name: r.name,
      time: r.time,
      boardNote: r.boards,
      reason: r.reason,
      reasonCount: r.reasonCount,
      sealText: formatWan(r.seal),
      sealWan: Math.round(r.seal / 10_000),
      tags: r.tags,
    }));
    return { rows, source: 'DailyLimitPerformance(GET+Day)' };
  } catch (err) {
    warn(`明细取数失败：${err instanceof Error ? err.message : String(err)}`);
    return { rows: [], source: '明细接口异常' };
  }
}

export async function probeApi(day: string): Promise<OverviewResult> {
  return loadOverview(day);
}
