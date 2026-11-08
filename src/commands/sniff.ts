import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OUTPUT_DIR, ensureOutputDir } from '../config.js';
import { writeCaptured, endpointsFile } from '../endpoints.js';
import { debug, info, ok, warn } from '../logger.js';
import type { CapturedEndpoint } from '../types.js';

/** 已知的概览/日志接口，默认不作为「新发现」上报 */
const IGNORED_ACTIONS = new Set([
  'UserLogin', 'CalUserClick', 'CalUserPage', 'GetVersionInfo', 'ActivePushMessageAll',
  'FocusFunGet', 'IOSCfgGet', 'SpecialBtn', 'GetIPList', 'DailyLimitIndex',
  'MarketStockZDNum', 'ChangeStatistics', 'ZhangTingExpression', 'ZhangTingPoBan',
  'SharpWithdrawalList', 'HisZhangFuDetail', 'WeightPerformance', 'MarketCapacityKLine',
]);

/**
 * 明细列表响应特征：多个 6 位股票代码 + 涨停时间格式。
 * 命中即认为「点日期」已触发列表加载，可提前结束拦截。
 */
function looksLikeDetail(body: string): boolean {
  if (body.length < 800) return false;
  const codes = body.match(/"\d{6}"/g);
  if ((codes?.length ?? 0) < 5) return false;
  return /\d{1,2}:\d{2}/.test(body) || /[\u4e00-\u9fa5]/.test(body);
}

const ADDON = `
from mitmproxy import http
import json, time
def response(flow):
    h = flow.request.pretty_host
    if "kaipanla" not in h and "longhuvip" not in h: return
    try:
        r = {"ts": time.time(), "method": flow.request.method, "url": flow.request.url,
             "req_body": flow.request.get_text() or "",
             "resp_body": flow.response.get_text() if flow.response else ""}
        with open("__CAPTURE_FILE__", "a", encoding="utf-8") as f:
            f.write(json.dumps(r, ensure_ascii=False) + "\\n")
    except Exception:
        pass
`;

export interface SniffOptions {
  seconds: number;
  port: number;
  pcap: boolean;
  iface: string;
}

interface Flow {
  method: string;
  url: string;
  req_body: string;
  resp_body: string;
}

function run(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    return '';
  }
}

function readFlows(file: string): Flow[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) as Flow; } catch { return null; } })
    .filter((f): f is Flow => f !== null);
}

function queryOf(flow: Flow): URLSearchParams {
  const src = flow.method === 'POST' ? flow.req_body : new URL(flow.url).search;
  return new URLSearchParams(src);
}

