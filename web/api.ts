/** 页面只用到的只读接口；抓取任务由 tmux / curl 在后端触发，不占前端 UI */
import type {
  DaySummary, Health, KlineMultiResponse, KlineSeriesResponse, RowsResult,
  SurgeBasis, SurgeResponse, SurgeScope,
} from '../shared/types';

async function request<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch { /* 非 JSON 错误响应保留 HTTP 状态 */ }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export interface RowQuery {
  day: string;
  limit?: number;
}

export interface SurgeQuery {
  year?: number;
  threshold?: number;
  basis?: SurgeBasis;
  scope?: SurgeScope;
  excludeNew?: boolean;
  force?: boolean;
}

export const api = {
  health: () => request<Health>('/api/health'),
  days: () => request<{ days: DaySummary[] }>('/api/days'),
  rows: (query: RowQuery) => {
    const p = new URLSearchParams({ day: query.day, limit: String(query.limit ?? 500) });
    return request<RowsResult>(`/api/rows?${p.toString()}`);
  },
  klineSeries: (code: string, adjust = 'qfq', limit = 500) =>
    request<KlineSeriesResponse>(
      `/api/kline/series?code=${encodeURIComponent(code)}&adjust=${adjust}&limit=${limit}`,
    ),
  /** 板块叠加图：一次取多只票在窗口内的前复权日K */
  klineMulti: (codes: string[], from: string, to: string) =>
    request<KlineMultiResponse>(
      `/api/kline/multi?codes=${codes.map((c) => encodeURIComponent(c)).join(',')}`
      + `&adjust=qfq&from=${from}&to=${to}`,
    ),
  surgeMonths: (query: SurgeQuery = {}) => {
    const p = new URLSearchParams({
      threshold: String(query.threshold ?? 50),
      basis: query.basis ?? 'low-high',
      scope: query.scope ?? 'all',
      excludeNew: query.excludeNew === false ? '0' : '1',
    });
    if (query.year) p.set('year', String(query.year));
    if (query.force) p.set('force', '1');
    return request<SurgeResponse>(`/api/surge/months?${p.toString()}`);
  },
};
