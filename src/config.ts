import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// CLI/独立服务：模块位于 <root>/src 或 <root>/dist-cli，取上一级即项目根。
// Vite dev：vite.config.ts 会被打包到 node_modules/.vite-temp 下的临时文件，
// 此时 import.meta.url 不可靠，优先用 cwd（Vite 始终在项目根启动）或 KPL_ROOT 显式指定。
const projectRootFromModule = path.resolve(here, '..');
const cwd = process.cwd();
const projectRoot = process.env.KPL_ROOT
  ?? (fs.existsSync(path.join(cwd, 'package.json')) ? cwd : projectRootFromModule);
export const ROOT = projectRoot;
export const DATA_DIR = path.join(ROOT, 'data');
export const TOOLS_DIR = path.join(ROOT, 'tools');
export const BIN_DIR = path.join(TOOLS_DIR, 'bin');
export const BRIDGE_BIN = path.join(BIN_DIR, 'bridge');
export const OUTPUT_DIR = path.join(ROOT, 'output');

/** 极简 .env 读取，避免为一个变量引入额外依赖 */
function readDotEnv(): Record<string, string> {
  const file = path.join(ROOT, '.env');
  const result: Record<string, string> = {};
  if (!fs.existsSync(file)) return result;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

const env = { ...readDotEnv(), ...process.env } as Record<string, string | undefined>;

export const CONFIG = {
  apiBase: env.KPL_API_BASE ?? 'https://apphis.kaipanla.com/w1/api/index.php',
  deviceId: env.KPL_DEVICE_ID ?? '6848911c41ed27748232e5cea60493a5b98c867a',
  version: env.KPL_VERSION ?? '6.2.30.2',
  apiv: env.KPL_APIV ?? 'w47',
  userAgent: 'kpl-review/0.1.0',
  defaultPort: Number(env.KPL_PORT ?? 5173),
  defaultDay: env.KPL_DAY ?? '',
  windowName: env.KPL_WINDOW_NAME ?? '开盘啦',
} as const;

/** 公共查询参数：接口免登录，Token/UserID 固定为 0 */
export function commonParams(day?: string): Record<string, string> {
  const params: Record<string, string> = {
    DeviceID: CONFIG.deviceId,
    PhoneOSNew: '2',
    Token: '0',
    UserID: '0',
    VerSion: CONFIG.version,
    apiv: CONFIG.apiv,
  };
  if (day) params.Day = day;
  return params;
}

export function ensureOutputDir(): void {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/** 默认取最近一个自然日；周末/节假日由接口返回空数据时可显式传 --day */
export function resolveDay(explicit?: string): string {
  if (explicit && /^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit;
  if (CONFIG.defaultDay) return CONFIG.defaultDay;
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
