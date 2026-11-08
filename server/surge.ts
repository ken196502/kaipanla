/**
 * 月度「近两月内自最低点涨幅达标」统计 —— 按自然月归属、按板块分类。
 *
 * 口径（与页面说明保持一致）：
 *  - 候选波段：滑动窗口「上月 1 日 ~ 当月末」；1 月窗口为「去年 12 月 1 日 ~ 1 月末」
 *    （库里补抓去年 12 月日K后即为完整两月窗口，没有时自动退化为 1 月单月）。
 *    取窗口内最低 low 当日、其后最高 high，涨幅 = high / low - 1 ≥ 阈值，高点必须严格在低点之后。
 *  - 去重：同一 (股票, 最高点日) 视为同一波，跨窗口重复只保留涨幅最大的那次；
 *    同一股票在同一归属月也只保留涨幅最大的一条，因此 12 列里不再重复出现同一波。
 *  - 归属：低点与高点同月 → 直接归该月（含 1 月）；跨月 → 比较各自然月
 *    「(月内最高 − 月内最低) / 波段最低价」，取振幅更大的月份。
 *    去年 12 月只作低点来源：低点在去年 12 月的波段归最高点所在月（1 月列），
 *    低点与高点都在去年 12 月的波段丢弃（12 列只有今年，属去年行情）。
 *  - 新股：首根「今年」日K晚于今年首个交易日的股票视为今年新上市，整只排除（可关闭）。
 *  - 板块：取该股在波段区间内涨停明细 sector 的众数，回退到统计窗口、再到全年。
 *  - K 线取自 daily_kline（今年所有盘中触及涨停个股的前复权日K + 补抓的去年 12 月）。
 *
 * 实现：一次读取跨年日K与涨停板块明细，按 code + 月份分桶（今年 12 个月 + 去年 12 月单独一桶）；
 * 每月只合并相邻两个桶，避免 12 次全表扫描。
 */
import fs from 'node:fs';
import { db, DB_PATH } from './db.js';
import type {
  SurgeBasis, SurgeHit, SurgeMonth, SurgeResponse, SurgeScope,
} from '../shared/types.js';

export interface SurgeQuery {
  year: number;
  /** 涨幅阈值，百分比数值，50 表示 +50% */
  threshold: number;
  basis: SurgeBasis;
  scope: SurgeScope;
  /** 整只排除今年新上市的股票 */
  excludeNew: boolean;
  force?: boolean;
}

interface Bar {
  day: string;
  low: number;
  high: number;
  close: number;
}

interface DbBarRow {
  code: string;
  day: string;
  low: number;
  high: number;
  close: number;
}

interface SectorEntry {
  day: string;
  sector: string;
}

interface DbSectorRow {
  code: string;
  day: string;
  sector: string;
}

interface Wave {
  code: string;
  name: string;
  windowMonth: number;
  windowFrom: string;
  windowTo: string;
  bars: Bar[];
  baseIdx: number;
  peakIdx: number;
  baseDay: string;
  basePrice: number;
  peakDay: string;
  peakPrice: number;
  gainPct: number;
  sessions: number;
}

const pad = (n: number): string => String(n).padStart(2, '0');
const round2 = (n: number): number => Math.round(n * 100) / 100;
/** 去年 12 月单独一桶，且用一个不落在 1..12 的伪月份，避免串到今年 12 月列 */
const PREV_DEC_BUCKET = 12;
const PREV_DEC_KEY = 13;

/** 该月最后一天，避免 02-31 这类非法日期字符串 */
function monthEnd(year: number, month: number): string {
  return `${year}-${pad(month)}-${pad(new Date(year, month, 0).getDate())}`;
}

/** 数据库文件 + WAL 的指纹：抓取任务写入后缓存自动失效 */
function dbSignature(): string {
  return [DB_PATH, `${DB_PATH}-wal`].map((p) => {
    try {
      const s = fs.statSync(p);
      return `${s.size}:${s.mtimeMs}`;
    } catch {
      return '0:0';
    }
  }).join('|');
}

/** 最近若干组参数的结果；抓取写入数据库后由 dbSignature 自动失效 */
const CACHE_LIMIT = 16;
const cache = new Map<string, SurgeResponse>();

/**
 * 库内日K覆盖的年份，供前端年份下拉使用。
 * 只要有 1~11 月的数据才算一个可统计年份：补抓进来「只有 12 月」的上一年不会混进下拉框。
 */
