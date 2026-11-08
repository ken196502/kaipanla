type Level = 'info' | 'ok' | 'warn' | 'error' | 'debug';

const prefix: Record<Level, string> = {
  info: '·',
  ok: '✓',
  warn: '!',
  error: '✗',
  debug: '›',
};

let verbose = false;

export function setVerbose(value: boolean): void {
  verbose = value;
}

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function log(level: Level, message: string): void {
  if (level === 'debug' && !verbose) return;
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(`[${stamp()}] ${prefix[level]} ${message}\n`);
}

export const info = (m: string) => log('info', m);
export const ok = (m: string) => log('ok', m);
export const warn = (m: string) => log('warn', m);
export const error = (m: string) => log('error', m);
export const debug = (m: string) => log('debug', m);