export async function runSniff(options: SniffOptions): Promise<void> {
  const mitmdump = fs.existsSync('/opt/homebrew/bin/mitmdump')
    ? '/opt/homebrew/bin/mitmdump'
    : (run('which', ['mitmdump']).trim() || 'mitmdump');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kpl-sniff-'));
  const captureFile = path.join(tmpDir, 'flows.jsonl');
  const addonFile = path.join(tmpDir, 'addon.py');
  ensureOutputDir();
  const pcapFile = path.join(OUTPUT_DIR, `kpl-socket-${Date.now()}.pcap`);
  fs.writeFileSync(addonFile, ADDON.replace('__CAPTURE_FILE__', captureFile.replace(/\\/g, '\\\\')), 'utf8');

  const children: ChildProcess[] = [];
  let proxyTouched = false;
  let stopped = false;

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    if (proxyTouched) {
      run('networksetup', ['-setwebproxystate', 'Wi-Fi', 'off']);
      run('networksetup', ['-setsecurewebproxystate', 'Wi-Fi', 'off']);
      ok('系统代理已恢复');
    }
    for (const child of children) {
      if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
    }
  };

  const onSignal = (): void => { stop(); process.exit(0); };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  try {
    children.push(spawn(mitmdump, [
      '--listen-port', String(options.port), '-s', addonFile, '--set', 'ssl_insecure=true',
    ], { stdio: 'ignore', detached: true }));

    if (options.pcap) {
      children.push(spawn('tcpdump', [
        '-i', options.iface, '-s', '0', '-w', pcapFile,
        'host 124.71.0.49 or host 115.238.124.232',
      ], { stdio: 'ignore', detached: true }));
    }

    await new Promise((r) => setTimeout(r, 2000));
    run('networksetup', ['-setwebproxy', 'Wi-Fi', '127.0.0.1', String(options.port)]);
    run('networksetup', ['-setsecurewebproxy', 'Wi-Fi', '127.0.0.1', String(options.port)]);
    proxyTouched = true;

    ok(`拦截已开启（最长 ${options.seconds}s，端口 ${options.port}）`);
    info('>>> 请现在在开盘啦 App 里点一下日期切换，看到列表刷新即可 <<<');
    info('抓到个股明细会自动结束；Ctrl+C 可提前结束；结束后自动恢复系统代理');

    const seen = new Set<string>();
    const started = Date.now();
    let detailFound = false;
    while (Date.now() - started < options.seconds * 1000) {
      await new Promise((r) => setTimeout(r, 1500));
      for (const flow of readFlows(captureFile)) {
        const q = queryOf(flow);
        const action = q.get('a') ?? '';
        const date = q.get('Date') ?? q.get('Day') ?? '';
        const key = `${flow.method}|${action}|${date}|${flow.resp_body.length}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!action) continue;

        if (looksLikeDetail(flow.resp_body)) {
          ok(`检测到个股明细响应：${flow.method} a=${action} c=${q.get('c') ?? ''} date=${date} resp=${flow.resp_body.length}B`);
          detailFound = true;
          break;
        }
        if (IGNORED_ACTIONS.has(action)) continue;
        ok(`发现新接口：${flow.method} a=${action} c=${q.get('c') ?? ''} date=${date} resp=${flow.resp_body.length}B`);
        debug(`  ${flow.url.slice(0, 180)}`);
      }
      if (detailFound) break;
    }

    stop();
    info('正在整理捕获结果…');

    const flows = readFlows(captureFile);
    const found = new Map<string, CapturedEndpoint>();
    for (const flow of flows) {
      const q = queryOf(flow);
      const action = q.get('a') ?? '';
      if (!action) continue;
      const isDetail = looksLikeDetail(flow.resp_body);
      // 明细响应一律保留；其余仅保留未在已知清单中的新接口
      if (!isDetail && IGNORED_ACTIONS.has(action)) continue;
      const controller = q.get('c') ?? '';
      const dateParam = q.get('Date') !== null ? 'Date' : q.get('Day') !== null ? 'Day' : '';
      const extraParams: Record<string, string> = {};
      for (const [k, v] of q.entries()) {
        if (!['a', 'c', 'Day', 'Date', 'DeviceID', 'PhoneOSNew', 'Token', 'UserID', 'VerSion', 'apiv'].includes(k)) {
          extraParams[k] = v;
        }
      }
      const key = `${flow.method}|${action}|${controller}`;
      if (found.has(key)) continue;
      found.set(key, {
        action, controller,
        method: flow.method === 'POST' ? 'POST' : 'GET',
        dateParam, extraParams,
        url: flow.url,
        sampleResponse: flow.resp_body.slice(0, 8000),
        capturedAt: new Date().toISOString(),
      });
    }

    const list = Array.from(found.values());
    if (list.length > 0) {
      writeCaptured(list);
      ok(`已写入 ${list.length} 个接口 → ${endpointsFile()}${detailFound ? '（已捕获明细，自动结束）' : ''}`);
      for (const ep of list) info(`  · ${ep.method} ${ep.action}/${ep.controller} (${ep.dateParam || '无日期参数'})`);
      info('现在运行 snapshot / serve 即可自动加载对应数据');
    } else {
      warn('没有捕获到新接口（日期可能未切换）。可加大 --seconds 后重试');
    }
    if (options.pcap && fs.existsSync(pcapFile)) {
      ok(`长连接抓包已保留：${pcapFile}（${fs.statSync(pcapFile).size} 字节）`);
    }
  } finally {
    stop();
    try {
      for (const f of [addonFile, captureFile]) if (fs.existsSync(f)) fs.unlinkSync(f);
      fs.rmdirSync(tmpDir);
    } catch { /* 临时目录清理失败不影响结果 */ }
  }
}
