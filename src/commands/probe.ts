import { CONFIG } from '../config.js';
import { endpointsFile, readCaptured } from '../endpoints.js';
import { collect } from '../data/collect.js';
import { info, ok, warn } from '../logger.js';
import { VERIFIED_ENDPOINTS } from '../api/client.js';

export async function runProbe(day: string): Promise<void> {
  info(`接口地址：${CONFIG.apiBase}`);
  info(`已内置 ${VERIFIED_ENDPOINTS.length} 个实测接口（GET+Day / POST+Date，免登录）`);
  const captured = readCaptured();
  if (captured.length > 0) {
    ok(`已捕获自定义接口 ${captured.length} 个：${endpointsFile()}`);
    for (const ep of captured) info(`  · ${ep.method} ${ep.action}/${ep.controller}`);
  } else {
    warn(`尚未捕获个股明细接口：${endpointsFile()} 不存在`);
    info('  运行 `kpl-review sniff`，然后在 App 里点一次日期即可自动写入');
  }
  info('开始连通性自检…');
  const snap = await collect(day);
  ok(`接口成功 ${snap.meta.okCount} / 失败 ${snap.meta.failCount}`);
  ok(`涨停 ${snap.overview.limitUpCount ?? '—'} / 跌停 ${snap.overview.limitDownCount ?? '—'} / 梯队 [${snap.overview.ladder.join(', ')}]`);
  ok(`历史 ${snap.overview.history.length} 天 / 破板 ${snap.overview.brokenBoard.length} 天 / 回撤 ${snap.overview.withdrawals.length} 只 / 明细 ${snap.rows.length} 行`);
  if (snap.meta.failCount > 0) warn(`未返回：${snap.meta.notes.join('；')}`);
}
