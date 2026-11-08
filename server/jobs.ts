/**
 * 抓取任务调度：单进程单任务，前端 POST /api/scrape 后立即返回 jobId，
 * 任务在后台跑，进度与日志写入 SQLite，前端轮询 /api/jobs/:id 即可。
 */
import { loadOverview } from '../src/api/client.js';
import { fetchDayDetail, fetchTradingDays } from '../src/api/details.js';
import { resolveDay } from '../src/config.js';
import type { TradingDayOverview } from '../src/types.js';
import type { Job, ScrapeParams } from '../shared/types.js';
import * as store from './db.js';
import { acquireTask, cancelTask, getActiveJob, getActiveJobId, isCancelled, releaseTask } from './taskLock.js';

export { cancelTask as cancelJob, getActiveJob, getActiveJobId } from './taskLock.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function normalize(input: ScrapeParams): ScrapeParams {
  const mode = input.mode === 'day' || input.mode === 'range' ? input.mode : 'latest';
  const day = DATE_RE.test(input.day ?? '') ? input.day! : undefined;
  const from = DATE_RE.test(input.from ?? '') ? input.from! : undefined;
  const to = DATE_RE.test(input.to ?? '') ? input.to! : undefined;
  const concurrency = Math.max(1, Math.min(8, Number(input.concurrency) || 4));
  return {
    mode,
    ...(day ? { day } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    force: Boolean(input.force),
    concurrency,
    withOverview: input.withOverview ?? (mode !== 'range'),
  };
}

export interface StartResult {
  job: Job;
  conflict: boolean;
}

export function startScrape(input: ScrapeParams): StartResult {
  const running = getActiveJob();
  if (running) return { job: running, conflict: true };
  const params = normalize(input);
  const job = store.createJob(params);
  acquireTask(job.id);
  void runJob(job.id, params);
  return { job, conflict: false };
}

function log(jobId: string, level: 'info' | 'ok' | 'warn' | 'error', message: string): void {
  store.addLog(jobId, level, message);
}

interface Counter {
  done: number;
  rowsWritten: number;
  cachedDays: number;
  failedDays: string[];
}

