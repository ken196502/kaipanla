#!/usr/bin/env python3
"""补抓「上一年度 12 月」的前复权日K，供月度统计 1 月窗口（去年12/1 ~ 今年1/31）使用。

用法（在 tmux 后台跑，避免占用前端 UI）：
    python3 tools/backfill_prev_december.py                       # 全量：新浪校准优先，已覆盖自动跳过
    python3 tools/backfill_prev_december.py --source tencent     # 腾讯 qfq 直取（未限流时最精确）
    python3 tools/backfill_prev_december.py --limit 20           # 冒烟测试
    python3 tools/backfill_prev_december.py --force              # 强制重抓（仍只覆盖 12 月那几天）

数据源与复权口径：
- 腾讯 fqkline/get（qfq）：已实测前复权价与请求区间无关，与库内 2026 年日K逐字段一致。
  但其 WAF 会在连续请求后返回 501 限流，因此不作为默认源。
- 新浪不复权日K + 仿射校准（默认）：腾讯历史日K不覆盖北交所，东财 push2his 在本机不可达，
  故用新浪（沪深京全覆盖）。库内 qfq 与新浪 raw 在一段无除权除息的区间内满足
  qfq = a * raw + b（送转股体现为 a，现金分红体现为 b，常见 a=1）。
  用「今年 1 月」的重叠交易日、四个价格字段拟合 (a,b)，要求：
    - 重叠 >= 4 天、12 月 >= 5 根日K
    - 四个价格最大相对残差 < 0.1%；若整月因子中途跳变（月内除权），
      改用 1 月最早的一段一致区间拟合，那才是去年 12 月适用的系数
    - 12 月内单日跳变 / 校准后 12-31 到次年首个交易日的跳空不超过涨跌停幅度
  验证：920368 用该法还原的 2025-12-01 与 12-31 开高低收，与东财 qfq 逐字段完全一致；
  沪深 25 只抽样 24 只通过校准。校准不过的票会回退腾讯单次尝试，仍失败则记入失败清单。

安全性：
- 只做 INSERT OR REPLACE（主键 code+day+adjust），绝不 DELETE，绝不改动今年已有日K；
- 不触碰 kline_symbols 的 name / limit_days / touch_days / last_limit_day 等元数据；
- 可重复运行：12 月已有 >= 15 根日K的代码自动跳过；
- 全局限速 + 重试，避免打爆公开接口。

注意：本脚本是一次性数据回补工具，不参与 Vite 服务运行；改前后端代码不需要重跑。
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import statistics
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / 'data' / 'kpl.sqlite'
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
TENCENT = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get'
SINA = 'https://quotes.sina.cn/cn/api/openapi.php/CN_MarketDataService.getKLineData'
ADJUST = 'qfq'
MIN_COVERED_DAYS = 5
PRICE_KEYS = ('open', 'high', 'low', 'close')


class NoDecemberData(Exception):
    """去年 12 月本就没有有效行情（今年新股 / 长期停牌 / 12 月末才上市）。"""

_limiter_lock = threading.Lock()
_next_slot = 0.0
_rps = 6.0


def rate_limit() -> None:
    """全局令牌间隔，所有 worker 共享。"""
    global _next_slot
    with _limiter_lock:
        now = time.monotonic()
        slot = max(now, _next_slot)
        _next_slot = slot + 1.0 / _rps
    delay = slot - time.monotonic()
    if delay > 0:
        time.sleep(delay)


def http_json(url: str, tries: int = 3) -> dict:
    last: Exception | None = None
    for i in range(tries):
        rate_limit()
        try:
            req = urllib.request.Request(
                url, headers={'User-Agent': UA, 'Accept': 'application/json, text/plain, */*'},
            )
            with urllib.request.urlopen(req, timeout=20) as resp:
                return json.loads(resp.read().decode('utf-8'))
        except Exception as exc:  # noqa: BLE001 - 网络异常统一重试
            last = exc
            if i < tries - 1:
                time.sleep((0.6, 2.0, 6.0)[min(i, 2)])
    raise RuntimeError(f'重试 {tries} 次仍失败：{last}')


def market(code: str) -> str:
    """与 server/lib/stockCode.ts 的 marketOf 保持一致。"""
    if code[:1] in ('4', '8', '9'):
        return 'bj'
    return 'sh' if code.startswith('6') else 'sz'


def pct(prev_close: float | None, value: float) -> float | None:
    if prev_close is None or prev_close <= 0:
        return None
    return round((value - prev_close) / prev_close * 100, 2)


def make_rows(
    code: str, ohlcv: list[tuple[str, float, float, float, float, float]], source: str,
) -> list[tuple]:
    """把 (day, open, high, low, close, volume) 转成 daily_kline 行，本地补涨跌幅/振幅。"""
    out = []
    prev_close: float | None = None
    for day, o, h, l, c, v in ohlcv:
        if min(o, h, l, c) <= 0:
            continue
        out.append((
            code, day, ADJUST, round(o, 3), round(h, 3), round(l, 3), round(c, 3),
            round(v, 2), None, pct(prev_close, c),
            None if prev_close is None else round((h - l) / prev_close * 100, 2),
            None, source,
        ))
        prev_close = c
    return out


def fetch_tencent(code: str, frm: str, to: str, tries: int = 3) -> list[tuple]:
    sym = market(code) + code
    param = f'{sym},day,{frm},{to},320,qfq'
    url = f'{TENCENT}?param={urllib.parse.quote(param, safe=",")}'
    payload = http_json(url, tries=tries)
    if payload.get('code') != 0:
        raise RuntimeError(f'腾讯返回异常 code={payload.get("code")}')
    bucket = payload.get('data', {}).get(sym, {})
    raw = bucket.get('qfqday') or bucket.get('day') or []
    rows: list[tuple[str, float, float, float, float, float]] = []
    for item in raw:
        if not isinstance(item, list) or len(item) < 6:
            continue
        day = str(item[0])
        if not (frm <= day <= to):
            continue
        o, c, h, l, v = (float(x) for x in item[1:6])
        if code.startswith(('688', '689')):
            v = round(v / 100)  # 腾讯科创板成交量单位是「股」
        rows.append((day, o, h, l, c, v))
    rows.sort(key=lambda r: r[0])
    return make_rows(code, rows, 'tencent')


def linfit(xs: list[float], ys: list[float]) -> tuple[float, float]:
    mx, my = statistics.fmean(xs), statistics.fmean(ys)
    den = sum((x - mx) ** 2 for x in xs)
    a = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den if den else 1.0
    return a, my - a * mx


def calibrate(
    sina: dict, jan_qfq: dict[str, tuple[float, float, float, float]], common: list[str],
) -> tuple[float, float, int]:
    """拟合 qfq = a*raw + b。

    若 1 月内发生除权（复权因子中途跳变），整月拟合残差会超标；此时退回到
    「1 月最早的一段一致区间」拟合——那才是去年 12 月适用的复权系数。
    返回 (a, b, 参与拟合的交易日数)。
    """
    def residual(days: list[str], a: float, b: float) -> float:
        worst = 0.0
        for day in days:
            for i, key in enumerate(PRICE_KEYS):
                q = float(jan_qfq[day][i])
                if q > 0:
                    worst = max(worst, abs((a * float(sina[day][key]) + b) - q) / q)
        return worst

    def fit(days: list[str]) -> tuple[float, float]:
        return linfit(
            [float(sina[d]['close']) for d in days],
            [float(jan_qfq[d][3]) for d in days],
        )

    a, b = fit(common)
    if residual(common, a, b) <= 0.001:
        return a, b, len(common)
    for n in range(len(common) - 1, 3, -1):
        days = common[:n]
        aa, bb = fit(days)
        if residual(days, aa, bb) <= 0.001:
            return aa, bb, n
    raise RuntimeError('1 月复权因子不一致且找不到足够长的一致前缀（疑似月内除权）')


def fetch_sina(
    code: str, frm: str, to: str,
    jan_qfq: dict[str, tuple[float, float, float, float]],
    first_jan_close: float | None,
) -> list[tuple]:
    """新浪不复权日K + 仿射校准，还原成与库内一致的前复权价。"""
    sym = market(code) + code
    url = f'{SINA}?symbol={sym}&scale=240&ma=no&datalen=300'
    payload = http_json(url)
    sina = {r['day']: r for r in payload.get('result', {}).get('data', []) if 'day' in r}
    common = sorted(set(sina) & set(jan_qfq))
    if len(common) < 4:
        raise NoDecemberData('1 月重叠不足 4 天，无法校准')
    a, b, _used = calibrate(sina, jan_qfq, common)
    days = sorted(d for d in sina if frm <= d <= to)
    if len(days) < MIN_COVERED_DAYS:
        # 12 月末才上市的次新股只有 1~2 根无涨跌幅限制的首日K，写进去会造出假低点
        raise NoDecemberData(f'12 月仅 {len(days)} 根日K')
    rows = []
    for day in days:
        r = sina[day]
        o, h, l, c = (a * float(r[k]) + b for k in PRICE_KEYS)
        # 新浪成交量单位是「股」，库内是「手」
        v = float(r.get('volume', 0)) / 100
        rows.append((day, o, h, l, c, v))
    # 12 月内若发生送转，1 月拟合出的系数不适用：用月内单日跳变 + 跨年跳空兜底检测
    limit = 0.40 if market(code) == 'bj' else 0.25  # 北交所日涨跌 30%，创业板/科创板 20%
    for prev, cur in zip(rows, rows[1:]):
        if prev[4] > 0 and abs(cur[4] / prev[4] - 1) > limit:
            raise RuntimeError(f'12 月内单日跳变 {(cur[4] / prev[4] - 1) * 100:.1f}%，疑似除权')
    if first_jan_close and rows:
        last_dec_close = rows[-1][4]
        if last_dec_close > 0 and abs(first_jan_close / last_dec_close - 1) > limit:
            raise RuntimeError(
                f'跨年跳空 {(first_jan_close / last_dec_close - 1) * 100:.1f}% 异常，疑似 12 月内除权',
            )
    return make_rows(code, rows, 'eastmoney')  # 价格口径与库内东财/腾讯 qfq 一致


def main() -> int:
    global _rps
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=0, help='只处理前 N 只（冒烟测试）')
    ap.add_argument('--force', action='store_true', help='忽略已有覆盖，强制重抓')
    ap.add_argument('--year', type=int, default=0, help='统计年份，默认取库内最新年份')
    ap.add_argument('--source', choices=('sina', 'tencent'), default='sina',
                    help='默认 sina（校准）；腾讯未限流时可用 tencent 直取 qfq')
    ap.add_argument('--rps', type=float, default=6.0, help='全局每秒请求数')
    args = ap.parse_args()
    _rps = args.rps

    db = sqlite3.connect(f'file:{DB_PATH}?mode=rw', uri=True)
    db.execute('PRAGMA journal_mode=WAL')
    db.execute('PRAGMA busy_timeout=15000')
    year = args.year or int(db.execute(
        "SELECT MAX(substr(day,1,4)) FROM daily_kline WHERE day < '9999-12-31'",
    ).fetchone()[0])
    frm, to = f'{year - 1}-12-01', f'{year - 1}-12-31'
    year_start = f'{year}-01-01'

    codes = [r[0] for r in db.execute(
        'SELECT DISTINCT code FROM daily_kline WHERE adjust=? AND day>=? ORDER BY code',
        (ADJUST, year_start),
    )]
    covered = {}
    if not args.force:
        covered = dict(db.execute(
            "SELECT code, COUNT(*) FROM daily_kline WHERE adjust=? AND day BETWEEN ? AND ? GROUP BY code",
            (ADJUST, frm, to),
        ))
    # 今年新上市的票去年 12 月根本没行情，不必请求（统计里也已整只排除）
    first_day_overall = db.execute(
        'SELECT MIN(day) FROM daily_kline WHERE adjust=? AND day>=?', (ADJUST, year_start),
    ).fetchone()[0]
    new_codes = {
        c for (c,) in db.execute(
            'SELECT code FROM daily_kline WHERE adjust=? AND day>=? GROUP BY code HAVING MIN(day) > ?',
            (ADJUST, year_start, first_day_overall),
        )
    }
    todo = [c for c in codes if covered.get(c, 0) < MIN_COVERED_DAYS and c not in new_codes]
    if args.limit:
        todo = todo[:args.limit]

    # 校准用的今年 1 月库内 qfq（提前在主线程读好，worker 不碰 DB）
    jan_qfq: dict[str, dict[str, tuple[float, float, float, float]]] = {}
    for c, day, o, h, l, cl in db.execute(
        "SELECT code,day,open,high,low,close FROM daily_kline "
        "WHERE adjust=? AND day BETWEEN ? AND ?",
        (ADJUST, f'{year}-01-01', f'{year}-01-31'),
    ):
        jan_qfq.setdefault(c, {})[day] = (o, h, l, cl)
    first_jan_close = {c: jan_qfq[c][min(jan_qfq[c])][3] for c in jan_qfq if jan_qfq[c]}

    rows_before = db.execute(
        'SELECT COUNT(*) FROM daily_kline WHERE adjust=? AND day>=?', (ADJUST, year_start),
    ).fetchone()[0]
    print(f'[启动] 库={DB_PATH} | 年份={year} | 补抓区间={frm}~{to} | 数据源={args.source} '
          f'| 限速={_rps}/s | 股票池={len(codes)} | 待抓={len(todo)} '
          f'| 今年已有日K={rows_before}', flush=True)

    insert = ('INSERT OR REPLACE INTO daily_kline '
              '(code,day,adjust,open,high,low,close,volume,amount,change_pct,amplitude,turnover,source) '
              'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    ok = empty = failed = written = 0
    failures: list[str] = []
    started = time.time()

    def work(code: str) -> tuple[str, list[tuple], str | None]:
        try:
            if args.source == 'tencent':
                return code, fetch_tencent(code, frm, to), None
            try:
                rows = fetch_sina(code, frm, to, jan_qfq.get(code, {}), first_jan_close.get(code))
            except NoDecemberData:
                return code, [], None
            except Exception as sina_err:  # noqa: BLE001
                # 校准失败的票再试一次腾讯（单次，不重试，避免限流时拖慢整批）
                try:
                    rows = fetch_tencent(code, frm, to, tries=1)
                except Exception as tx_err:  # noqa: BLE001
                    raise RuntimeError(f'新浪[{sina_err}] 腾讯[{tx_err}]') from sina_err
            return code, rows, None
        except Exception as exc:  # noqa: BLE001
            return code, [], str(exc)[:220]

    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(work, c): c for c in todo}
        for idx, fut in enumerate(as_completed(futures), 1):
            code, rows, err = fut.result()
            if err:
                failed += 1
                failures.append(f'{code}: {err}')
            elif not rows:
                empty += 1  # 今年新上市 / 长期停牌，去年 12 月本就没有行情
            else:
                try:
                    db.executemany(insert, rows)
                    db.commit()
                    ok += 1
                    written += len(rows)
                except Exception as exc:  # noqa: BLE001
                    db.rollback()
                    failed += 1
                    failures.append(f'{code}: 入库失败 {exc}')
            if idx % 100 == 0 or idx == len(todo):
                print(f'[进度] {idx}/{len(todo)} | 成功 {ok} | 无行情 {empty} | 失败 {failed} '
                      f'| 写入 {written} 行 | 耗时 {time.time() - started:.0f}s', flush=True)

    rows_after = db.execute(
        'SELECT COUNT(*) FROM daily_kline WHERE adjust=? AND day>=?', (ADJUST, year_start),
    ).fetchone()[0]
    dec = db.execute(
        'SELECT COUNT(*), COUNT(DISTINCT code), MIN(day), MAX(day) '
        'FROM daily_kline WHERE adjust=? AND day BETWEEN ? AND ?', (ADJUST, frm, to),
    ).fetchone()
    print(f'[完成] 12月日K {dec[0]} 行 / {dec[1]} 只 / {dec[2]}~{dec[3]} '
          f'| 今年日K 前后 {rows_before} → {rows_after}（必须相等）', flush=True)
    print(f'[汇总] 成功 {ok} | 无行情 {empty} | 失败 {failed} | 耗时 {time.time() - started:.0f}s', flush=True)
    for line in failures[:30]:
        print(f'  [失败] {line}', flush=True)
    if len(failures) > 30:
        print(f'  ... 另有 {len(failures) - 30} 条失败', flush=True)
    db.close()
    return 0 if rows_before == rows_after else 1


if __name__ == '__main__':
    raise SystemExit(main())
