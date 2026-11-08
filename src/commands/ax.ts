/** 辅助功能通道：读取 App 当前「涨停表现」页，用于字段校准与人工核对（AXPress 不抢焦点） */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.js';
import { error, info, ok } from '../logger.js';

const BIN = path.join(ROOT, 'bin', 'kpl-ax');
const SRC = path.join(ROOT, 'tools', 'kpl-ax.m');

const ALLOWED = ['date', 'dump', 'dump-noscroll', 'info', 'prev', 'press', 'scroll'] as const;

export interface AxOptions {
  action: string;
  arg?: string;
  out?: string;
}

function ensureBinary(): void {
  if (fs.existsSync(BIN)) return;
  if (!fs.existsSync(SRC)) throw new Error(`缺少辅助功能源码：${SRC}`);
  info('首次使用，正在编译辅助功能工具…');
  execFileSync('clang', [
    '-fobjc-arc', '-framework', 'Foundation', '-framework', 'AppKit',
    '-framework', 'ApplicationServices', '-framework', 'CoreGraphics',
    SRC, '-o', BIN,
  ], { stdio: 'inherit' });
  ok(`已编译：${BIN}`);
}

export function runAx(options: AxOptions): void {
  if (!(ALLOWED as readonly string[]).includes(options.action)) {
    error(`未知动作 ${options.action}；可用：${ALLOWED.join(' / ')}`);
    return;
  }
  ensureBinary();
  const args = [options.action];
  if (options.action === 'press') {
    if (!options.arg) { error('press 需要指定按钮描述子串，例如 "date last"'); return; }
    args.push(options.arg);
  }
  try {
    const stdout = execFileSync(BIN, args, { encoding: 'utf8' });
    if (options.out) {
      const target = path.resolve(options.out);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, stdout, 'utf8');
      ok(`已写入：${target}`);
    } else {
      process.stdout.write(stdout.endsWith('\n') ? stdout : `${stdout}\n`);
    }
  } catch (err) {
    error(`辅助功能执行失败：${err instanceof Error ? err.message : String(err)}`);
    info('请确认「开盘啦」正在运行，且终端已被授予「辅助功能」权限（系统设置 → 隐私与安全性 → 辅助功能）');
  }
}