export function surgeYears(): number[] {
  const rows = db.prepare(
    "SELECT DISTINCT substr(day, 1, 4) AS y FROM daily_kline "
    + "WHERE day <> '' AND substr(day, 6, 2) BETWEEN '01' AND '11' ORDER BY y",
  ).all() as unknown as Array<{ y: string }>;
  return rows.map((r) => Number(r.y)).filter((y) => Number.isFinite(y) && y > 1990);
}

/** 计算单个滑动窗口内的「自最低点起」最大涨幅波段 */
function evaluateWave(
  code: string, name: string, bars: Bar[], windowMonth: number,
  windowFrom: string, windowTo: string, basis: SurgeBasis, thresholdPct: number,
): Wave | null {
  if (bars.length < 2) return null;
  let baseIdx = 0;
  let peakIdx = 0;
  let basePrice = 0;
  let peakPrice = 0;

  if (basis === 'range') {
    // 不看先后：窗口内最低 low 与最高 high
    for (let i = 1; i < bars.length; i += 1) {
      const bar = bars[i]!;
      if (bar.low < bars[baseIdx]!.low) baseIdx = i;
      if (bar.high > bars[peakIdx]!.high) peakIdx = i;
    }
    basePrice = bars[baseIdx]!.low;
    peakPrice = bars[peakIdx]!.high;
  } else {
    const useClose = basis === 'close';
    const baseValue = (b: Bar): number => (useClose ? b.close : b.low);
    const peakValue = (b: Bar): number => (useClose ? b.close : b.high);
    for (let i = 1; i < bars.length; i += 1) {
      if (baseValue(bars[i]!) < baseValue(bars[baseIdx]!)) baseIdx = i;
    }
    basePrice = baseValue(bars[baseIdx]!);
    // 高点必须严格出现在低点之后；低点当日的高价只代表当天振幅，不算「从最低点涨起」
    if (baseIdx + 1 >= bars.length) return null;
    peakIdx = baseIdx + 1;
    for (let i = baseIdx + 2; i < bars.length; i += 1) {
      if (peakValue(bars[i]!) > peakValue(bars[peakIdx]!)) peakIdx = i;
    }
    peakPrice = peakValue(bars[peakIdx]!);
  }

  if (!(basePrice > 0) || !(peakPrice > 0)) return null;
  const gainPct = (peakPrice / basePrice - 1) * 100;
  if (gainPct < thresholdPct) return null;
  return {
    code, name, windowMonth, windowFrom, windowTo, bars, baseIdx, peakIdx,
    baseDay: bars[baseIdx]!.day,
    basePrice: round2(basePrice),
    peakDay: bars[peakIdx]!.day,
    peakPrice: round2(peakPrice),
    gainPct: round2(gainPct),
    sessions: Math.abs(peakIdx - baseIdx) + 1,
  };
}

/** 今年 1~12 月返回月份数字；去年 12 月返回 PREV_DEC_KEY */
function monthKey(day: string, year: number): number {
  return day.slice(0, 4) === String(year) ? Number(day.slice(5, 7)) : PREV_DEC_KEY;
}

/**
 * 归属月份：低点/高点同月直接归该月；跨月则按
 * 「(该月内最高 − 该月内最低) / 波段最低价」比较月内走势，取更大的月。
 * 去年 12 月没有对应列，只作为低点来源：低点在去年 12 月的波归最高点所在月，
 * 低点与高点都在去年 12 月的波返回 0（调用方丢弃）。
 */
