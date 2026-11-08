#!/usr/bin/env node
import { Command } from 'commander';
import { CONFIG, resolveDay } from './config.js';
import { setVerbose } from './logger.js';
import { runSnapshot } from './commands/snapshot.js';
import { runServe } from './commands/serve.js';
import { runSniff } from './commands/sniff.js';
import { runProbe } from './commands/probe.js';
import { runYear } from './commands/year.js';
import { runAx } from './commands/ax.js';

const program = new Command();
program
  .name('kpl-review')
  .description('开盘啦「市场情绪 / 涨停表现」全年复盘 CLI（纯接口驱动，按交易日回溯，支持全年批量抓取）')
  .version('0.1.0')
  .option('-d, --day <YYYY-MM-DD>', '交易日，默认今天', resolveDay())
  .option('-v, --verbose', '输出调试日志', false)
  .hook('preAction', (cmd) => {
    const opts = cmd.optsWithGlobals<{ verbose?: boolean }>();
    setVerbose(Boolean(opts.verbose));
  });

program
  .command('snapshot')
  .description('抓取数据并生成内嵌数据的单文件 HTML 快照')
  .option('-o, --out <path>', '输出路径（默认 output/kpl-<日期>.html）')
  .action(async (_local: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<{ day: string; out?: string }>();
    await runSnapshot({ day: resolveDay(opts.day), out: opts.out });
  });

program
  .command('serve')
  .description('启动本地复盘页面，按间隔自动刷新数据')
  .option('-p, --port <number>', '监听端口', String(CONFIG.defaultPort))
  .option('--host <host>', '监听地址', '127.0.0.1')
  .option('--refresh <ms>', '刷新间隔（毫秒）', '5000')
  .action(async (_local: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<{ day: string; port: string; host: string; refresh: string }>();
    await runServe({
      day: resolveDay(opts.day),
      port: Number(opts.port) || CONFIG.defaultPort,
      host: opts.host,
      refreshMs: Number(opts.refresh) || 5000,
    });
  });

program
  .command('sniff')
  .description('临时拦截 App 请求：在 App 里点一次日期，自动记录真实接口到 endpoints.json')
  .option('--seconds <n>', '拦截时长（秒）', '180')
  .option('--port <number>', '本地代理端口', '8899')
  .option('--no-pcap', '不抓取长连接数据包')
  .option('--iface <name>', '抓包网卡', 'en0')
  .action(async (_local: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<{ seconds: string; port: string; pcap: boolean; iface: string }>();
    await runSniff({
      seconds: Number(opts.seconds) || 180,
      port: Number(opts.port) || 8899,
      pcap: opts.pcap !== false,
      iface: opts.iface,
    });
  });

program
  .command('year')
  .description('批量抓取全年交易日的涨停表现明细，生成全年复盘网页')
  .option('--year <YYYY>', '年份，默认今年')
  .option('--from <YYYY-MM-DD>', '起始交易日（覆盖 --year）')
  .option('--to <YYYY-MM-DD>', '结束交易日（覆盖 --year）')
  .option('-c, --concurrency <n>', '并发数 1-8，默认 4', '4')
  .option('--force', '忽略逐日缓存，强制重抓', false)
  .option('--no-html', '只生成 JSON，不生成网页')
  .option('-o, --out <path>', '网页输出路径')
  .action(async (_local: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<{
      year?: string; from?: string; to?: string; concurrency: string;
      force: boolean; html: boolean; out?: string;
    }>();
    await runYear({
      year: opts.year,
      from: opts.from,
      to: opts.to,
      concurrency: Number(opts.concurrency) || 4,
      force: Boolean(opts.force),
      html: opts.html !== false,
      out: opts.out,
    });
  });

program
  .command('ax <action>')
  .description('辅助功能：读取/切换 App 当前页（date/dump/prev/info/press/scroll），用于字段校准，不抢焦点')
  .argument('[arg]', 'press 动作的按钮描述子串')
  .option('-o, --out <path>', '把 JSON 结果写入文件')
  .action((action: string, arg: string | undefined, _local: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<{ out?: string }>();
    runAx({ action, arg, out: opts.out });
  });

program
  .command('probe')
  .description('自检接口连通性与明细解析')
  .action(async (_local: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<{ day: string }>();
    await runProbe(resolveDay(opts.day));
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`kpl-review: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