/** 抓取单日：返回写入行数；命中库内缓存时返回 -1 */
async function scrapeOne(jobId: string, day: string, params: ScrapeParams, counter: Counter): Promise<number> {
  if (!params.force && store.hasDay(day)) {
    counter.cachedDays += 1;
    store.updateJob(jobId, { cachedDays: counter.cachedDays, currentDay: day });
    log(jobId, 'info', `${day} 库中已有 ${store.dayRowCount(day)} 行，跳过（勾选强制重抓可覆盖）`);
    return -1;
  }
  const result = await fetchDayDetail(day);
  if (!result.detail || result.failures.length >= 2 || result.detail.rows.length === 0) {
    throw new Error(`${day} 明细接口未返回有效数据${result.failures.length ? `：${result.failures.join('、')}` : ''}`);
  }
  const written = store.saveDayDetail(result.detail, result.failures);
  if (result.failures.length > 0) {
    log(jobId, 'warn', `${day} 部分接口未返回：${result.failures.join('、')}`);
  }
  if (params.withOverview) {
    try {
      const o = await loadOverview(day);
      store.saveOverview(day, o.overview, o.okCount, o.failCount);
      log(jobId, 'info', `${day} 市场情绪概览：成功 ${o.okCount} / 失败 ${o.failCount}`);
    } catch (err) {
      log(jobId, 'warn', `${day} 概览抓取失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }
  log(jobId, 'ok', `${day} 涨停 ${result.detail.stats.limitCount} / 破板 ${result.detail.stats.brokenCount} → 入库 ${written} 行`);
  return written;
}

function bump(jobId: string, counter: Counter, day: string, written: number): void {
  counter.done += 1;
  if (written > 0) counter.rowsWritten += written;
  store.updateJob(jobId, {
    done: counter.done,
    rowsWritten: counter.rowsWritten,
    cachedDays: counter.cachedDays,
    currentDay: day,
  });
}

function localToday(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function runJob(jobId: string, params: ScrapeParams): Promise<void> {
  const counter: Counter = { done: 0, rowsWritten: 0, cachedDays: 0, failedDays: [] };
  try {
    store.updateJob(jobId, { status: 'running' });
    log(jobId, 'info', `任务启动｜模式 ${params.mode}｜强制重抓 ${params.force ? '是' : '否'}｜概览 ${params.withOverview ? '是' : '否'}`);

    if (params.mode === 'latest' || params.mode === 'day') {
      let day = params.day;
      if (params.mode === 'latest' || !day) {
        log(jobId, 'info', '正在读取交易日列表…');
        const days: TradingDayOverview[] = await fetchTradingDays();
        store.upsertTradingDays(days);
        day = days[days.length - 1]?.day ?? resolveDay();
        log(jobId, 'info', `接口返回 ${days.length} 个交易日，最新交易日 ${day}`);
      }
      store.updateJob(jobId, { total: 1, currentDay: day });
      const written = await scrapeOne(jobId, day, params, counter);
      bump(jobId, counter, day, written);
    } else {
      const from = params.from ?? `${new Date().getFullYear()}-01-01`;
      const to = params.to ?? localToday();
      if (from > to) throw new Error(`起始日期 ${from} 晚于结束日期 ${to}`);
      log(jobId, 'info', `正在读取交易日列表（${from} ~ ${to}）…`);
      const allDays = await fetchTradingDays();
      store.upsertTradingDays(allDays);
      const queue = allDays.filter((d) => d.day >= from && d.day <= to).map((d) => d.day);
      if (queue.length === 0) {
        throw new Error(`区间 ${from} ~ ${to} 内没有交易日（接口共返回 ${allDays.length} 天）`);
      }
      store.updateJob(jobId, { total: queue.length });
      log(jobId, 'info', `共 ${queue.length} 个交易日，并发 ${params.concurrency}`);

      let cursor = 0;
      const worker = async (): Promise<void> => {
        while (!isCancelled(jobId)) {
          const index = cursor;
          cursor += 1;
          if (index >= queue.length) return;
          const day = queue[index]!;
          await sleep(80);
          try {
            const written = await scrapeOne(jobId, day, params, counter);
            bump(jobId, counter, day, written);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            counter.failedDays.push(day);
            log(jobId, 'error', `${day} 抓取失败：${msg}`);
            store.updateJob(jobId, { failedDays: counter.failedDays });
            bump(jobId, counter, day, 0);
          }
        }
      };
      await Promise.all(Array.from({ length: params.concurrency ?? 4 }, worker));
    }

    if (isCancelled(jobId)) {
      log(jobId, 'warn', '任务已取消');
    } else if (counter.failedDays.length === counter.done && counter.done > 0) {
      store.updateJob(jobId, {
        status: 'failed',
        message: `全部 ${counter.done} 个交易日抓取失败`,
        finishedAt: new Date().toISOString(),
      });
      log(jobId, 'error', '任务失败：所有交易日均未取到数据');
    } else {
      const tail = counter.failedDays.length ? `，失败 ${counter.failedDays.length} 天` : '';
      store.updateJob(jobId, {
        status: 'success',
        message: `完成 ${counter.done} 天｜入库 ${counter.rowsWritten} 行｜缓存跳过 ${counter.cachedDays} 天${tail}`,
        finishedAt: new Date().toISOString(),
      });
      log(jobId, 'ok', `任务完成：${counter.done} 天 / ${counter.rowsWritten} 行${tail}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!isCancelled(jobId)) {
      store.updateJob(jobId, {
        status: 'failed', message: msg, finishedAt: new Date().toISOString(),
      });
      log(jobId, 'error', `任务失败：${msg}`);
    }
  } finally {
    releaseTask(jobId);
  }
}

/** 模块加载时把上次进程遗留的 running/queued 任务收尾 */
export function initJobs(): number {
  return store.recoverStaleJobs();
}
