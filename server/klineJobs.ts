/**
 * 日K批量下载任务：把「今年所有触及涨停的个股」逐个请求公开行情接口并写入 SQLite。
 * 与涨停明细抓取共用 taskLock 单任务锁、jobs/job_logs 表与前端轮询协议。
 *
 * 设计要点：
 * - 标的池来自 limit_up_rows 聚合（不是另维护一份股票清单），涨停数据更新后自动跟着变。
 * - 全局限速 8 req/s（rateLimiter）；腾讯 501/429 会自动冷却并切东财；
 *   连续失败触发全任务暂停，避免限流后整批标的白白失败。
 * - 首轮结束后对失败标的冷却 30 秒自动重试一轮；仍失败的可用「只补缺失」继续。
 * - 日志按批次节流，避免 3000+ 条日志把前端轮询和 SQLite 拖慢。
 */
import type { Job, KlineAdjust, KlineParams, KlineScope, KlineSource } from '../shared/types.js';
import { marketOf, isSixDigitCode } from './lib/stockCode.js';
import { REQUESTS_PER_SECOND } from './lib/rateLimiter.js';
import { fetchDailyKline, tencentIsCoolingDown } from './klineProviders.js';
import * as store from './db.js';
import {
  acquireTask, cancelTask, getActiveJob, isCancelled, releaseTask, taskSignal,
} from './taskLock.js';

