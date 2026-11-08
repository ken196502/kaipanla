/**
 * 全局请求令牌：所有行情源共享一个固定放行间隔，保证无论并发开多大，
 * 对公开接口的总请求速率都受控（实测 ~30 req/s 持续 100 秒会触发腾讯 501）。
 *
 * 实测结论：腾讯 fqkline 在连续高频请求约 3000 次后返回 HTTP 501，
 * 东方财富随后出现 fetch failed / Empty reply。降到 8 req/s 可稳定跑完。
 */
const MIN_INTERVAL_MS = Number(process.env.KPL_KLINE_INTERVAL_MS ?? 125);
let nextSlotAt = 0;

export async function acquireRequestSlot(): Promise<void> {
  const now = Date.now();
  const slotAt = Math.max(now, nextSlotAt);
  nextSlotAt = slotAt + MIN_INTERVAL_MS;
  const waitMs = slotAt - now;
  if (waitMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
}

export const REQUESTS_PER_SECOND = Math.round(1000 / MIN_INTERVAL_MS);
