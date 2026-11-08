/** 前后端共用的 API 契约类型（纯类型，运行时会被擦除） */
import type { DetailRow, Overview } from '../src/types.js';

export type {
  DayDetail,
  DetailRow,
  LimitUpRow,
  Overview,
  TradingDayOverview,
  HistoryPoint,
} from '../src/types.js';

export type JobStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled';
export type ScrapeMode = 'latest' | 'day' | 'range';
/** 涨停明细抓取任务沿用 ScrapeMode；日K批量下载任务为 kline */
export type JobMode = ScrapeMode | 'kline';

export interface ScrapeParams {
  /** latest=接口返回的最后一个交易日；day=指定日期；range=日期区间批量回溯 */
  mode: ScrapeMode;
  day?: string;
  from?: string;
  to?: string;
  /** 忽略库中已有数据，重新请求接口 */
  force?: boolean;
  /** 区间抓取并发数 1-8 */
  concurrency?: number;
  /** 是否同时抓取当日市场情绪概览接口 */
  withOverview?: boolean;
}

export interface Job {
  id: string;
  mode: JobMode;
  params: ScrapeParams | KlineParams;
  status: JobStatus;
  total: number;
  done: number;
  currentDay: string;
  rowsWritten: number;
  cachedDays: number;
  failedDays: string[];
  message: string;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export type LogLevel = 'info' | 'ok' | 'warn' | 'error';

export interface JobLog {
  seq: number;
  level: LogLevel;
  message: string;
  at: string;
}

export interface JobView {
  job: Job;
  logs: JobLog[];
}

export interface DaySummary {
  day: string;
  limitCount: number;
  brokenCount: number;
  totalSeal: number;
  avgSeal: number;
  rowCount: number;
  capturedAt: string;
  hasOverview: boolean;
  failures: string[];
}

export interface DayDetailResponse {
  day: string;
  detail: {
    day: string;
    ladder: number[];
    rows: DetailRow[];
    stats: {
      limitCount: number;
      brokenCount: number;
      totalSeal: number;
      avgSeal: number;
      reasonCounts: Record<string, number>;
    };
  };
  overview: Overview | null;
  capturedAt: string;
}

export interface TrendPoint {
  day: string;
  strong: number;
  limitUp: number;
  ladderHeight: number;
  sharpDrop: number;
  scraped: boolean;
}

export interface DbStats {
  dbPath: string;
  days: number;
  rows: number;
  limitUp: number;
  broken: number;
  tradingDays: number;
  overviews: number;
  totalSeal: number;
  firstDay: string | null;
  latestDay: string | null;
  topReasons: Array<{ reason: string; count: number }>;
  jobsTotal: number;
  jobsRunning: number;
}

export interface RowsResult {
  rows: DetailRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface Health {
  ok: boolean;
  node: string;
  sqlite: string;
  dbPath: string;
  activeJobId: string | null;
  now: string;
  klineRows: number;
  klineSymbols: number;
  klineTargetSymbols: number;
}

export interface ConfigInfo {
  apiBase: string;
  defaultDay: string;
  version: string;
  cacheDir: string;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  rows: number;
  tradingDays: number;
  cacheFiles: number;
}

export interface ApiError {
  error: string;
}

/* ------------------------------ 今年日K数据 ------------------------------ */

/** auto=腾讯优先（北交所与失败自动切东财）；tencent/eastmoney=严格单源 */
export type KlineSource = 'auto' | 'tencent' | 'eastmoney';
/** qfq=前复权 hfq=后复权 none=不复权（原始价格） */
export type KlineAdjust = 'qfq' | 'hfq' | 'none';
/** limit=仅今年收盘涨停过的票；all=含盘中触板后破板的票 */
export type KlineScope = 'limit' | 'all';
export type KlineProvider = 'tencent' | 'eastmoney';
export type KlineSymbolStatus = 'pending' | 'ok' | 'empty' | 'failed';

export interface KlineParams {
  /** 日K起始日，默认今年 01-01 */
  from: string;
  /** 日K截止日，默认今天 */
  to: string;
  /** 标的池范围，默认 all（今年所有触及涨停的个股） */
  scope: KlineScope;
  source: KlineSource;
  adjust: KlineAdjust;
  /** 已抓过的票也重新请求并覆盖 */
  force: boolean;
  /** 只补状态非 ok 的票（断点续抓） */
  onlyMissing: boolean;
  /** 并发数 1-10 */
  concurrency: number;
  /** 可选：仅抓指定代码，便于失败重试与抽样验证 */
  codes?: string[];
}

/** 一根日K。volume 统一为「手」，amount 统一为「元」；腾讯源无成交额时为 null */
export interface KlineRow {
  code: string;
  day: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number | null;
  changePct: number | null;
  amplitude: number | null;
  turnover: number | null;
  source: KlineProvider;
  adjust: KlineAdjust;
}

export interface KlineSymbol {
  code: string;
  name: string;
  market: 'sh' | 'sz' | 'bj';
  /** 今年收盘涨停天数 */
  limitDays: number;
  /** 今年盘中触板（涨停+破板）天数 */
  touchDays: number;
  lastLimitDay: string;
  rows: number;
  firstDay: string | null;
  lastDay: string | null;
  adjust: KlineAdjust;
  source: KlineProvider | null;
  status: KlineSymbolStatus;
  error: string;
  fetchedAt: string | null;
}

export interface KlineStats {
  /** 标的池内今年应覆盖的股票数 */
  targetSymbols: number;
  symbols: number;
  okSymbols: number;
  failedSymbols: number;
  rows: number;
  firstDay: string | null;
  lastDay: string | null;
  bySource: Array<{ source: string; rows: number }>;
  byAdjust: Array<{ adjust: string; rows: number }>;
  byMarket: Array<{ market: string; symbols: number }>;
  lastFetchedAt: string | null;
}

export interface KlineMark {
  day: string;
  kind: 'limit' | 'broken';
  reason: string;
}

export interface KlineSeriesResponse {
  code: string;
  name: string;
  adjust: KlineAdjust;
  rows: KlineRow[];
  total: number;
  /** 该股今年涨停/破板日期，用于在K线图上打标记 */
  marks: KlineMark[];
}

export interface KlineSymbolsResponse {
  symbols: KlineSymbol[];
  total: number;
  limit: number;
  offset: number;
}

/** 多只票在同窗口内的日K：板块叠加图用 */
export interface KlineMultiResponse {
  /** 请求的代码（去重后） */
  codes: string[];
  from: string;
  to: string;
  /**
   * 每只票一条序列。注意 series[].rows 按日期【升序】，
   * 与单股接口 /api/kline/series 的降序相反。
   */
  series: KlineSeriesResponse[];
}

/* ------------------- 月度「自最低点涨幅达标」统计 ------------------- */

/** low-high=最低价→其后最高价（默认）；close=收盘价口径；range=窗口内最高/最低不限先后 */
export type SurgeBasis = 'low-high' | 'close' | 'range';
/** all=全部今年触板股；limit=仅收盘涨停过的票 */
export type SurgeScope = 'all' | 'limit';
export type SurgeMonthStatus = 'ok' | 'upcoming' | 'empty';

export interface SurgeHit {
  code: string;
  name: string;
  /** 涨幅百分比，例如 62.35 表示 +62.35% */
  gainPct: number;
  baseDay: string;
  basePrice: number;
  peakDay: string;
  peakPrice: number;
  /** 低点到高点跨越的交易日根数（含首尾） */
  sessions: number;
  /** 归类板块（涨停明细 sector 的众数） */
  sector: string;
  /** 产生该波段的滑动窗口月份 */
  windowMonth: number;
  /** 归属月份：低点/高点同月取该月，跨月取月内振幅更大的月 */
  ownerMonth: number;
  /** 归属依据说明 */
  ownerNote: string;
  /** 波段涉及月份范围，供详情抽屉读取日K */
  windowFrom: string;
  windowTo: string;
}

export interface SurgeMonth {
  month: number;
  label: string;
  /** 该月的滑动统计窗口：上月 1 日 ~ 当月末（1 月为去年 12 月 1 日 ~ 1 月末） */
  windowFrom: string;
  windowTo: string;
  /** 1 月窗口是否真的拿到了去年 12 月的日K */
  prevYearIncluded: boolean;
  /** 窗口内库里实际有数据的最后一天 */
  actualTo: string;
  /** 数据未覆盖到月末（当月进行中） */
  partial: boolean;
  status: SurgeMonthStatus;
  note: string;
  /** 归属到该月的命中数（= items.length，已去重） */
  total: number;
  /** 板块分组数 */
  sectorCount: number;
  items: SurgeHit[];
}

export interface SurgeResponse {
  year: number;
  availableYears: number[];
  threshold: number;
  basis: SurgeBasis;
  scope: SurgeScope;
  excludeNew: boolean;
  /** 整只排除的今年新上市股票数 */
  excludedNewStocks: number;
  firstDay: string | null;
  lastDay: string | null;
  /** 参与统计的股票数（已排除新股） */
  universe: number;
  rowsScanned: number;
  /** 补进来的去年 12 月日K根数 / 覆盖股票数（0 表示库里还没有去年 12 月数据） */
  prevDecemberRows: number;
  prevDecemberCodes: number;
  /** 去重后 12 列合计命中数 */
  totalHits: number;
  /** 因同波重复 / 同月重复而合并掉的次数 */
  duplicatesRemoved: number;
  months: SurgeMonth[];
  computedAt: string;
  elapsedMs: number;
  fromCache: boolean;
}