export { cancelTask as cancelKlineJob, getActiveJob as getActiveKlineJob } from './taskLock.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LOG_BATCH = 25;
const MAX_INDIVIDUAL_ERROR_LOGS = 30;
/** 默认并发：全局限速已生效，并发只影响同时在飞的请求数 */
const DEFAULT_CONCURRENCY = 3;
/** 首轮失败后的冷却窗口，等公开接口解除限流 */
const RETRY_COOLDOWN_MS = 30_000;
/** 补抓时每只之间的额外间隔（叠加全局限速） */
const RETRY_GAP_MS = 250;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function localToday(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function normalize(input: Partial<KlineParams>): KlineParams {
  const from = DATE_RE.test(input.from ?? '') ? input.from! : `${new Date().getFullYear()}-01-01`;
  const to = DATE_RE.test(input.to ?? '') ? input.to! : localToday();
  const scope: KlineScope = input.scope === 'limit' ? 'limit' : 'all';
  const source: KlineSource = input.source === 'tencent' || input.source === 'eastmoney'
    ? input.source : 'auto';
  const adjust: KlineAdjust = input.adjust === 'hfq' || input.adjust === 'none'
    ? input.adjust : 'qfq';
  const codes = Array.isArray(input.codes)
    ? [...new Set(input.codes.filter((c): c is string => typeof c === 'string' && isSixDigitCode(c)))].slice(0, 6000)
    : undefined;
  return {
    from, to, scope, source, adjust,
    force: Boolean(input.force),
    onlyMissing: Boolean(input.onlyMissing),
    concurrency: Math.max(1, Math.min(10, Number(input.concurrency) || DEFAULT_CONCURRENCY)),
    ...(codes && codes.length > 0 ? { codes } : {}),
  };
}

export interface StartResult {
  job: Job;
  conflict: boolean;
}

export function startKline(input: Partial<KlineParams>): StartResult {
  const running = getActiveJob();
  if (running) return { job: running, conflict: true };
  const params = normalize(input);
  if (params.from > params.to) throw new Error(`起始日期 ${params.from} 晚于结束日期 ${params.to}`);
  const job = store.createJob(params, 'kline');
  const controller = new AbortController();
  acquireTask(job.id, controller);
  void runKlineJob(job.id, params);
  return { job, conflict: false };
}

interface Counter {
  done: number;
  ok: number;
  skipped: number;
  rowsWritten: number;
  failedCodes: string[];
  fallbackCount: number;
  tencentCount: number;
  eastmoneyCount: number;
  consecutiveFailures: number;
}

function log(jobId: string, level: 'info' | 'ok' | 'warn' | 'error', message: string): void {
  store.addLog(jobId, level, message);
}

function bump(jobId: string, counter: Counter, code: string): void {
  store.updateJob(jobId, {
    done: counter.done,
    rowsWritten: counter.rowsWritten,
    cachedDays: counter.skipped,
    currentDay: code,
    failedDays: counter.failedCodes,
  });
}

/** 标的池：今年触及涨停的个股；指定 codes 时允许下载池外代码（便于抽样/补抓） */
function resolveTargets(params: KlineParams): store.KlineTarget[] {
  const year = params.from.slice(0, 4);
  const pool = store.klineTargetSymbols(params.scope, `${year}-01-01`, `${year}-12-31`);
  if (!params.codes?.length) return pool;
  const known = new Map(pool.map((t) => [t.code, t]));
  return params.codes.map((code) => known.get(code) ?? {
    code, name: '', market: marketOf(code),
    limitDays: 0, touchDays: 0, lastLimitDay: '',
  });
}

async function runKlineJob(jobId: string, params: KlineParams): Promise<void> {
  const counter: Counter = {
    done: 0, ok: 0, skipped: 0, rowsWritten: 0,
    failedCodes: [], fallbackCount: 0, tencentCount: 0, eastmoneyCount: 0,
    consecutiveFailures: 0,
  };
  const signal = taskSignal(jobId);
  /** 连续失败触发的全任务暂停截止时间，所有 worker 共同遵守 */
  let pauseUntil = 0;
  let lastPauseLogAt = 0;

  const waitForResume = async (): Promise<boolean> => {
    while (Date.now() < pauseUntil) {
      if (isCancelled(jobId)) return false;
      await sleep(500);
    }
    return !isCancelled(jobId);
  };

  try {
    store.updateJob(jobId, { status: 'running' });
    const targets = resolveTargets(params);
    if (targets.length === 0) {
      throw new Error('库里没有今年触及涨停的个股，请先在抓取控制台拉取涨停明细');
    }
    store.upsertKlineTargets(targets, params.adjust);
    store.updateJob(jobId, { total: targets.length });
    log(jobId, 'info',
      `日K任务启动｜标的 ${targets.length} 只（${params.scope === 'all' ? '含破板' : '仅收盘涨停'}）`
      + `｜区间 ${params.from} ~ ${params.to}｜复权 ${params.adjust}｜数据源 ${params.source}`
      + `｜并发 ${params.concurrency}｜全局限速 ${REQUESTS_PER_SECOND} req/s`
      + `｜强制重下 ${params.force ? '是' : '否'}｜只补缺失 ${params.onlyMissing ? '是' : '否'}`,
    );

    const states = store.klineSymbolStates();
    const today = localToday();
    const queue: store.KlineTarget[] = [];
    for (const target of targets) {
      const state = states.get(target.code);
      const covered = state?.status === 'ok' && state.adjust === params.adjust;
      const skip = !params.force && covered
        && (params.onlyMissing || state.fetchedAt?.slice(0, 10) === today);
      if (skip) {
        counter.skipped += 1;
      } else {
        queue.push(target);
      }
    }
    store.updateJob(jobId, { cachedDays: counter.skipped, done: counter.skipped });
    log(jobId, 'info', `跳过 ${counter.skipped} 只已覆盖标的，待下载 ${queue.length} 只`);

    /** 下载并处理单只标的；成功会从失败清单中移除（用于自动重试轮） */
    const handleOne = async (target: store.KlineTarget, isRetry = false): Promise<boolean> => {
      try {
        const result = await fetchDailyKline({
          code: target.code, from: params.from, to: params.to,
          adjust: params.adjust, source: params.source, signal,
        });
        if (result.attempts.length > 1 && !result.attempts[0]?.ok) counter.fallbackCount += 1;
        if (result.provider === 'tencent') counter.tencentCount += 1;
        else counter.eastmoneyCount += 1;

        const written = store.saveKlineSeries({
          code: target.code, adjust: params.adjust, source: result.provider,
          rows: result.rows, status: 'ok',
          ...(result.name ? { name: result.name } : {}),
        });
        counter.ok += 1;
        counter.rowsWritten += written;
        counter.consecutiveFailures = 0;
        const idx = counter.failedCodes.indexOf(target.code);
        if (idx >= 0) counter.failedCodes.splice(idx, 1);
        if (isRetry) log(jobId, 'ok', `补抓成功 ${target.code} ${target.name}：${written} 根日K（${result.provider}）`);
        return true;
      } catch (err) {
        const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
        if (!counter.failedCodes.includes(target.code)) counter.failedCodes.push(target.code);
        store.markKlineSymbol(target.code, 'failed', message, params.adjust);
        counter.consecutiveFailures += 1;
        if (counter.failedCodes.length <= MAX_INDIVIDUAL_ERROR_LOGS) {
          log(jobId, 'error', `${target.code} ${target.name} 下载失败：${message}`);
        }
        // 连续失败＝公开接口限流的强信号，全任务暂停而不是把剩余标的全部打失败
        if (counter.consecutiveFailures >= 6) {
          const pauseMs = counter.consecutiveFailures >= 24 ? 60_000 : 20_000;
          pauseUntil = Math.max(pauseUntil, Date.now() + pauseMs);
          counter.consecutiveFailures = 0;
          if (Date.now() - lastPauseLogAt > 1_000) {
            lastPauseLogAt = Date.now();
            log(jobId, 'warn', `连续失败，疑似触发公开接口限流，全任务暂停 ${pauseMs / 1000}s 后继续（已入库数据保留）`);
          }
        }
        return false;
      }
    };

    let cursor = 0;
    let lastBatchMark = 0;
    const worker = async (): Promise<void> => {
      while (!isCancelled(jobId)) {
        if (!await waitForResume()) return;
        const index = cursor;
        cursor += 1;
        if (index >= queue.length) return;
        const target = queue[index]!;
        await sleep(Math.random() * 20);
        if (isCancelled(jobId)) return;

        await handleOne(target);
        counter.done = counter.skipped + counter.ok + counter.failedCodes.length;
        bump(jobId, counter, target.code);

        if (counter.done - lastBatchMark >= LOG_BATCH || counter.done === targets.length) {
          lastBatchMark = counter.done;
          log(jobId, 'info',
            `进度 ${counter.done}/${targets.length}｜成功 ${counter.ok}｜跳过 ${counter.skipped}`
            + `｜失败 ${counter.failedCodes.length}｜入库 ${counter.rowsWritten} 行`
            + `｜源 腾讯 ${counter.tencentCount} / 东财 ${counter.eastmoneyCount}（兜底 ${counter.fallbackCount}）`
            + (tencentIsCoolingDown() ? '｜腾讯限流冷却中，已切东财' : ''),
          );
        }
      }
    };
    await Promise.all(Array.from({ length: params.concurrency }, worker));

    // 首轮失败的标的：等限流窗口过去后自动低速补抓一轮
    const retryCodes = [...counter.failedCodes];
    let retried = 0;
    if (retryCodes.length > 0 && !isCancelled(jobId)) {
      log(jobId, 'warn', `首轮 ${retryCodes.length} 只未取到数据，冷却 ${RETRY_COOLDOWN_MS / 1000}s 后自动补抓一轮`);
      await sleep(RETRY_COOLDOWN_MS);
      if (!isCancelled(jobId)) {
        const targetMap = new Map(targets.map((t) => [t.code, t]));
        store.updateJob(jobId, { total: targets.length + retryCodes.length });
        for (const code of retryCodes) {
          if (!await waitForResume()) break;
          if (isCancelled(jobId)) break;
          await sleep(RETRY_GAP_MS);
          const target = targetMap.get(code);
          if (!target) continue;
          await handleOne(target, true);
          counter.done += 1;
          retried += 1;
          bump(jobId, counter, code);
          if (retried % 20 === 0) {
            log(jobId, 'info', `补抓进度 ${retried}/${retryCodes.length}｜累计成功 ${counter.ok}｜仍失败 ${counter.failedCodes.length}`);
          }
        }
      }
    }

    const total = targets.length + retried;
    if (isCancelled(jobId)) {
      log(jobId, 'warn', `任务已取消：完成 ${counter.done}/${total}，已入库 ${counter.rowsWritten} 行，下次可勾选「只补缺失」继续`);
    } else if (counter.ok === 0 && queue.length > 0) {
      store.updateJob(jobId, {
        status: 'failed', message: `全部 ${queue.length} 只标的下载失败（含自动补抓一轮）`,
        finishedAt: new Date().toISOString(),
      });
      log(jobId, 'error', '任务失败：所有标的均未取到日K');
    } else {
      const tail = counter.failedCodes.length
        ? `｜仍失败 ${counter.failedCodes.length} 只（前 10 个：${counter.failedCodes.slice(0, 10).join(',')}，可勾选「只补缺失」继续）` : '';
      const message = `完成 ${counter.done}/${total}｜成功 ${counter.ok} 只｜跳过 ${counter.skipped}`
        + `｜入库 ${counter.rowsWritten} 行｜腾讯 ${counter.tencentCount} / 东财 ${counter.eastmoneyCount}`
        + `｜自动补抓 ${retried}${tail}`;
      store.updateJob(jobId, {
        status: 'success', message, finishedAt: new Date().toISOString(),
      });
      log(jobId, 'ok', `任务完成：${message}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!isCancelled(jobId)) {
      store.updateJob(jobId, {
        status: 'failed', message, finishedAt: new Date().toISOString(),
      });
      log(jobId, 'error', `任务失败：${message}`);
    }
  } finally {
    releaseTask(jobId);
  }
}