function decideOwner(wave: Wave, basis: SurgeBasis, year: number): { month: number; note: string } {
  const baseMonth = monthKey(wave.baseDay, year);
  const peakMonth = monthKey(wave.peakDay, year);
  if (peakMonth === PREV_DEC_KEY) {
    return { month: 0, note: '最高点在去年 12 月，属去年行情，不计入今年 12 列' };
  }
  if (baseMonth === PREV_DEC_KEY) {
    return {
      month: peakMonth,
      note: `低点 ${wave.baseDay} 在去年 12 月（仅作低点来源）→ 归 ${peakMonth} 月`,
    };
  }
  if (baseMonth === peakMonth) {
    return {
      month: baseMonth,
      note: `低点 ${wave.baseDay} 与高点 ${wave.peakDay} 同在 ${baseMonth} 月，直接归属`,
    };
  }

  const lo = Math.min(wave.baseIdx, wave.peakIdx);
  const hi = Math.max(wave.baseIdx, wave.peakIdx);
  const segment = wave.bars.slice(lo, hi + 1);
  const lowOf = (b: Bar): number => (basis === 'close' ? b.close : b.low);
  const highOf = (b: Bar): number => (basis === 'close' ? b.close : b.high);
  const byMonth = new Map<number, { low: number; high: number }>();
  for (const bar of segment) {
    const month = monthKey(bar.day, year);
    if (month === PREV_DEC_KEY) continue;
    const current = byMonth.get(month);
    if (!current) byMonth.set(month, { low: lowOf(bar), high: highOf(bar) });
    else {
      current.low = Math.min(current.low, lowOf(bar));
      current.high = Math.max(current.high, highOf(bar));
    }
  }

  const parts: string[] = [];
  let bestMonth = baseMonth;
  let bestAmp = -1;
  for (const [month, value] of [...byMonth.entries()].sort((a, b) => a[0] - b[0])) {
    const amp = (value.high - value.low) / wave.basePrice;
    parts.push(`${month}月 ${(amp * 100).toFixed(1)}%`);
    if (amp > bestAmp) {
      bestAmp = amp;
      bestMonth = month;
    }
  }
  if (bestMonth === 0 || parts.length === 0) return { month: 0, note: '波段无今年可归属月份' };
  return {
    month: bestMonth,
    note: `跨月，月内振幅 ÷ 波段最低价：${parts.join(' / ')} → 归 ${bestMonth} 月`,
  };
}

/** 板块归类：波段区间内涨停 sector 众数 → 统计窗口 → 全年 → 未分类 */
function pickSector(
  code: string, index: Map<string, SectorEntry[]>, ranges: Array<[string, string]>,
): string {
  const list = index.get(code);
  if (!list || list.length === 0) return '未分类';
  for (const [from, to] of ranges) {
    const counts = new Map<string, number>();
    for (const entry of list) {
      if (entry.day < from || entry.day > to) continue;
      counts.set(entry.sector, (counts.get(entry.sector) ?? 0) + 1);
    }
    if (counts.size === 0) continue;
    let best = '';
    let bestCount = 0;
    for (const [sector, count] of counts) {
      if (count > bestCount || (count === bestCount && sector > best)) {
        best = sector;
        bestCount = count;
      }
    }
    return best || '未分类';
  }
  return '未分类';
}

