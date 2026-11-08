/**
 * 数据层：Node 22 内置 node:sqlite（DatabaseSync，零外部依赖）。
 * 所有表随模块加载自动创建；写操作用显式事务保证「某日明细」整体替换的原子性。
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR, OUTPUT_DIR } from '../src/config.js';
import type { DayDetail, DetailRow, Overview, TradingDayOverview } from '../src/types.js';
import type {
  DaySummary, DbStats, ImportResult, Job, JobLog, JobStatus, LogLevel,
  KlineAdjust, KlineMark, KlineMultiResponse, KlineParams, KlineProvider, KlineRow, KlineScope,
  KlineSeriesResponse, KlineStats, KlineSymbol, KlineSymbolStatus,
  KlineSymbolsResponse, RowsResult, ScrapeParams, JobMode, TrendPoint,
} from '../shared/types.js';
import { marketOf } from './lib/stockCode.js';

type Bind = null | number | bigint | string;
type SqlRow = Record<string, unknown>;

export const DB_PATH = process.env.KPL_DB_PATH
  ? path.resolve(process.env.KPL_DB_PATH)
  : path.join(DATA_DIR, 'kpl.sqlite');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH, { timeout: 5000 });

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA busy_timeout = 5000;');
db.exec(`
  CREATE TABLE IF NOT EXISTS trading_days (
    day           TEXT PRIMARY KEY,
    strong        INTEGER NOT NULL DEFAULT 0,
    limit_up      INTEGER NOT NULL DEFAULT 0,
    ladder_height INTEGER NOT NULL DEFAULT 0,
    sharp_drop    INTEGER NOT NULL DEFAULT 0,
    synced_at     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS day_details (
    day          TEXT PRIMARY KEY,
    ladder       TEXT NOT NULL DEFAULT '[]',
    limit_count  INTEGER NOT NULL DEFAULT 0,
    broken_count INTEGER NOT NULL DEFAULT 0,
    total_seal   REAL NOT NULL DEFAULT 0,
    avg_seal     REAL NOT NULL DEFAULT 0,
    reason_counts TEXT NOT NULL DEFAULT '{}',
    failures     TEXT NOT NULL DEFAULT '[]',
    row_count    INTEGER NOT NULL DEFAULT 0,
    captured_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS limit_up_rows (
    day          TEXT NOT NULL,
    code         TEXT NOT NULL,
    kind         TEXT NOT NULL,
    name         TEXT NOT NULL DEFAULT '',
    limit_time   TEXT NOT NULL DEFAULT '',
    boards       TEXT NOT NULL DEFAULT '',
    reason       TEXT NOT NULL DEFAULT '',
    reason_count INTEGER NOT NULL DEFAULT 0,
    themes       TEXT NOT NULL DEFAULT '[]',
    sector       TEXT NOT NULL DEFAULT '',
    seal         REAL NOT NULL DEFAULT 0,
    max_seal     REAL NOT NULL DEFAULT 0,
    main_net     REAL NOT NULL DEFAULT 0,
    main_buy     REAL NOT NULL DEFAULT 0,
    main_sell    REAL NOT NULL DEFAULT 0,
    amount       REAL NOT NULL DEFAULT 0,
    float_cap    REAL NOT NULL DEFAULT 0,
    turnover     REAL NOT NULL DEFAULT 0,
    amplitude    REAL NOT NULL DEFAULT 0,
    price        REAL NOT NULL DEFAULT 0,
    change_pct   REAL NOT NULL DEFAULT 0,
    tags         TEXT NOT NULL DEFAULT '[]',
    PRIMARY KEY (day, code, kind)
  );
  CREATE INDEX IF NOT EXISTS idx_rows_day  ON limit_up_rows(day);
  CREATE INDEX IF NOT EXISTS idx_rows_kind ON limit_up_rows(day, kind);

  CREATE TABLE IF NOT EXISTS overviews (
    day         TEXT PRIMARY KEY,
    payload     TEXT NOT NULL,
    ok_count    INTEGER NOT NULL DEFAULT 0,
    fail_count  INTEGER NOT NULL DEFAULT 0,
    captured_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id           TEXT PRIMARY KEY,
    mode         TEXT NOT NULL,
    params       TEXT NOT NULL,
    status       TEXT NOT NULL,
    total        INTEGER NOT NULL DEFAULT 0,
    done         INTEGER NOT NULL DEFAULT 0,
    current_day  TEXT NOT NULL DEFAULT '',
    rows_written INTEGER NOT NULL DEFAULT 0,
    cached_days  INTEGER NOT NULL DEFAULT 0,
    failed_days  TEXT NOT NULL DEFAULT '[]',
    message      TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    finished_at  TEXT
  );

  CREATE TABLE IF NOT EXISTS job_logs (
    seq     INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id  TEXT NOT NULL,
    level   TEXT NOT NULL,
    message TEXT NOT NULL,
    at      TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_logs_job ON job_logs(job_id, seq);

  -- 今年所有触及涨停个股的日K（volume 统一「手」，amount 统一「元」）
  CREATE TABLE IF NOT EXISTS daily_kline (
    code        TEXT NOT NULL,
    day         TEXT NOT NULL,
    adjust      TEXT NOT NULL,
    open        REAL NOT NULL DEFAULT 0,
    high        REAL NOT NULL DEFAULT 0,
    low         REAL NOT NULL DEFAULT 0,
    close       REAL NOT NULL DEFAULT 0,
    volume      REAL NOT NULL DEFAULT 0,
    amount      REAL,
    change_pct  REAL,
    amplitude   REAL,
    turnover    REAL,
    source      TEXT NOT NULL,
    PRIMARY KEY (code, day, adjust)
  );
  CREATE INDEX IF NOT EXISTS idx_kline_code_adj_day ON daily_kline(code, adjust, day);
  CREATE INDEX IF NOT EXISTS idx_kline_day ON daily_kline(day);
  CREATE INDEX IF NOT EXISTS idx_kline_source ON daily_kline(source);

  -- 每只标的的下载状态（断点续抓 / 失败重试 / 前端清单）
  CREATE TABLE IF NOT EXISTS kline_symbols (
    code           TEXT PRIMARY KEY,
    name           TEXT NOT NULL DEFAULT '',
    market         TEXT NOT NULL DEFAULT '',
    limit_days     INTEGER NOT NULL DEFAULT 0,
    touch_days     INTEGER NOT NULL DEFAULT 0,
    last_limit_day TEXT NOT NULL DEFAULT '',
    adjust         TEXT NOT NULL DEFAULT 'qfq',
    source         TEXT,
    status         TEXT NOT NULL DEFAULT 'pending',
    error          TEXT NOT NULL DEFAULT '',
    fetched_at     TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_ksym_status ON kline_symbols(status);

  CREATE INDEX IF NOT EXISTS idx_rows_code_day ON limit_up_rows(code, day);
`);

const now = (): string => new Date().toISOString();
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const json = <T,>(v: unknown, fallback: T): T => {
  const s = str(v);
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

function all<T>(sql: string, ...params: Bind[]): T[] {
  return db.prepare(sql).all(...params) as unknown as T[];
}
function one<T>(sql: string, ...params: Bind[]): T | null {
  const row = db.prepare(sql).get(...params);
  return row ? (row as unknown as T) : null;
}
function scalar(sql: string, ...params: Bind[]): number {
  const row = one<SqlRow>(sql, ...params);
  return row ? num(Object.values(row)[0]) : 0;
}

/* ---------------------------------- 任务 --------------------------------- */

