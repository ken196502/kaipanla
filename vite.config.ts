import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleApi } from './server/api.js';

type NextFn = (err?: unknown) => void;
type MiddlewareStack = {
  use: (fn: (req: IncomingMessage, res: ServerResponse, next: NextFn) => void) => unknown;
};

/**
 * 把 Node API 后端挂到 Vite 的 connect 中间件上。
 * 开发（vite）与预览（vite preview）共用同一套 /api 路由与同一个 SQLite 实例，
 * 生产独立服务器见 server/standalone.ts（复用 server/api.ts 的 handleApi）。
 */
function kplApiBackend(): Plugin {
  const attach = (stack: MiddlewareStack): void => {
    stack.use((req, res, next) => {
      void handleApi(req, res)
        .then((handled) => {
          if (!handled) next();
        })
        .catch((err: unknown) => next(err));
    });
  };
  return {
    name: 'kpl-api-backend',
    configureServer(server) {
      attach(server.middlewares as unknown as MiddlewareStack);
    },
    configurePreviewServer(server) {
      attach(server.middlewares as unknown as MiddlewareStack);
    },
  };
}

export default defineConfig({
  plugins: [react(), kplApiBackend()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.KPL_PORT ?? 5173),
    watch: {
      ignored: ['**/.git/**', '**/node_modules/**', '**/data/**', '**/output/cache/**'],
    },
  },
  preview: {
    host: '127.0.0.1',
    port: Number(process.env.KPL_PORT ?? 4173),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
  },
});
