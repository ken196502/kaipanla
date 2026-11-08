/**
 * 进程级单任务锁：涨停明细抓取与日K下载共用，避免两类任务同时打接口被限流。
 * 任务状态与日志仍持久化在 SQLite，重启后由 initJobs() 收尾。
 */
import type { Job } from '../shared/types.js';
import * as store from './db.js';

let activeJobId: string | null = null;
const cancelledJobs = new Set<string>();
const controllers = new Map<string, AbortController>();

export function getActiveJob(): Job | null {
  if (!activeJobId) return null;
  const job = store.getJob(activeJobId);
  return job && (job.status === 'running' || job.status === 'queued') ? job : null;
}

export function getActiveJobId(): string | null {
  return getActiveJob()?.id ?? null;
}

export function acquireTask(jobId: string, controller?: AbortController): void {
  activeJobId = jobId;
  if (controller) controllers.set(jobId, controller);
}

export function releaseTask(jobId: string): void {
  cancelledJobs.delete(jobId);
  controllers.delete(jobId);
  if (activeJobId === jobId) activeJobId = null;
}

export function isCancelled(jobId: string): boolean {
  return cancelledJobs.has(jobId);
}

export function taskSignal(jobId: string): AbortSignal | undefined {
  return controllers.get(jobId)?.signal;
}

export function cancelTask(jobId: string): boolean {
  const job = store.getJob(jobId);
  if (!job || (job.status !== 'running' && job.status !== 'queued')) return false;
  cancelledJobs.add(jobId);
  controllers.get(jobId)?.abort();
  store.updateJob(jobId, {
    status: 'cancelled', message: '用户取消', finishedAt: new Date().toISOString(),
  });
  store.addLog(jobId, 'warn', '收到取消指令，当前请求结束后停止');
  return true;
}
