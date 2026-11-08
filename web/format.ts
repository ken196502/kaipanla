/** 金额单位统一为元，展示时自动折算为万 / 亿 */
export function money(v: number): string {
  if (!Number.isFinite(v) || v === 0) return '—';
  const a = Math.abs(v);
  if (a >= 1e8) return `${(v / 1e8).toFixed(2)}亿`;
  if (a >= 1e4) return `${(v / 1e4).toFixed(0)}万`;
  return String(Math.round(v));
}

export function signedMoney(v: number): string {
  if (!Number.isFinite(v) || v === 0) return '—';
  const sign = v > 0 ? '+' : v < 0 ? '-' : '';
  return `${sign}${money(Math.abs(v))}`;
}

export function pct(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
}

export function clock(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function dayLabel(day: string): string {
  const w = ['日', '一', '二', '三', '四', '五', '六'];
  const d = new Date(`${day}T00:00:00`);
  if (Number.isNaN(d.getTime())) return day;
  return `${day} 周${w[d.getDay()]}`;
}

export function statusLabel(status: string): string {
  return ({
    queued: '排队中', running: '抓取中', success: '已完成',
    failed: '失败', cancelled: '已取消',
  } as Record<string, string>)[status] ?? status;
}

export function modeLabel(mode: string): string {
  return ({
    latest: '最新交易日', day: '指定日期', range: '日期区间',
    kline: '今年涨停股日K',
  } as Record<string, string>)[mode] ?? mode;
}

export function adjustLabel(adjust: string): string {
  return ({ qfq: '前复权', hfq: '后复权', none: '不复权' } as Record<string, string>)[adjust] ?? adjust;
}

export function sourceLabel(source: string): string {
  return ({ tencent: '腾讯财经', eastmoney: '东方财富' } as Record<string, string>)[source] ?? source;
}
