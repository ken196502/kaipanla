import http from 'node:http';
import { collect } from '../data/collect.js';
import { error, info, ok, warn } from '../logger.js';
import { renderHtml } from '../render/html.js';
import type { ReviewSnapshot } from '../types.js';

export interface ServeOptions {
  day: string;
  port: number;
  refreshMs: number;
  host: string;
}

export async function runServe(options: ServeOptions): Promise<void> {
  let snapshot: ReviewSnapshot;
  info(`首次采集 ${options.day} …`);
  try {
    snapshot = await collect(options.day);
  } catch (err) {
    error(`首次采集失败：${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  let refreshing = false;
  const refresh = async (): Promise<void> => {
    if (refreshing) return;
    refreshing = true;
    try {
      snapshot = await collect(options.day);
      info(`刷新完成：历史 ${snapshot.overview.history.length} 天 / 明细 ${snapshot.rows.length} 行`);
    } catch (err) {
      warn(`刷新失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      refreshing = false;
    }
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname === '/api/snapshot') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(snapshot));
      return;
    }
    if (url.pathname === '/api/refresh') {
      void refresh();
      res.writeHead(202, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end('{"accepted":true}');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(renderHtml(snapshot, { live: true, refreshMs: options.refreshMs }));
  });

  const timer = setInterval(() => void refresh(), options.refreshMs);
  const shutdown = (): void => {
    clearInterval(timer);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  server.listen(options.port, options.host, () => {
    ok(`复盘页面已启动：http://${options.host}:${options.port}`);
    ok(`交易日 ${options.day}　自动刷新 ${options.refreshMs}ms　Ctrl+C 退出`);
  });
}