export function computeMonthlySurge(query: SurgeQuery): SurgeResponse {
  const startedAt = Date.now();
  const key = [
    query.year, query.threshold, query.basis, query.scope, query.excludeNew, dbSignature(),
  ].join('|');
  const cached = cache.get(key);
  if (!query.force && cached) {
    return { ...cached, fromCache: true };
  }

  const yearStart = `${query.year}-01-01`;
  const yearEnd = `${query.year}-12-31`;
  const prevYear = query.year - 1;
  const prevDecStart = `${prevYear}-12-01`;
  const prevDecEnd = `${prevYear}-12-31`;

  const scopeFilter = query.scope === 'limit'
    ? new Set(
      (db.prepare('SELECT code FROM kline_symbols WHERE limit_days > 0').all() as unknown as Array<{ code: string }>)
        .map((r) => r.code),
    )
    : null;

  const names = new Map<string, string>(
    (db.prepare('SELECT code, name FROM kline_symbols').all() as unknown as Array<{ code: string; name: string }>)
      .map((r) => [r.code, r.name.trim()] as const),
  );

  const range = db.prepare(`
    SELECT MIN(day) AS first_day, MAX(day) AS last_day, COUNT(*) AS c
    FROM daily_kline WHERE adjust = ? AND day >= ? AND day <= ?
  `).get('qfq', prevDecStart, yearEnd) as unknown as {
    first_day: string | null; last_day: string | null; c: number;
  } | undefined;

  /** 新股判定只看今年数据，避免补抓去年 12 月后把「12 月停牌」的老股误判为新股 */
  const firstDayOverall = (db.prepare(`
    SELECT MIN(day) AS d FROM daily_kline WHERE adjust = ? AND day >= ? AND day <= ?
  `).get('qfq', yearStart, yearEnd) as unknown as { d: string | null } | undefined)?.d ?? yearStart;

  const rows = db.prepare(`
    SELECT code, day, low, high, close FROM daily_kline
    WHERE adjust = ? AND day >= ? AND day <= ? AND low > 0 AND high > 0
    ORDER BY code, day
  `).all('qfq', prevDecStart, yearEnd) as unknown as DbBarRow[];

  const sectorIndex = new Map<string, SectorEntry[]>();
  const sectorRows = db.prepare(`
    SELECT code, day, sector FROM limit_up_rows
    WHERE sector <> '' AND day >= ? AND day <= ? ORDER BY code, day
  `).all(prevDecStart, yearEnd) as unknown as DbSectorRow[];
  for (const entry of sectorRows) {
    const list = sectorIndex.get(entry.code) ?? [];
    list.push({ day: entry.day, sector: entry.sector });
    sectorIndex.set(entry.code, list);
  }

  // byCode: code -> 今年 12 个月桶（0..11）+ 去年 12 月桶（12），桶内按日期升序
  const byCode = new Map<string, Bar[][]>();
  for (const row of rows) {
    if (scopeFilter && !scopeFilter.has(row.code)) continue;
    let buckets = byCode.get(row.code);
    if (!buckets) {
      buckets = Array.from({ length: 13 }, (): Bar[] => []);
      byCode.set(row.code, buckets);
    }
    const bucket = row.day.slice(0, 4) === String(query.year)
      ? buckets[Number(row.day.slice(5, 7)) - 1]
      : buckets[PREV_DEC_BUCKET];
    if (!bucket) continue;
    bucket.push({
      day: row.day,
      low: Number(row.low),
      high: Number(row.high),
      close: Number(row.close),
    });
  }

  // 今年新上市：首根「今年」日K晚于今年首个交易日的票即为新股
  const newStocks = new Set<string>();
  for (const [code, buckets] of byCode) {
    const first = buckets.slice(0, 12).find((b) => b.length > 0)?.[0];
    if (first && first.day > firstDayOverall) newStocks.add(code);
  }
  if (query.excludeNew) {
    for (const code of newStocks) byCode.delete(code);
  }

  // 枚举 12 个滑动窗口的候选波段；1 月窗口 = 去年 12 月 + 今年 1 月
  const wavesByCode = new Map<string, Wave[]>();
  for (const [code, buckets] of byCode) {
    const name = names.get(code) || code;
    const found: Wave[] = [];
    for (let month = 1; month <= 12; month += 1) {
      const windowFrom = month === 1
        ? prevDecStart
        : `${query.year}-${pad(month - 1)}-01`;
      const windowTo = monthEnd(query.year, month);
      const windowBars = month === 1
        ? [...(buckets[PREV_DEC_BUCKET] ?? []), ...(buckets[0] ?? [])]
        : [...(buckets[month - 2] ?? []), ...(buckets[month - 1] ?? [])];
      const wave = evaluateWave(
        code, name, windowBars, month, windowFrom, windowTo, query.basis, query.threshold,
      );
      if (wave) found.push(wave);
    }
    if (found.length > 0) wavesByCode.set(code, found);
  }

  // 去重 + 归属 + 板块归类
  const monthHits = new Map<number, SurgeHit[]>();
  let rawWaves = 0;
  for (const [code, waves] of wavesByCode) {
    rawWaves += waves.length;
    // 同一最高点日 = 同一波，只保留涨幅最大的窗口结果
    const byPeak = new Map<string, Wave>();
    for (const wave of waves) {
      const current = byPeak.get(wave.peakDay);
      if (!current || wave.gainPct > current.gainPct
        || (wave.gainPct === current.gainPct && wave.windowMonth < current.windowMonth)) {
        byPeak.set(wave.peakDay, wave);
      }
    }
    // 同一股票在同一归属月只保留涨幅最大的一条
    const byOwner = new Map<number, SurgeHit>();
    for (const wave of byPeak.values()) {
      const owner = decideOwner(wave, query.basis, query.year);
      // 去年 12 月没有对应列：整段在去年 12 月的波段直接丢弃
      if (owner.month < 1 || owner.month > 12) continue;
      const [rangeFrom, rangeTo] = wave.baseDay <= wave.peakDay
        ? [wave.baseDay, wave.peakDay] as const
        : [wave.peakDay, wave.baseDay] as const;
      // 抽屉日K区间按波段实际年份算，跨年时从去年 12 月 1 日开始
      const rangeFromYear = Number(rangeFrom.slice(0, 4));
      const rangeFromMonth = Number(rangeFrom.slice(5, 7));
      const rangeToYear = Number(rangeTo.slice(0, 4));
      const rangeToMonth = Number(rangeTo.slice(5, 7));
      const hit: SurgeHit = {
        code: wave.code,
        name: wave.name,
        gainPct: wave.gainPct,
        baseDay: wave.baseDay,
        basePrice: wave.basePrice,
        peakDay: wave.peakDay,
        peakPrice: wave.peakPrice,
        sessions: wave.sessions,
        sector: pickSector(code, sectorIndex, [
          [rangeFrom, rangeTo],
          [wave.windowFrom, wave.windowTo],
          ['0000-00-00', '9999-12-31'],
        ]),
        windowMonth: wave.windowMonth,
        ownerMonth: owner.month,
        ownerNote: owner.note,
        windowFrom: `${rangeFromYear}-${pad(rangeFromMonth)}-01`,
        windowTo: monthEnd(rangeToYear, rangeToMonth),
      };
      const current = byOwner.get(owner.month);
      if (!current || hit.gainPct > current.gainPct) byOwner.set(owner.month, hit);
    }
    for (const [month, hit] of byOwner) {
      const list = monthHits.get(month) ?? [];
      list.push(hit);
      monthHits.set(month, list);
    }
  }

  const lastDay = range?.last_day ?? null;
  const lastDataMonth = lastDay ? Number(lastDay.slice(5, 7)) : 0;
  const prevDecemberRows = (db.prepare(`
    SELECT COUNT(*) AS c FROM daily_kline
    WHERE adjust = ? AND day >= ? AND day <= ? AND low > 0 AND high > 0
  `).get('qfq', prevDecStart, prevDecEnd) as unknown as { c: number }).c;
  let prevDecemberCodes = 0;
  for (const buckets of byCode.values()) {
    if ((buckets[PREV_DEC_BUCKET] ?? []).length > 0) prevDecemberCodes += 1;
  }
  const hasPrevDecember = prevDecemberRows > 0;

  const months: SurgeMonth[] = [];
  for (let month = 1; month <= 12; month += 1) {
    const windowFrom = month > 1
      ? `${query.year}-${pad(month - 1)}-01`
      : prevDecStart;
    const windowTo = monthEnd(query.year, month);
    const hits = (monthHits.get(month) ?? [])
      .sort((a, b) => b.gainPct - a.gainPct || a.code.localeCompare(b.code));
    const actualTo = lastDay && lastDay < windowTo ? lastDay : windowTo;
    const partial = actualTo < windowTo;
    const status = hits.length > 0
      ? 'ok'
      : month > lastDataMonth ? 'upcoming' : 'empty';
    const crossNote = month === 1 && hasPrevDecember
      ? `含去年 12 月 ${prevDecemberRows.toLocaleString()} 根日K（${prevDecemberCodes} 只）`
      : month === 1 ? '库内暂无去年 12 月日K，窗口退化为 1 月单月' : '';
    const note = status === 'upcoming'
      ? `库内数据截至 ${lastDay ?? '—'}，该月尚无数据`
      : status === 'empty'
        ? '该月没有归属的波段'
        : [crossNote, partial ? `数据截至 ${actualTo}` : ''].filter(Boolean).join(' · ');
    months.push({
      month,
      label: `${month}月`,
      windowFrom,
      windowTo,
      prevYearIncluded: month === 1 && hasPrevDecember,
      actualTo,
      partial,
      status,
      note,
      total: hits.length,
      sectorCount: new Set(hits.map((h) => h.sector)).size,
      items: hits,
    });
  }

  const response: SurgeResponse = {
    year: query.year,
    availableYears: surgeYears(),
    threshold: query.threshold,
    basis: query.basis,
    scope: query.scope,
    excludeNew: query.excludeNew,
    excludedNewStocks: query.excludeNew ? newStocks.size : 0,
    firstDay: range?.first_day ?? null,
    lastDay,
    universe: byCode.size,
    rowsScanned: rows.length,
    prevDecemberRows,
    prevDecemberCodes,
    totalHits: months.reduce((sum, m) => sum + m.total, 0),
    duplicatesRemoved: Math.max(0, rawWaves - months.reduce((sum, m) => sum + m.total, 0)),
    months,
    computedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt,
    fromCache: false,
  };
  cache.delete(key);
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, response);
  return { ...response, fromCache: false };
}
