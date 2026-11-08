/**
 * 生产独立服务器：vite build 之后用 `pnpm start` 启动。
 * 复用与 Vite dev 完全相同的 /api 路由与 SQLite 实例，静态资源来自 dist/。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/config.js';
import { handleApi } from './api.js';
import { closeDb, DB_PATH } from './db.js';

const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT ?? process.env.KPL_PORT ?? 4173);
const HOST = process.env.KPL_HOST ?? '127.0.0.1';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function serveStatic(pathname: string, res: http.ServerResponse): void {
  const index = path.join(DIST, 'index.html');
  let target = path.resolve(DIST, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (target !== DIST && !target.startsWith(DIST + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    // SPA fallback：非静态资源路径一律交给 index.html
    if (!path.extname(pathname) && fs.existsSync(index)) target = index;
    else {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
  }
  const ext = path.extname(target).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=31536000, immutable',
  });
  fs.createReadStream(target).pipe(res);
}

const server = http.createServer((req, res) => {
  void (async () => {
    if (await handleApi(req, res)) return;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    serveStatic(pathname, res);
  })().catch((err: unknown) => {
    process.stderr.write(`[kpl-server] ${err instanceof Error ? err.message : String(err)}\n`);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  });
});

const shutdown = (): void => {
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 1500).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  process.stderr.write('[kpl-server] 未找到 dist/index.html，请先执行 pnpm build\n');
  process.exit(1);
}

server.listen(PORT, HOST, () => {
  process.stdout.write(`[kpl-server] http://${HOST}:${PORT}\n`);
  process.stdout.write(`[kpl-server] SQLite: ${DB_PATH}\n`);
});
