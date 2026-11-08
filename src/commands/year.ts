import fs from 'node:fs';
import path from 'node:path';
import { ensureOutputDir, OUTPUT_DIR } from '../config.js';
import { collectYear } from '../data/year.js';
import { info, ok, warn } from '../logger.js';
import { renderYearHtml } from '../render/yearHtml.js';

export interface YearOptions {
  from?: string;
  to?: string;
  year?: string;
  concurrency: number;
  force: boolean;
  html: boolean;
  out?: string;
}

function pad(n: number): string { return String(n).padStart(2, '0'); }

function resolveRange(options: YearOptions): { from: string; to: string; label: string } {
  const now = new Date();
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  if (options.from || options.to) {
    const from = options.from ?? `${options.year ?? now.getFullYear()}-01-01`;
    const to = options.to ?? today;
    return { from, to, label: `${from}_${to}` };
  }
  const year = options.year ?? String(now.getFullYear());
  return { from: `${year}-01-01`, to: `${year}-12-31`, label: year };
}

export async function runYear(options: YearOptions): Promise<{ jsonPath: string; htmlPath?: string }> {
  const { from, to, label } = resolveRange(options);
  info(`区间 ${from} ~ ${to}｜并发 ${options.concurrency}｜${options.force ? '强制重抓' : '使用逐日缓存'}`);

  let lastPct = -1;
  const review = await collectYear({
    from,
    to,
    concurrency: options.concurrency,
    force: options.force,
    onProgress: (done, total, day, rows, fromCache) => {
      const pct = Math.floor((done / total) * 100);
      if (pct !== lastPct && pct % 5 === 0) {
        lastPct = pct;
        info(`进度 ${pct}% (${done}/${total}) 最近 ${day} ${rows} 行${fromCache ? ' [缓存]' : ''}`);
      }
    },
  });

  if (review.meta.failed.length > 0) {
    warn(`${review.meta.failed.length} 个交易日未取到完整明细：${review.meta.failed.slice(0, 6).join('、')}${review.meta.failed.length > 6 ? ' …' : ''}`);
  }

  ensureOutputDir();
  const jsonPath = path.join(OUTPUT_DIR, `year-${label}.json`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(review)}\n`, 'utf8');
  ok(`数据已保存：${jsonPath}（${review.meta.collected}/${review.meta.requested} 个交易日，${review.meta.totalRows} 行明细）`);

  let htmlPath: string | undefined;
  if (options.html) {
    const html = renderYearHtml(review);
    htmlPath = options.out ? path.resolve(options.out) : path.join(OUTPUT_DIR, `year-${label}.html`);
    fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
    fs.writeFileSync(htmlPath, html, 'utf8');
    ok(`网页已生成：${htmlPath}（${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB，单文件离线可用）`);
  }
  return { jsonPath, htmlPath };
}