interface JobRow {
  id: string; mode: string; params: string; status: string;
  total: number; done: number; current_day: string;
  rows_written: number; cached_days: number; failed_days: string;
  message: string; created_at: string; updated_at: string; finished_at: string | null;
}

function toJob(r: JobRow): Job {
  return {
    id: r.id,
    mode: r.mode as JobMode,
    params: json<ScrapeParams | KlineParams>(r.params, { mode: 'latest' }),
    status: r.status as JobStatus,
    total: num(r.total),
    done: num(r.done),
    currentDay: str(r.current_day),
    rowsWritten: num(r.rows_written),
    cachedDays: num(r.cached_days),
    failedDays: json<string[]>(r.failed_days, []),
    message: str(r.message),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
    finishedAt: r.finished_at ?? null,
  };
}

export function createJob(params: ScrapeParams | KlineParams, mode?: JobMode): Job {
  const jobMode: JobMode = mode ?? ('mode' in params ? params.mode : 'kline');
  const id = `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const ts = now();
  db.prepare(`
    INSERT INTO jobs (id, mode, params, status, created_at, updated_at)
    VALUES (?, ?, ?, 'queued', ?, ?)
  `).run(id, jobMode, JSON.stringify(params), ts, ts);
  return toJob(one<JobRow>('SELECT * FROM jobs WHERE id = ?', id)!);
}

const JOB_COLUMNS: Record<keyof Partial<Job>, string | null> = {
  status: 'status', total: 'total', done: 'done', currentDay: 'current_day',
  rowsWritten: 'rows_written', cachedDays: 'cached_days',
  failedDays: 'failed_days', message: 'message', finishedAt: 'finished_at',
  id: null, mode: null, params: null, createdAt: null, updatedAt: null,
};

export function updateJob(id: string, patch: Partial<Job>): void {
  const sets: string[] = ['updated_at = ?'];
  const values: Bind[] = [now()];
  for (const [key, value] of Object.entries(patch) as Array<[keyof Job, unknown]>) {
    const column = JOB_COLUMNS[key];
    if (!column || value === undefined) continue;
    sets.push(`${column} = ?`);
    values.push(
      key === 'failedDays' ? JSON.stringify(value)
        : key === 'finishedAt' ? (value === null ? null : str(value))
          : typeof value === 'number' || typeof value === 'string' ? value
            : str(value),
    );
  }
  values.push(id);
  db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function addLog(jobId: string, level: LogLevel, message: string): void {
  db.prepare('INSERT INTO job_logs (job_id, level, message, at) VALUES (?, ?, ?, ?)')
    .run(jobId, level, message, now());
}

export function getLogs(jobId: string, afterSeq = 0, limit = 400): JobLog[] {
  return all<JobLog>(
    'SELECT seq, level, message, at FROM job_logs WHERE job_id = ? AND seq > ? ORDER BY seq LIMIT ?',
    jobId, afterSeq, limit,
  );
}

export function getJob(id: string): Job | null {
  const row = one<JobRow>('SELECT * FROM jobs WHERE id = ?', id);
  return row ? toJob(row) : null;
}

export function listJobs(limit = 20): Job[] {
  return all<JobRow>('SELECT * FROM jobs ORDER BY created_at DESC, rowid DESC LIMIT ?', limit)
    .map(toJob);
}

/** 服务重启后，把未结束的任务标记为中断，避免前端一直转圈 */
export function recoverStaleJobs(): number {
  const row = db.prepare(
    "UPDATE jobs SET status = 'failed', message = '服务重启，任务中断', finished_at = ?, updated_at = ? WHERE status IN ('queued','running')",
  ).run(now(), now());
  return Number(row.changes);
}

/* -------------------------------- 交易日 -------------------------------- */

export function upsertTradingDays(days: TradingDayOverview[]): number {
  if (days.length === 0) return 0;
  const stmt = db.prepare(`
    INSERT INTO trading_days (day, strong, limit_up, ladder_height, sharp_drop, synced_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(day) DO UPDATE SET
      strong = excluded.strong, limit_up = excluded.limit_up,
      ladder_height = excluded.ladder_height, sharp_drop = excluded.sharp_drop,
      synced_at = excluded.synced_at
  `);
  const ts = now();
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const d of days) stmt.run(d.day, d.strong, d.limitUp, d.ladderHeight, d.sharpDrop, ts);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return days.length;
}

/* --------------------------------- 明细 --------------------------------- */

const ROW_INSERT = `
  INSERT OR REPLACE INTO limit_up_rows (
    day, code, kind, name, limit_time, boards, reason, reason_count, themes, sector,
    seal, max_seal, main_net, main_buy, main_sell, amount, float_cap,
    turnover, amplitude, price, change_pct, tags
  ) VALUES (${Array.from({ length: 22 }, () => '?').join(',')})
`;

function bindRow(day: string, r: DetailRow): Bind[] {
  return [
    day, r.code, r.kind, r.name, r.time, r.boards, r.reason, r.reasonCount,
    JSON.stringify(r.themes), r.sector, r.seal, r.maxSeal, r.mainNet,
    r.mainBuy, r.mainSell, r.amount, r.floatCap, r.turnover, r.amplitude,
    r.price, r.change, JSON.stringify(r.tags),
  ];
}

interface DbLimitRow {
  day: string; code: string; kind: string; name: string; limit_time: string;
  boards: string; reason: string; reason_count: number; themes: string; sector: string;
  seal: number; max_seal: number; main_net: number; main_buy: number; main_sell: number;
  amount: number; float_cap: number; turnover: number; amplitude: number;
  price: number; change_pct: number; tags: string;
}

function toDetailRow(r: DbLimitRow): DetailRow {
  return {
    code: str(r.code), name: str(r.name),
    kind: r.kind === 'broken' ? 'broken' : 'limit',
    time: str(r.limit_time), boards: str(r.boards), reason: str(r.reason),
    reasonCount: num(r.reason_count), themes: json<string[]>(r.themes, []),
    sector: str(r.sector), seal: num(r.seal), maxSeal: num(r.max_seal),
    mainNet: num(r.main_net), mainBuy: num(r.main_buy), mainSell: num(r.main_sell),
    amount: num(r.amount), floatCap: num(r.float_cap), turnover: num(r.turnover),
    amplitude: num(r.amplitude), price: num(r.price), change: num(r.change_pct),
    tags: json<string[]>(r.tags, []),
  };
}

/** 整体替换某日明细（先删后插），返回写入行数 */
export function saveDayDetail(detail: DayDetail, failures: string[] = []): number {
  const insertRow = db.prepare(ROW_INSERT);
  const upsertDay = db.prepare(`
    INSERT INTO day_details (
      day, ladder, limit_count, broken_count, total_seal, avg_seal,
      reason_counts, failures, row_count, captured_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(day) DO UPDATE SET
      ladder = excluded.ladder, limit_count = excluded.limit_count,
      broken_count = excluded.broken_count, total_seal = excluded.total_seal,
      avg_seal = excluded.avg_seal, reason_counts = excluded.reason_counts,
      failures = excluded.failures, row_count = excluded.row_count,
      captured_at = excluded.captured_at
  `);
  const ts = now();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM limit_up_rows WHERE day = ?').run(detail.day);
    for (const r of detail.rows) insertRow.run(...bindRow(detail.day, r));
    upsertDay.run(
      detail.day, JSON.stringify(detail.ladder),
      detail.stats.limitCount, detail.stats.brokenCount,
      detail.stats.totalSeal, detail.stats.avgSeal,
      JSON.stringify(detail.stats.reasonCounts), JSON.stringify(failures),
      detail.rows.length, ts,
    );
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return detail.rows.length;
}

export function hasDay(day: string): boolean {
  return scalar('SELECT row_count FROM day_details WHERE day = ?', day) > 0;
}

export function dayRowCount(day: string): number {
  return scalar('SELECT row_count FROM day_details WHERE day = ?', day);
}

interface DayDetailRow {
  day: string; ladder: string; limit_count: number; broken_count: number;
  total_seal: number; avg_seal: number; reason_counts: string;
  failures: string; row_count: number; captured_at: string;
}

export function getDayDetail(day: string): { detail: DayDetail; capturedAt: string } | null {
  const head = one<DayDetailRow>('SELECT * FROM day_details WHERE day = ?', day);
  if (!head) return null;
  const rows = all<DbLimitRow>(
    `SELECT * FROM limit_up_rows WHERE day = ?
     ORDER BY CASE kind WHEN 'limit' THEN 0 ELSE 1 END, limit_time, seal DESC`,
    day,
  ).map(toDetailRow);
  return {
    detail: {
      day,
      ladder: json<number[]>(head.ladder, []),
      rows,
      stats: {
        limitCount: num(head.limit_count),
        brokenCount: num(head.broken_count),
        totalSeal: num(head.total_seal),
        avgSeal: num(head.avg_seal),
        reasonCounts: json<Record<string, number>>(head.reason_counts, {}),
      },
    },
    capturedAt: str(head.captured_at),
  };
}

export function saveOverview(day: string, overview: Overview, okCount: number, failCount: number): void {
  db.prepare(`
    INSERT INTO overviews (day, payload, ok_count, fail_count, captured_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(day) DO UPDATE SET
      payload = excluded.payload, ok_count = excluded.ok_count,
      fail_count = excluded.fail_count, captured_at = excluded.captured_at
  `).run(day, JSON.stringify(overview), okCount, failCount, now());
}

export function getOverview(day: string): Overview | null {
  const row = one<{ payload: string }>('SELECT payload FROM overviews WHERE day = ?', day);
  return row ? json<Overview | null>(row.payload, null) : null;
}

/* --------------------------------- 查询 --------------------------------- */

export function listDaySummaries(): DaySummary[] {
  interface SummaryRow {
    day: string; limit_count: number; broken_count: number; total_seal: number;
    avg_seal: number; row_count: number; captured_at: string; failures: string;
    has_overview: number;
  }
  return all<SummaryRow>(`
    SELECT d.*, CASE WHEN o.day IS NULL THEN 0 ELSE 1 END AS has_overview
    FROM day_details d LEFT JOIN overviews o ON o.day = d.day
    ORDER BY d.day DESC
  `).map((r) => ({
    day: str(r.day),
    limitCount: num(r.limit_count),
    brokenCount: num(r.broken_count),
    totalSeal: num(r.total_seal),
    avgSeal: num(r.avg_seal),
    rowCount: num(r.row_count),
    capturedAt: str(r.captured_at),
    hasOverview: num(r.has_overview) > 0,
    failures: json<string[]>(r.failures, []),
  }));
}

const SORT_COLUMNS: Record<string, string> = {
  code: 'code', name: 'name', kind: 'kind', time: 'limit_time',
  boards: 'boards', reason: 'reason', seal: 'seal', maxSeal: 'max_seal',
  mainNet: 'main_net', amount: 'amount', floatCap: 'float_cap',
  turnover: 'turnover', amplitude: 'amplitude', price: 'price', change: 'change_pct',
};

export function queryRows(options: {
  day: string; kind?: string; q?: string;
  sort?: string; dir?: 'asc' | 'desc'; limit?: number; offset?: number;
}): RowsResult {
  const where: string[] = ['day = ?'];
  const binds: Bind[] = [options.day];
  if (options.kind === 'limit' || options.kind === 'broken') {
    where.push('kind = ?');
    binds.push(options.kind);
  }
  if (options.q) {
    where.push('(code LIKE ? OR name LIKE ? OR reason LIKE ? OR themes LIKE ? OR sector LIKE ?)');
    const like = `%${options.q}%`;
    binds.push(like, like, like, like, like);
  }
  const clause = `WHERE ${where.join(' AND ')}`;
  const total = scalar(`SELECT COUNT(*) AS c FROM limit_up_rows ${clause}`, ...binds);
  const col = SORT_COLUMNS[options.sort ?? ''] ?? null;
  const dir = options.dir === 'desc' ? 'DESC' : 'ASC';
  const order = col
    ? `ORDER BY ${col} ${dir}, code ASC`
    : `ORDER BY CASE kind WHEN 'limit' THEN 0 ELSE 1 END, limit_time ASC, seal DESC`;
  const limit = Math.max(1, Math.min(500, options.limit ?? 100));
  const offset = Math.max(0, options.offset ?? 0);
  const rows = all<DbLimitRow>(
    `SELECT * FROM limit_up_rows ${clause} ${order} LIMIT ? OFFSET ?`,
    ...binds, limit, offset,
  ).map(toDetailRow);
  return { rows, total, limit, offset };
}

export function getTrendPoints(limit = 60): TrendPoint[] {
  const hasTradingDays = scalar('SELECT COUNT(*) AS c FROM trading_days') > 0;
  if (hasTradingDays) {
    interface T {
      day: string; strong: number; limit_up: number; ladder_height: number;
      sharp_drop: number; scraped: number;
    }
    const rows = all<T>(`
      SELECT t.day, t.strong, t.limit_up, t.ladder_height, t.sharp_drop,
             CASE WHEN d.day IS NULL THEN 0 ELSE 1 END AS scraped
      FROM trading_days t LEFT JOIN day_details d ON d.day = t.day
      ORDER BY t.day DESC LIMIT ?
    `, limit);
    return rows.reverse().map((r) => ({
      day: str(r.day), strong: num(r.strong), limitUp: num(r.limit_up),
      ladderHeight: num(r.ladder_height), sharpDrop: num(r.sharp_drop),
      scraped: num(r.scraped) > 0,
    }));
  }
  interface F { day: string; limit_count: number; }
  return all<F>(`
    SELECT day, limit_count FROM day_details ORDER BY day DESC LIMIT ?
  `, limit).reverse().map((r) => ({
    day: str(r.day), strong: 0, limitUp: num(r.limit_count),
    ladderHeight: 0, sharpDrop: 0, scraped: true,
  }));
}

export function getStats(): DbStats {
  interface ReasonRow { reason: string; c: number; }
  return {
    dbPath: DB_PATH,
    days: scalar('SELECT COUNT(*) AS c FROM day_details WHERE row_count > 0'),
    rows: scalar('SELECT COUNT(*) AS c FROM limit_up_rows'),
    limitUp: scalar("SELECT COUNT(*) AS c FROM limit_up_rows WHERE kind = 'limit'"),
    broken: scalar("SELECT COUNT(*) AS c FROM limit_up_rows WHERE kind = 'broken'"),
    tradingDays: scalar('SELECT COUNT(*) AS c FROM trading_days'),
    overviews: scalar('SELECT COUNT(*) AS c FROM overviews'),
    totalSeal: scalar("SELECT COALESCE(SUM(seal), 0) AS c FROM limit_up_rows WHERE kind = 'limit'"),
    firstDay: one<{ d: string }>('SELECT MIN(day) AS d FROM day_details')?.d ?? null,
    latestDay: one<{ d: string }>('SELECT MAX(day) AS d FROM day_details')?.d ?? null,
    topReasons: all<ReasonRow>(`
      SELECT reason, COUNT(*) AS c FROM limit_up_rows
      WHERE kind = 'limit' AND reason <> ''
      GROUP BY reason ORDER BY c DESC, reason LIMIT 10
    `).map((r) => ({ reason: str(r.reason), count: num(r.c) })),
    jobsTotal: scalar('SELECT COUNT(*) AS c FROM jobs'),
    jobsRunning: scalar("SELECT COUNT(*) AS c FROM jobs WHERE status IN ('queued','running')"),
  };
}

/* --------------------------- 导入既有逐日 JSON 缓存 --------------------------- */

export function importCache(force = false): ImportResult {
  const cacheDir = path.join(OUTPUT_DIR, 'cache');
  const files = fs.existsSync(cacheDir)
    ? fs.readdirSync(cacheDir).filter((f) => /^day-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
    : [];
  let imported = 0;
  let skipped = 0;
  let rows = 0;
  for (const file of files) {
    const day = file.slice(4, 14);
    if (!force && hasDay(day)) {
      skipped += 1;
      continue;
    }
    try {
      const detail = JSON.parse(fs.readFileSync(path.join(cacheDir, file), 'utf8')) as DayDetail;
      if (!detail || detail.day !== day || !Array.isArray(detail.rows) || detail.rows.length === 0) {
        skipped += 1;
        continue;
      }
      rows += saveDayDetail(detail);
      imported += 1;
    } catch {
      skipped += 1;
    }
  }

  if (fs.existsSync(OUTPUT_DIR)) {
    for (const file of fs.readdirSync(OUTPUT_DIR).filter((f) => /^year-.*\.json$/.test(f))) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, file), 'utf8')) as {
          tradingDays?: TradingDayOverview[];
        };
        if (Array.isArray(data.tradingDays)) upsertTradingDays(data.tradingDays);
      } catch {
        // 非本项目的 year-*.json 忽略
      }
    }
  }
  // 多个 year-*.json 可能重叠，返回去重后的交易日总数
  const tradingDays = scalar('SELECT COUNT(*) AS c FROM trading_days');
  return { imported, skipped, rows, tradingDays, cacheFiles: files.length };
}

export function listTradingDays(limit = 2000): TradingDayOverview[] {
  interface T { day: string; strong: number; limit_up: number; ladder_height: number; sharp_drop: number; }
  return all<T>(`
    SELECT day, strong, limit_up, ladder_height, sharp_drop
    FROM trading_days ORDER BY day DESC LIMIT ?
  `, limit).map((r) => ({
    day: str(r.day), strong: num(r.strong), limitUp: num(r.limit_up),
    ladderHeight: num(r.ladder_height), sharpDrop: num(r.sharp_drop),
  }));
}

export function allRowsForDay(day: string, kind?: string): DetailRow[] {
  const sql = kind === 'limit' || kind === 'broken'
    ? `SELECT * FROM limit_up_rows WHERE day = ? AND kind = ?
       ORDER BY CASE kind WHEN 'limit' THEN 0 ELSE 1 END, limit_time, seal DESC`
    : `SELECT * FROM limit_up_rows WHERE day = ?
       ORDER BY CASE kind WHEN 'limit' THEN 0 ELSE 1 END, limit_time, seal DESC`;
  const rows = kind === 'limit' || kind === 'broken'
    ? all<DbLimitRow>(sql, day, kind)
    : all<DbLimitRow>(sql, day);
  return rows.map(toDetailRow);
}

export function latestTradingDay(): string | null {
  return one<{ d: string }>('SELECT MAX(day) AS d FROM trading_days')?.d ?? null;
}

/* ----------------------------- 日K标的池 ----------------------------- */

export interface KlineTarget {
  code: string;
  name: string;
  market: ReturnType<typeof marketOf>;
  limitDays: number;
  touchDays: number;
  lastLimitDay: string;
}

/**
 * 从涨停明细里聚合「今年触及过涨停」的个股。
 * scope=limit 仅收盘涨停；scope=all 含盘中触板后破板。
 * 名称取该股区间内最新一天的 name（ST 摘帽/戴帽后会更新）。
 */
export function klineTargetSymbols(scope: KlineScope, from: string, to: string): KlineTarget[] {
  interface TargetRow {
    code: string; name: string; limit_days: number; touch_days: number; last_limit_day: string;
  }
  const rows = all<TargetRow>(`
    WITH agg AS (
      SELECT code,
             SUM(CASE WHEN kind = 'limit' THEN 1 ELSE 0 END) AS limit_days,
             COUNT(*) AS touch_days,
             MAX(CASE WHEN kind = 'limit' THEN day ELSE '' END) AS last_limit_day
      FROM limit_up_rows WHERE day >= ? AND day <= ? GROUP BY code
    ),
    names AS (
      SELECT code, name,
             ROW_NUMBER() OVER (PARTITION BY code ORDER BY day DESC, rowid DESC) AS rn
      FROM limit_up_rows WHERE day >= ? AND day <= ?
    )
    SELECT a.code, COALESCE(n.name, '') AS name, a.limit_days, a.touch_days, a.last_limit_day
    FROM agg a LEFT JOIN names n ON n.code = a.code AND n.rn = 1
    WHERE ? = 'all' OR a.limit_days > 0
    ORDER BY a.touch_days DESC, a.code
  `, from, to, from, to, scope);
  return rows.map((r) => ({
    code: str(r.code), name: str(r.name), market: marketOf(str(r.code)),
    limitDays: num(r.limit_days), touchDays: num(r.touch_days),
    lastLimitDay: str(r.last_limit_day),
  }));
}

/** 初始化/刷新标的元数据，保留已有下载状态与来源（不打断断点续抓） */
export function upsertKlineTargets(targets: KlineTarget[], adjust: KlineAdjust): number {
  if (targets.length === 0) return 0;
  const stmt = db.prepare(`
    INSERT INTO kline_symbols
      (code, name, market, limit_days, touch_days, last_limit_day, adjust, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    ON CONFLICT(code) DO UPDATE SET
      name = excluded.name, market = excluded.market,
      limit_days = excluded.limit_days, touch_days = excluded.touch_days,
      last_limit_day = excluded.last_limit_day
  `);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const t of targets) {
      stmt.run(t.code, t.name, t.market, t.limitDays, t.touchDays, t.lastLimitDay, adjust);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return targets.length;
}

export interface KlineSymbolState {
  code: string;
  status: KlineSymbolStatus;
  adjust: string;
  fetchedAt: string | null;
}

export function klineSymbolStates(): Map<string, KlineSymbolState> {
  interface S { code: string; status: string; adjust: string; fetched_at: string | null; }
  const map = new Map<string, KlineSymbolState>();
  for (const r of all<S>('SELECT code, status, adjust, fetched_at FROM kline_symbols')) {
    map.set(str(r.code), {
      code: str(r.code), status: str(r.status) as KlineSymbolStatus,
      adjust: str(r.adjust), fetchedAt: r.fetched_at ?? null,
    });
  }
  return map;
}

/**
 * 整体替换某只票某个复权口径的全区间日K，并同步标的下载状态。
 * 用显式事务，避免中途失败留下半截数据。
 */
export function saveKlineSeries(options: {
  code: string;
  adjust: KlineAdjust;
  source: KlineProvider;
  rows: KlineRow[];
  status: KlineSymbolStatus;
  error?: string;
  /** 行情源返回的最新名称，用于修正 ST 摘帽/更名 */
  name?: string;
}): number {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO daily_kline
      (code, day, adjust, open, high, low, close, volume,
       amount, change_pct, amplitude, turnover, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const ts = now();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM daily_kline WHERE code = ? AND adjust = ?')
      .run(options.code, options.adjust);
    for (const r of options.rows) {
      insert.run(
        r.code, r.day, r.adjust, r.open, r.high, r.low, r.close, r.volume,
        r.amount, r.changePct, r.amplitude, r.turnover, r.source,
      );
    }
    const nameSet = options.name ? ', name = ?' : '';
    const nameBind = options.name ? [options.name] : [];
    db.prepare(`
      UPDATE kline_symbols
      SET adjust = ?, source = ?, status = ?, error = ?, fetched_at = ?${nameSet}
      WHERE code = ?
    `).run(
      options.adjust,
      options.rows.length > 0 ? options.source : null,
      options.status, options.error ?? '', options.status === 'ok' ? ts : null,
      ...nameBind, options.code,
    );
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return options.rows.length;
}

/** 标记失败/空数据（不删除已入库的历史K线） */
export function markKlineSymbol(
  code: string, status: KlineSymbolStatus, error: string, adjust: KlineAdjust,
): void {
  db.prepare(`
    UPDATE kline_symbols
    SET status = ?, error = ?, adjust = ?, fetched_at = NULL WHERE code = ?
  `).run(status, error, adjust, code);
}

export function getKlineStats(scope: KlineScope = 'all'): KlineStats {
  const year = `${new Date().getFullYear()}`;
  interface GroupRow { k: string; c: number; }
  return {
    targetSymbols: klineTargetSymbols(scope, `${year}-01-01`, `${year}-12-31`).length,
    symbols: scalar('SELECT COUNT(*) AS c FROM kline_symbols'),
    okSymbols: scalar("SELECT COUNT(*) AS c FROM kline_symbols WHERE status = 'ok'"),
    failedSymbols: scalar("SELECT COUNT(*) AS c FROM kline_symbols WHERE status = 'failed'"),
    rows: scalar('SELECT COUNT(*) AS c FROM daily_kline'),
    firstDay: one<{ d: string }>('SELECT MIN(day) AS d FROM daily_kline')?.d ?? null,
    lastDay: one<{ d: string }>('SELECT MAX(day) AS d FROM daily_kline')?.d ?? null,
    bySource: all<GroupRow>(`
      SELECT source AS k, COUNT(*) AS c FROM daily_kline GROUP BY source ORDER BY c DESC
    `).map((r) => ({ source: str(r.k), rows: num(r.c) })),
    byAdjust: all<GroupRow>(`
      SELECT adjust AS k, COUNT(*) AS c FROM daily_kline GROUP BY adjust ORDER BY c DESC
    `).map((r) => ({ adjust: str(r.k), rows: num(r.c) })),
    byMarket: all<GroupRow>(`
      SELECT market AS k, COUNT(*) AS c FROM kline_symbols GROUP BY market ORDER BY c DESC
    `).map((r) => ({ market: str(r.k), symbols: num(r.c) })),
    lastFetchedAt: one<{ d: string }>('SELECT MAX(fetched_at) AS d FROM kline_symbols')?.d ?? null,
  };
}

export function listKlineSymbols(options: {
  q?: string; status?: string; limit?: number; offset?: number;
}): KlineSymbolsResponse {
  const where: string[] = [];
  const binds: Bind[] = [];
  if (options.q) {
    where.push('(code LIKE ? OR name LIKE ?)');
    const like = `%${options.q}%`;
    binds.push(like, like);
  }
  if (options.status === 'ok' || options.status === 'failed' || options.status === 'pending' || options.status === 'empty') {
    where.push('status = ?');
    binds.push(options.status);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = scalar(`SELECT COUNT(*) AS c FROM kline_symbols ${clause}`, ...binds);
  const limit = Math.max(1, Math.min(500, options.limit ?? 50));
  const offset = Math.max(0, options.offset ?? 0);
  interface R {
    code: string; name: string; market: string; limit_days: number; touch_days: number;
    last_limit_day: string; adjust: string; source: string | null; status: string;
    error: string; fetched_at: string | null; krows: number;
    first_day: string | null; last_day: string | null;
  }
  // 相关子查询 + (code, adjust, day) 索引，只算当前页标的，避免全表 GROUP BY
  const rows = all<R>(`
    SELECT p.*,
      (SELECT COUNT(*) FROM daily_kline k WHERE k.code = p.code AND k.adjust = p.adjust) AS krows,
      (SELECT MIN(day) FROM daily_kline k WHERE k.code = p.code AND k.adjust = p.adjust) AS first_day,
      (SELECT MAX(day) FROM daily_kline k WHERE k.code = p.code AND k.adjust = p.adjust) AS last_day
    FROM (SELECT * FROM kline_symbols ${clause}
          ORDER BY touch_days DESC, code LIMIT ? OFFSET ?) p
  `, ...binds, limit, offset).map((r): KlineSymbol => ({
    code: str(r.code), name: str(r.name),
    market: (['sh', 'sz', 'bj'].includes(str(r.market)) ? str(r.market) : 'sz') as KlineSymbol['market'],
    limitDays: num(r.limit_days), touchDays: num(r.touch_days),
    lastLimitDay: str(r.last_limit_day), rows: num(r.krows),
    firstDay: r.first_day ?? null, lastDay: r.last_day ?? null,
    adjust: (str(r.adjust) || 'qfq') as KlineAdjust,
    source: (r.source === 'tencent' || r.source === 'eastmoney') ? r.source : null,
    status: str(r.status) as KlineSymbolStatus, error: str(r.error),
    fetchedAt: r.fetched_at ?? null,
  }));
  return { symbols: rows, total, limit, offset };
}

export function getKlineMarks(code: string, from: string, to: string): KlineMark[] {
  interface M { day: string; kind: string; reason: string; }
  return all<M>(`
    SELECT day, kind, reason FROM limit_up_rows
    WHERE code = ? AND day >= ? AND day <= ? ORDER BY day
  `, code, from, to).map((r) => ({
    day: str(r.day), kind: r.kind === 'broken' ? 'broken' as const : 'limit' as const,
    reason: str(r.reason),
  }));
}

export function getKlineSeries(options: {
  code: string; adjust: KlineAdjust; from?: string; to?: string;
  limit: number; offset: number;
}): KlineSeriesResponse {
  interface R {
    code: string; day: string; open: number; high: number; low: number; close: number;
    volume: number; amount: number | null; change_pct: number | null;
    amplitude: number | null; turnover: number | null; source: string; adjust: string;
  }
  const where: string[] = ['code = ?', 'adjust = ?'];
  const binds: Bind[] = [options.code, options.adjust];
  if (options.from) { where.push('day >= ?'); binds.push(options.from); }
  if (options.to) { where.push('day <= ?'); binds.push(options.to); }
  const clause = `WHERE ${where.join(' AND ')}`;
  const total = scalar(`SELECT COUNT(*) AS c FROM daily_kline ${clause}`, ...binds);
  const rows = all<R>(`
    SELECT * FROM daily_kline ${clause} ORDER BY day DESC LIMIT ? OFFSET ?
  `, ...binds, options.limit, options.offset).map((r): KlineRow => ({
    code: str(r.code), day: str(r.day),
    open: num(r.open), high: num(r.high), low: num(r.low), close: num(r.close),
    volume: num(r.volume),
    amount: r.amount === null ? null : num(r.amount),
    changePct: r.change_pct === null ? null : num(r.change_pct),
    amplitude: r.amplitude === null ? null : num(r.amplitude),
    turnover: r.turnover === null ? null : num(r.turnover),
    source: r.source === 'eastmoney' ? 'eastmoney' : 'tencent',
    adjust: str(r.adjust) as KlineAdjust,
  }));
  const symbol = one<{ name: string }>('SELECT name FROM kline_symbols WHERE code = ?', options.code);
  return {
    code: options.code, name: symbol ? str(symbol.name) : '',
    adjust: options.adjust, rows, total,
    marks: getKlineMarks(options.code, options.from ?? '0000-00-00', options.to ?? '9999-12-31'),
  };
}

/** CSV 导出用：按日期升序返回某只票全部日K */
export function allKlineRows(code: string, adjust: KlineAdjust): KlineRow[] {
  const result = getKlineSeries({ code, adjust, limit: 10_000, offset: 0 });
  return [...result.rows].reverse();
}

/** 批量取多只票的涨停/破板标记（板块叠加图用） */
export function getKlineMarksMulti(codes: string[], from: string, to: string): Map<string, KlineMark[]> {
  const map = new Map<string, KlineMark[]>();
  if (codes.length === 0) return map;
  const placeholders = codes.map(() => '?').join(',');
  interface M { code: string; day: string; kind: string; reason: string; }
  for (const r of all<M>(`
    SELECT code, day, kind, reason FROM limit_up_rows
    WHERE code IN (${placeholders}) AND day >= ? AND day <= ? ORDER BY day
  `, ...codes, from, to)) {
    const list = map.get(r.code) ?? [];
    list.push({
      day: str(r.day),
      kind: str(r.kind) === 'broken' ? 'broken' : 'limit',
      reason: str(r.reason),
    });
    map.set(r.code, list);
  }
  return map;
}

/**
 * 一次取出多只票在窗口内的前复权日K（板块叠加图用）。
 * 返回的 rows 按日期升序；缺数据的票也会给出空数组占位，保证与 codes 一一对应。
 */
export function getKlineSeriesMulti(options: {
  codes: string[]; adjust: KlineAdjust; from: string; to: string;
}): KlineMultiResponse {
  const codes = [...new Set(options.codes)].filter((c) => /^\d{6}$/.test(c)).slice(0, 300);
  if (codes.length === 0) {
    return { codes: [], from: options.from, to: options.to, series: [] };
  }
  const placeholders = codes.map(() => '?').join(',');
  interface R {
    code: string; day: string; open: number; high: number; low: number; close: number;
    volume: number; amount: number | null; change_pct: number | null;
    amplitude: number | null; turnover: number | null; source: string; adjust: string;
  }
  const raw = all<R>(`
    SELECT * FROM daily_kline
    WHERE code IN (${placeholders}) AND adjust = ? AND day >= ? AND day <= ?
    ORDER BY code, day ASC
  `, ...codes, options.adjust, options.from, options.to);

  const byCode = new Map<string, KlineRow[]>();
  for (const r of raw) {
    const list = byCode.get(r.code) ?? [];
    list.push({
      code: str(r.code), day: str(r.day),
      open: num(r.open), high: num(r.high), low: num(r.low), close: num(r.close),
      volume: num(r.volume),
      amount: r.amount === null ? null : num(r.amount),
      changePct: r.change_pct === null ? null : num(r.change_pct),
      amplitude: r.amplitude === null ? null : num(r.amplitude),
      turnover: r.turnover === null ? null : num(r.turnover),
      source: r.source === 'eastmoney' ? 'eastmoney' : 'tencent',
      adjust: str(r.adjust) as KlineAdjust,
    });
    byCode.set(r.code, list);
  }

  const names = new Map(all<{ code: string; name: string }>(
    `SELECT code, name FROM kline_symbols WHERE code IN (${placeholders})`,
    ...codes,
  ).map((r) => [str(r.code), str(r.name)]));
  const marks = getKlineMarksMulti(codes, options.from, options.to);

  return {
    codes,
    from: options.from,
    to: options.to,
    series: codes.map((code) => {
      const rows = byCode.get(code) ?? [];
      return {
        code,
        name: names.get(code) ?? '',
        adjust: options.adjust,
        rows,
        total: rows.length,
        marks: marks.get(code) ?? [],
      };
    }),
  };
}

export function getKlineSymbolName(code: string): string {
  return one<{ name: string }>('SELECT name FROM kline_symbols WHERE code = ?', code)?.name ?? '';
}

export function closeDb(): void {
  if (db.isOpen) db.close();
}
