/** 涨停个股明细（「市场情绪 → 涨停表现 → 更多」列表的一行） */
export interface LimitUpRow {
  code: string;
  name: string;
  time: string;
  boardNote: string;
  reason: string;
  reasonCount: number;
  sealText: string;
  sealWan: number;
  tags: string[];
}

export interface HistoryPoint {
  day: string;
  strong: number;
  limitUp: number;
  ladderHeight: number;
  sharpDrop: number;
}

export interface BrokenBoardPoint {
  day: string;
  broken: number;
  ratio: number;
}

export interface SharpWithdrawal {
  code: string;
  name: string;
  price: number;
  drop: number;
}

/** 权重板块表现：领涨 / 领跌 */
export interface WeightSector {
  plateCode: string;
  plateName: string;
  change: number;
  leaderCode: string;
  leaderName: string;
  leaderChange: number;
}

export interface Overview {
  date: string;
  ladder: number[];
  ladderLabels: string[];
  limitUpCount: number | null;
  limitDownCount: number | null;
  expression: number[];
  expressionHint: string;
  history: HistoryPoint[];
  brokenBoard: BrokenBoardPoint[];
  withdrawals: SharpWithdrawal[];
  distribution: Record<string, number>;
  weightSectors: { up: WeightSector[]; down: WeightSector[] };
  marketCapacity: Array<{ day: string; value: number }>;
}

export interface ReviewSnapshot {
  date: string;
  capturedAt: string;
  overview: Overview;
  rows: LimitUpRow[];
  meta: {
    okCount: number;
    failCount: number;
    detailSource: string;
    notes: string[];
  };
}

/** 涨停表现明细的一行（字段索引经 App 辅助功能树逐项校准） */
export interface DetailRow {
  code: string;
  name: string;
  /** limit = 封住涨停；broken = 破板 */
  kind: 'limit' | 'broken';
  time: string;
  boards: string;
  reason: string;
  reasonCount: number;
  themes: string[];
  sector: string;
  /** 以下金额单位为元；振幅/换手/涨幅为百分数数值 */
  seal: number;
  maxSeal: number;
  mainNet: number;
  mainBuy: number;
  mainSell: number;
  amount: number;
  floatCap: number;
  turnover: number;
  amplitude: number;
  price: number;
  change: number;
  tags: string[];
}

export interface DayDetail {
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
}

export interface TradingDayOverview {
  day: string;
  strong: number;
  limitUp: number;
  ladderHeight: number;
  sharpDrop: number;
}

/** 全年复盘数据集 */
export interface YearReview {
  from: string;
  to: string;
  generatedAt: string;
  tradingDays: TradingDayOverview[];
  days: DayDetail[];
  meta: {
    requested: number;
    collected: number;
    failed: string[];
    totalRows: number;
    source: string;
  };
}

/** sniff 命令拦截到的真实接口定义 */
export interface CapturedEndpoint {
  action: string;
  controller: string;
  method: 'GET' | 'POST';
  /** POST 用 Date，GET 用 Day */
  dateParam: string;
  extraParams: Record<string, string>;
  url: string;
  sampleResponse: string;
  capturedAt: string;
}
