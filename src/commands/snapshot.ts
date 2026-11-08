import fs from 'node:fs';
import path from 'node:path';
import { ensureOutputDir, OUTPUT_DIR } from '../config.js';
import { collect } from '../data/collect.js';
import { info, ok, warn } from '../logger.js';
import { renderHtml } from '../render/html.js';

export interface SnapshotOptions {
  day: string;
  out?: string;
}

export async function runSnapshot(options: SnapshotOptions): Promise<string> {
  info(`采集 ${options.day} 的涨停表现数据…`);
  const snapshot = await collect(options.day);
  if (snapshot.meta.failCount > 0) warn(`${snapshot.meta.failCount} 个接口未返回，页面已标注`);
  if (snapshot.rows.length === 0) warn('该日期未返回个股明细（可能非交易日或接口暂无数据）');

  const html = renderHtml(snapshot, { live: false });
  ensureOutputDir();
  const target = options.out
    ? path.resolve(options.out)
    : path.join(OUTPUT_DIR, `kpl-${options.day}.html`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, html, 'utf8');
  ok(`快照已生成：${target}`);
  ok(`接口成功 ${snapshot.meta.okCount} / 失败 ${snapshot.meta.failCount}；历史 ${snapshot.overview.history.length} 天；明细 ${snapshot.rows.length} 行`);
  return target;
}
