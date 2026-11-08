/**
 * REST API 路由：与传输层解耦，返回 boolean 表示是否由后端处理。
 * Vite dev / preview 通过 configureServer 中间件挂载；
 * 生产独立服务器 server/standalone.ts 直接复用 handleApi。
 */
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { CONFIG, OUTPUT_DIR, resolveDay } from '../src/config.js';
import type {
  KlineAdjust, KlineParams, KlineScope, KlineSource, ScrapeParams,
  SurgeBasis, SurgeScope,
} from '../shared/types.js';
import * as store from './db.js';
import * as jobs from './jobs.js';
import * as klineJobs from './klineJobs.js';
import * as surge from './surge.js';

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

function sendText(res: ServerResponse, status: number, body: string, contentType: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buf.length;
    if (size > 1_000_000) throw new Error('请求体过大（上限 1MB）');
    chunks.push(buf);
  }
  if (size === 0) return {} as T;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
  } catch {
    throw new Error('请求体不是合法 JSON');
  }
}

function validDay(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function validAdjust(value: unknown): KlineAdjust {
  return value === 'hfq' || value === 'none' ? value : 'qfq';
}

function validScope(value: unknown): KlineScope {
  return value === 'limit' ? 'limit' : 'all';
}

function validSurgeBasis(value: unknown): SurgeBasis {
  return value === 'close' || value === 'range' ? value : 'low-high';
}

function validSurgeScope(value: unknown): SurgeScope {
  return value === 'limit' ? 'limit' : 'all';
}

function localToday(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function validSource(value: unknown): KlineSource {
  return value === 'tencent' || value === 'eastmoney' ? value : 'auto';
}

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv(day: string, kind: string | null): string {
  const rows = store.allRowsForDay(day, kind ?? undefined);
  const head = [
    '日期', '代码', '名称', '类型', '涨停时间', '连板', '题材', '题材家数',
    '封单(元)', '最大封单(元)', '主力净额(元)', '主力买入(元)', '主力卖出(元)',
    '成交额(元)', '实际流通(元)', '换手率(%)', '振幅(%)', '价格', '涨幅(%)', '标签',
  ];
  const lines = [head.join(',')];
  for (const r of rows) {
    lines.push([
      day, r.code, r.name, r.kind === 'limit' ? '涨停' : '破板', r.time, r.boards,
      r.reason, r.reasonCount, r.seal, r.maxSeal, r.mainNet, r.mainBuy, r.mainSell,
      r.amount, r.floatCap, r.turnover, r.amplitude, r.price, r.change, r.tags.join('|'),
    ].map(csvCell).join(','));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** 单只个股今年日K CSV（按日期升序） */
function exportKlineCsv(code: string, adjust: KlineAdjust): string {
  const rows = store.allKlineRows(code, adjust);
  const head = [
    '日期', '代码', '名称', '开盘', '最高', '最低', '收盘', '成交量(手)',
    '成交额(元)', '涨跌幅(%)', '振幅(%)', '换手率(%)', '复权', '数据源',
  ];
  const labels: Record<KlineAdjust, string> = { qfq: '前复权', hfq: '后复权', none: '不复权' };
  const lines = [head.join(',')];
  for (const r of rows) {
    lines.push([
      r.day, r.code, store.getKlineSymbolName(code), r.open, r.high, r.low, r.close,
      r.volume, r.amount, r.changePct, r.amplitude, r.turnover,
      labels[r.adjust], r.source === 'tencent' ? '腾讯财经' : '东方财富',
    ].map(csvCell).join(','));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** 模块加载时收尾上次遗留的运行中任务 */
const RECOVERED = jobs.initJobs();
if (RECOVERED > 0) {
  process.stderr.write(`[kpl-api] 已收尾 ${RECOVERED} 个上次中断的抓取任务\n`);
}

export async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname;
  if (!pathname.startsWith('/api/')) return false;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  const method = (req.method ?? 'GET').toUpperCase();
  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }

  try {
    const q = url.searchParams;

    if (method === 'GET' && pathname === '/api/health') {
      const kline = store.getKlineStats();
      sendJson(res, 200, {
        ok: true,
        node: process.version,
        sqlite: 'node:sqlite / DatabaseSync',
        dbPath: store.DB_PATH,
        activeJobId: jobs.getActiveJobId(),
        now: new Date().toISOString(),
        klineRows: kline.rows,
        klineSymbols: kline.okSymbols,
        klineTargetSymbols: kline.targetSymbols,
      });
      return true;
    }

    if (method === 'GET' && pathname === '/api/config') {
      sendJson(res, 200, {
        apiBase: CONFIG.apiBase,
        defaultDay: resolveDay(),
        version: CONFIG.version,
        cacheDir: path.join(OUTPUT_DIR, 'cache'),
      });
      return true;
    }

    if (method === 'GET' && pathname === '/api/stats') {
      sendJson(res, 200, store.getStats());
      return true;
    }

    if (method === 'GET' && pathname === '/api/days') {
      sendJson(res, 200, { days: store.listDaySummaries() });
      return true;
    }

    if (method === 'GET' && pathname === '/api/trading-days') {
      const limit = Math.max(1, Math.min(2000, Number(q.get('limit')) || 2000));
      sendJson(res, 200, { days: store.listTradingDays(limit) });
      return true;
    }

    if (method === 'GET' && pathname === '/api/latest-day') {
      sendJson(res, 200, { day: store.latestTradingDay() ?? store.getStats().latestDay });
      return true;
    }

    if (method === 'GET' && pathname === '/api/detail') {
      const day = validDay(q.get('day')) ?? store.getStats().latestDay;
      if (!day) {
        sendJson(res, 404, { error: '数据库暂无数据，请先在左侧启动抓取或导入本地缓存' });
        return true;
      }
      const found = store.getDayDetail(day);
      if (!found) {
        sendJson(res, 404, { error: `交易日 ${day} 没有明细数据` });
        return true;
      }
      sendJson(res, 200, {
        day,
        detail: found.detail,
        overview: store.getOverview(day),
        capturedAt: found.capturedAt,
      });
      return true;
    }

    if (method === 'GET' && pathname === '/api/overview') {
      const day = validDay(q.get('day')) ?? store.getStats().latestDay;
      const overview = day ? store.getOverview(day) : null;
      if (!overview) {
        sendJson(res, 404, { error: `交易日 ${day ?? ''} 没有概览数据` });
        return true;
      }
      sendJson(res, 200, { day, overview });
      return true;
    }

    if (method === 'GET' && pathname === '/api/rows') {
      const day = validDay(q.get('day')) ?? store.getStats().latestDay;
      if (!day) {
        sendJson(res, 404, { error: '数据库暂无数据' });
        return true;
      }
      const dir = q.get('dir') === 'desc' ? 'desc' : 'asc';
      sendJson(res, 200, store.queryRows({
        day,
        kind: q.get('kind') ?? undefined,
        q: q.get('q')?.trim() ?? undefined,
        sort: q.get('sort') ?? undefined,
        dir,
        limit: Number(q.get('limit')) || 100,
        offset: Number(q.get('offset')) || 0,
      }));
      return true;
    }

    if (method === 'GET' && pathname === '/api/trend') {
      const limit = Math.max(5, Math.min(500, Number(q.get('limit')) || 60));
      sendJson(res, 200, { points: store.getTrendPoints(limit) });
      return true;
    }

    if (method === 'GET' && pathname === '/api/jobs') {
      const limit = Math.max(1, Math.min(100, Number(q.get('limit')) || 20));
      sendJson(res, 200, { jobs: store.listJobs(limit), activeJobId: jobs.getActiveJobId() });
      return true;
    }

    const jobMatch = /^\/api\/jobs\/([^/]+)(\/cancel)?$/.exec(pathname);
    if (jobMatch) {
      const id = decodeURIComponent(jobMatch[1]!);
      const isCancel = Boolean(jobMatch[2]);
      const job = store.getJob(id);
      if (!job) {
        sendJson(res, 404, { error: `任务 ${id} 不存在` });
        return true;
      }
      if (isCancel && method === 'POST') {
        const ok = jobs.cancelJob(id);
        sendJson(res, 200, { ok, job: store.getJob(id) });
        return true;
      }
      if (!isCancel && method === 'GET') {
        const after = Math.max(0, Number(q.get('after')) || 0);
        sendJson(res, 200, { job, logs: store.getLogs(id, after) });
        return true;
      }
    }

    if (method === 'POST' && pathname === '/api/scrape') {
      const body = await readJson<Partial<ScrapeParams>>(req);
      const mode = body.mode === 'day' || body.mode === 'range' ? body.mode : 'latest';
      const params: ScrapeParams = {
        mode,
        ...(validDay(body.day) ? { day: body.day } : {}),
        ...(validDay(body.from) ? { from: body.from } : {}),
        ...(validDay(body.to) ? { to: body.to } : {}),
        force: Boolean(body.force),
        concurrency: Math.max(1, Math.min(8, Number(body.concurrency) || 4)),
        withOverview: body.withOverview ?? (mode !== 'range'),
      };
      const result = jobs.startScrape(params);
      if (result.conflict) {
        sendJson(res, 409, {
          error: `已有抓取任务 ${result.job.id} 正在运行（${result.job.done}/${result.job.total}），请等待完成或先取消`,
          job: result.job,
        });
        return true;
      }
      sendJson(res, 202, { jobId: result.job.id, job: result.job });
      return true;
    }

    if (method === 'POST' && pathname === '/api/import-cache') {
      const body = await readJson<{ force?: boolean }>(req);
      const result = store.importCache(Boolean(body.force));
      sendJson(res, 200, result);
      return true;
    }

    /* --------------------------- 今年涨停股日K --------------------------- */

    if (method === 'POST' && pathname === '/api/kline/scrape') {
      const body = await readJson<Partial<KlineParams>>(req);
      const codes = Array.isArray(body.codes)
        ? body.codes.filter((c): c is string => typeof c === 'string' && /^\d{6}$/.test(c)).slice(0, 6000)
        : [];
      const params: KlineParams = {
        from: validDay(body.from) ?? `${new Date().getFullYear()}-01-01`,
        to: validDay(body.to) ?? localToday(),
        scope: validScope(body.scope),
        source: validSource(body.source),
        adjust: validAdjust(body.adjust),
        force: Boolean(body.force),
        onlyMissing: Boolean(body.onlyMissing),
        concurrency: Math.max(1, Math.min(10, Number(body.concurrency) || 3)),
        ...(codes.length > 0 ? { codes: [...new Set(codes)] } : {}),
      };
      const result = klineJobs.startKline(params);
      if (result.conflict) {
        sendJson(res, 409, {
          error: `已有任务 ${result.job.id} 正在运行（${result.job.done}/${result.job.total}），请等待完成或先取消`,
          job: result.job,
        });
        return true;
      }
      sendJson(res, 202, { jobId: result.job.id, job: result.job });
      return true;
    }

    if (method === 'GET' && pathname === '/api/kline/stats') {
      sendJson(res, 200, store.getKlineStats(validScope(q.get('scope'))));
      return true;
    }

    if (method === 'GET' && pathname === '/api/kline/symbols') {
      sendJson(res, 200, store.listKlineSymbols({
        q: q.get('q')?.trim() ?? undefined,
        status: q.get('status') ?? undefined,
        limit: Number(q.get('limit')) || 50,
        offset: Number(q.get('offset')) || 0,
      }));
      return true;
    }

    if (method === 'GET' && pathname === '/api/kline/series') {
      const code = q.get('code') ?? '';
      if (!/^\d{6}$/.test(code)) {
        sendJson(res, 400, { error: 'code 必须是 6 位股票代码' });
        return true;
      }
      sendJson(res, 200, store.getKlineSeries({
        code,
        adjust: validAdjust(q.get('adjust')),
        ...(validDay(q.get('from')) ? { from: validDay(q.get('from'))! } : {}),
        ...(validDay(q.get('to')) ? { to: validDay(q.get('to'))! } : {}),
        limit: Math.max(1, Math.min(2000, Number(q.get('limit')) || 400)),
        offset: Math.max(0, Number(q.get('offset')) || 0),
      }));
      return true;
    }

    if (method === 'GET' && pathname === '/api/kline/multi') {
      const codes = (q.get('codes') ?? '').split(',')
        .map((c) => c.trim())
        .filter((c) => /^\d{6}$/.test(c))
        .slice(0, 300);
      if (codes.length === 0) {
        sendJson(res, 400, { error: 'codes 需要逗号分隔的 6 位股票代码' });
        return true;
      }
      const from = validDay(q.get('from')) ?? `${new Date().getFullYear()}-01-01`;
      const to = validDay(q.get('to')) ?? localToday();
      sendJson(res, 200, store.getKlineSeriesMulti({
        codes, adjust: validAdjust(q.get('adjust')), from, to,
      }));
      return true;
    }

    if (method === 'GET' && pathname === '/api/kline/export') {
      const code = q.get('code') ?? '';
      if (!/^\d{6}$/.test(code)) {
        sendJson(res, 400, { error: '导出需要 6 位股票代码（code 参数）' });
        return true;
      }
      const adjust = validAdjust(q.get('adjust'));
      sendText(
        res, 200, exportKlineCsv(code, adjust),
        'text/csv; charset=utf-8',
        { 'Content-Disposition': `attachment; filename="kline-${code}-${adjust}.csv"` },
      );
      return true;
    }

    /* ------------------- 月度「自最低点涨幅」统计 ------------------- */

    if (method === 'GET' && pathname === '/api/surge/months') {
      const years = surge.surgeYears();
      const defaultYear = years.at(-1) ?? new Date().getFullYear();
      sendJson(res, 200, surge.computeMonthlySurge({
        year: Math.max(1990, Math.min(2200, Number(q.get('year')) || defaultYear)),
        threshold: Math.max(1, Math.min(1000, Number(q.get('threshold')) || 50)),
        basis: validSurgeBasis(q.get('basis')),
        scope: validSurgeScope(q.get('scope')),
        excludeNew: q.get('excludeNew') !== '0',
        force: q.get('force') === '1',
      }));
      return true;
    }

    if (method === 'GET' && pathname === '/api/export') {
      const day = validDay(q.get('day')) ?? store.getStats().latestDay;
      if (!day) {
        sendJson(res, 404, { error: '数据库暂无数据' });
        return true;
      }
      const kind = q.get('kind');
      sendText(
        res, 200, exportCsv(day, kind),
        'text/csv; charset=utf-8',
        { 'Content-Disposition': `attachment; filename="kpl-${day}.csv"` },
      );
      return true;
    }

    sendJson(res, 404, { error: `未知接口 ${method} ${pathname}` });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[kpl-api] ${method} ${pathname} 失败：${message}\n`);
    sendJson(res, 500, { error: message });
    return true;
  }
}
