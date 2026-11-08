import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type {
  KlineMultiResponse, SurgeBasis, SurgeHit, SurgeMonth, SurgeResponse, SurgeScope,
} from '../../shared/types';
import { api } from '../api';
import { buildSectorColors, buildStockColors, familyLegend } from '../sectorColors';
import type { SectorColor } from '../sectorColors';
import OverlayChart from './OverlayChart';

const BASIS_OPTIONS: Array<{ value: SurgeBasis; label: string }> = [
  { value: 'low-high', label: '最低价 → 其后最高价' },
  { value: 'close', label: '收盘价 → 其后收盘价' },
  { value: 'range', label: '窗口内最高 / 最低（不限先后）' },
];
const SCOPE_OPTIONS: Array<{ value: SurgeScope; label: string }> = [
  { value: 'all', label: '全部触板股' },
  { value: 'limit', label: '仅收盘涨停股' },
];
const THRESHOLD_PRESETS = [30, 50, 80, 100];
/** 0 = 全部展开 */
const PER_GROUP_OPTIONS = [5, 10, 20, 0];

interface Selection {
  hit: SurgeHit;
  month: SurgeMonth;
}

interface SectorGroup {
  sector: string;
  items: SurgeHit[];
  /** 该板块在 12 列合计的命中数：组头提示里的横向参考 */
  yearCount: number;
}

/** 板块的统计口径信息：全年合计数量 + 配色 */
interface SectorMeta {
  yearCount: number;
  color: SectorColor;
}

function shortDay(day: string): string {
  return day ? day.slice(5) : '—';
}

/**
 * 板块是否命中搜索：关键词按空白（含全角空格）拆成多个，任一词命中即算命中板块（OR）。
 * 单个词的命中条件：板块名包含该词，或组内任一股票代码 / 名称包含该词。
 * 空关键词（含纯空白）＝全部命中。
 */
function sectorMatchesGroup(group: SectorGroup, keyword: string): boolean {
  const terms = keyword.toLowerCase().split(/[\s\u3000]+/).filter(Boolean);
  if (terms.length === 0) return true;
  const sector = group.sector.toLowerCase();
  return terms.some((term) => sector.includes(term)
    || group.items.some((h) => h.code.includes(term) || h.name.toLowerCase().includes(term)));
}

/**
 * 列内按板块分组：板块按「本月命中股票数」降序，股票数更多的板块放上面，
 * 每月都能一眼看出哪个板块强、哪个板块弱；并列时按板块名固定；组内按涨幅降序。
 * yearCount 只用于组头提示里的全年合计数字。
 */
function groupBySector(
  items: SurgeHit[], sectorMeta: Map<string, SectorMeta>,
): SectorGroup[] {
  const map = new Map<string, SurgeHit[]>();
  for (const hit of items) {
    const list = map.get(hit.sector) ?? [];
    list.push(hit);
    map.set(hit.sector, list);
  }
  return [...map.entries()]
    .map(([sector, list]) => ({
      sector,
      items: [...list].sort((a, b) => b.gainPct - a.gainPct || a.code.localeCompare(b.code)),
      yearCount: sectorMeta.get(sector)?.yearCount ?? 0,
    }))
    .sort((a, b) => b.items.length - a.items.length || a.sector.localeCompare(b.sector, 'zh'));
}

/**
 * 点击某只票后展开的板块详情：
 * - 图表区间＝同板块所有个股里「最早的最低点日」~「最晚的最高点日」，
 *   正好覆盖该板块每只票的完整波段，可跨月甚至跨年；
 * - 纵轴是相对各自起点收盘的百分比，选中票红绿（涨空心 / 跌实心），其它票每只一色叠加；
 * - 下方列出同板块本月个股，点一下直接切换主图，不用关面板重选。
 */
function HitDrawer({
  selection, peers, onClose,
}: {
  selection: Selection;
  /** 同板块本月全部命中个股 */
  peers: SurgeHit[];
  onClose: () => void;
}) {
  const { month } = selection;
  const [activeCode, setActiveCode] = useState(selection.hit.code);
  const [overlay, setOverlay] = useState(true);
  const [multi, setMulti] = useState<KlineMultiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const activeHit = peers.find((p) => p.code === activeCode) ?? selection.hit;

  /**
   * 起点：把同板块所有个股的最低点日排一遍，谁最早就用谁。
   * 该日 = 全图起点 = 0% 基准，其余个股也从这一天开始画（跨月无妨）。
   */
  const anchor = useMemo(
    () => peers.reduce<SurgeHit>(
      (best, p) => (p.baseDay < best.baseDay ? p : best),
      peers[0] ?? selection.hit,
    ),
    [peers, selection.hit],
  );

  /** 终点：把同板块所有个股的最高点日排一遍，谁最晚就用谁 */
  const tail = useMemo(
    () => peers.reduce<SurgeHit>(
      (best, p) => (p.peakDay > best.peakDay ? p : best),
      peers[0] ?? selection.hit,
    ),
    [peers, selection.hit],
  );

  // 展示窗口：最早最低点 ~ 最晚最高点，正好覆盖板块内每只票的完整波段
  // baseDay / peakDay 均为 YYYY-MM-DD，字典序即日期序，直接比较即可
  const from = anchor.baseDay;
  const to = tail.peakDay > from ? tail.peakDay : from;

  const codesKey = [...new Set(peers.map((p) => p.code))].join(',');

  /** 每只同板块个股一种颜色：色相黄金角散开，明度/饱和度分档，列表色点与曲线一一对应 */
  const stockColors = useMemo(
    () => buildStockColors(selection.hit.sector, codesKey ? codesKey.split(',') : []),
    [selection.hit.sector, codesKey],
  );

  useEffect(() => {
    let cancelled = false;
    const list = codesKey ? codesKey.split(',') : [];
    if (list.length === 0) {
      setMulti(null);
      return undefined;
    }
    setLoading(true);
    setError('');
    api.klineMulti(list, from, to)
      .then((r) => { if (!cancelled) setMulti(r); })
      .catch((e: unknown) => {
        if (cancelled) return;
        setMulti(null);
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [codesKey, from, to]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const series = (multi?.series ?? []).map((s) => ({
    code: s.code,
    name: s.name,
    rows: s.rows,
    active: s.code === activeCode,
    color: stockColors.get(s.code) ?? '#9aa7b8',
  }));
  const shown = overlay ? series : series.filter((s) => s.active);
  const activeMarks = multi?.series.find((s) => s.code === activeCode)?.marks ?? [];
  const lastDay = multi?.series.flatMap((s) => s.rows.map((r) => r.day)).sort().at(-1) ?? '';

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="surge-drawer" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <div className="drawer-title">
            <b>{activeHit.name || activeHit.code}</b>
            <span className="mono">{activeHit.code}</span>
            <span className="drawer-month-chip">{month.label}归属</span>
          </div>
          <button className="drawer-close" onClick={onClose} title="关闭（Esc）">✕</button>
        </header>

        <div className="drawer-info">
          <div className="drawer-info-row">
            <span className="drawer-sector-chip">板块 · {activeHit.sector}</span>
            <span>产生窗口 {activeHit.windowMonth} 月</span>
            <span>波段 {activeHit.baseDay} ~ {activeHit.peakDay}</span>
            <span className="drawer-info-gain">自最低点涨幅 <b className="up">+{activeHit.gainPct.toFixed(2)}%</b></span>
          </div>
          <div className="drawer-info-row">
            <span>图表区间 {shortDay(from)} ~ {shortDay(to)}{lastDay && lastDay < to ? `（数据到 ${shortDay(lastDay)}）` : ''}</span>
            <span className="drawer-info-anchor">
              0% 基准 · {anchor.name || anchor.code} {anchor.baseDay} 收盘（板块最早最低点）
            </span>
            <span className="drawer-info-tail">
              截止 · {tail.name || tail.code} {tail.peakDay}（板块最晚最高点）
            </span>
            <span>最低点 {activeHit.baseDay} ¥{activeHit.basePrice.toFixed(2)}</span>
            <span>其后最高点 {activeHit.peakDay} ¥{activeHit.peakPrice.toFixed(2)}</span>
            <span>跨越 {activeHit.sessions} 个交易日 · 窗口内 {series.find((s) => s.code === activeHit.code)?.rows.length ?? '—'} 根日K</span>
          </div>
          <div className="drawer-info-row drawer-info-owner">
            <b>归属依据</b>
            <span>{activeHit.ownerNote}</span>
          </div>
        </div>

        <div className="drawer-chart">
          {loading ? (
            <div className="chart-empty">读取同板块 {codesKey ? codesKey.split(',').length : 0} 只个股日K…</div>
          ) : error ? (
            <div className="chart-empty">日K读取失败：{error}</div>
          ) : (
            <OverlayChart
              series={shown}
              marks={activeMarks}
              baseLabel={`纵轴＝相对 ${anchor.baseDay} 收盘的涨跌幅（0% 为基准）`}
            />
          )}
        </div>

        <div className="drawer-peers">
          <div className="drawer-peers-head">
            <b>同板块 · {month.label} · {peers.length} 只</b>
            <span className="drawer-peers-hint">点一下直接切换 K 线</span>
            <label className="drawer-peers-toggle">
              <input
                type="checkbox"
                checked={overlay}
                onChange={(e) => setOverlay(e.target.checked)}
              />
              叠加全部个股
            </label>
          </div>
          <div className="drawer-peers-list">
            {peers.map((p) => (
              <button
                key={p.code}
                className={`peer-chip${p.code === activeCode ? ' is-active' : ''}${p.code === anchor.code ? ' is-anchor' : ''}${p.code === tail.code ? ' is-tail' : ''}`}
                onClick={() => setActiveCode(p.code)}
                title={`${p.name} ${p.code}\n${p.baseDay} ¥${p.basePrice.toFixed(2)} → ${p.peakDay} ¥${p.peakPrice.toFixed(2)}\n${p.ownerNote}${p.code === anchor.code ? '\n★ 本图 0% 基准（板块最早最低点）' : ''}${p.code === tail.code ? '\n★ 本图截止日（板块最晚最高点）' : ''}\n点击切换K线`}
              >
                <i className="peer-dot" style={{ background: stockColors.get(p.code) ?? '#9aa7b8' }} />
                <b>{p.name || p.code}</b>
                <i className="mono">{p.code}</i>
                {p.code === anchor.code && <i className="peer-anchor">基准</i>}
                {p.code === tail.code && <i className="peer-tail">截止</i>}
                <em className="peer-gain">+{p.gainPct.toFixed(1)}%</em>
              </button>
            ))}
          </div>
        </div>

        <footer className="drawer-foot">
          百分比坐标 · 涨空心跌实心 · 选中红绿、同板块其它个股每只一色
          <span>实心红点＝收盘涨停，空心＝盘中破板</span>
        </footer>
      </aside>
    </div>
  );
}

function MonthColumn({
  month, keyword, sectorMeta, activeCode, perGroup, collapsed, expanded,
  onToggleGroup, onToggleAll, onToggleExpand, onSelect,
}: {
  month: SurgeMonth;
  keyword: string;
  sectorMeta: Map<string, SectorMeta>;
  activeCode: string;
  perGroup: number;
  collapsed: Record<string, boolean>;
  expanded: Record<string, boolean>;
  onToggleGroup: (key: string) => void;
  onToggleAll: (keys: string[], value: boolean) => void;
  onToggleExpand: (key: string) => void;
  onSelect: (hit: SurgeHit) => void;
}) {
  const groups = useMemo(
    () => groupBySector(month.items, sectorMeta),
    [month.items, sectorMeta],
  );
  const hitSectors = keyword
    ? groups.filter((g) => sectorMatchesGroup(g, keyword)).length
    : groups.length;
  const keys = groups.map((g) => `${month.month}|${g.sector}`);
  const allCollapsed = keys.length > 0 && keys.every((k) => collapsed[k]);
  const noData = month.status === 'upcoming';

  return (
    <section className={`surge-col status-${month.status}`}>
      <div className="surge-col-head">
        <div className="surge-col-title">
          <span className="surge-col-name">
            <b>{month.label}</b>
            {month.partial && (
              <span className="surge-col-partial">（数据截至 {shortDay(month.actualTo)}）</span>
            )}
          </span>
          <span className="surge-col-count">{month.total} 只</span>
        </div>
        <div className="surge-col-window" title={month.note || undefined}>
          {month.prevYearIncluded ? `去年${shortDay(month.windowFrom)}` : shortDay(month.windowFrom)}
          {' – '}{shortDay(month.windowTo)} · {month.sectorCount} 个板块
        </div>
        {month.prevYearIncluded && <div className="surge-col-flag">含去年 12 月 · 两月窗口</div>}
        {month.status === 'empty' && <div className="surge-col-flag">无命中</div>}
        {groups.length > 0 && (
          <button
            className="surge-col-tools"
            onClick={() => onToggleAll(keys, !allCollapsed)}
            title={allCollapsed ? '展开本列全部板块' : '折叠本列全部板块'}
          >
            {allCollapsed ? '展开全部板块' : '折叠全部板块'}
          </button>
        )}
      </div>

      <div className="surge-col-body">
        {noData ? (
          <div className="surge-col-empty">{month.note}</div>
        ) : groups.length === 0 ? (
          <div className="surge-col-empty">没有涨幅达标的个股</div>
        ) : groups.map((group) => {
          const key = `${month.month}|${group.sector}`;
          const isCollapsed = !!collapsed[key];
          const sectorHit = sectorMatchesGroup(group, keyword);
          const showAll = perGroup === 0 || !!expanded[key] || (!!keyword && sectorHit);
          const visible = showAll ? group.items : group.items.slice(0, perGroup);
          const meta = sectorMeta.get(group.sector);
          const groupStyle = meta ? ({
            '--sector-bg': meta.color.bg,
            '--sector-accent': meta.color.accent,
          } as CSSProperties) : undefined;
          return (
            <div
              className={`surge-group${sectorHit ? '' : ' is-dim'}`}
              key={group.sector}
              style={groupStyle}
            >
              <button
                className={`surge-group-head${isCollapsed ? ' is-collapsed' : ''}`}
                onClick={() => onToggleGroup(key)}
                title={`${group.sector} · 本月 ${group.items.length} 只 / 全年合计 ${group.yearCount} 只\n点击${isCollapsed ? '展开' : '折叠'}`}
              >
                <i className="surge-group-caret">{isCollapsed ? '▸' : '▾'}</i>
                <span className="surge-group-name">{group.sector}</span>
                <span className="surge-group-count">{group.items.length}</span>
              </button>
              {!isCollapsed && (
                <div className="surge-group-body">
                  {visible.map((hit) => (
                    <button
                      key={hit.code}
                      className={`surge-hit${activeCode === hit.code ? ' is-active' : ''}`}
                      onClick={() => onSelect(hit)}
                      title={`${hit.name} ${hit.code}\n${hit.baseDay} ¥${hit.basePrice.toFixed(2)} → ${hit.peakDay} ¥${hit.peakPrice.toFixed(2)}\n${hit.ownerNote}\n点击查看波段日K`}
                    >
                      <span className="hit-main">
                        <b className="hit-name">{hit.name || hit.code}</b>
                        <i className="hit-code mono">{hit.code}</i>
                        <em className="hit-gain up">+{hit.gainPct.toFixed(2)}%</em>
                      </span>
                      <span className="hit-sub">
                        {shortDay(hit.baseDay)} ¥{hit.basePrice.toFixed(2)} → {shortDay(hit.peakDay)} ¥{hit.peakPrice.toFixed(2)}
                        <i> · {hit.sessions}日</i>
                      </span>
                    </button>
                  ))}
                  {!showAll && group.items.length > perGroup && (
                    <button className="surge-more" onClick={() => onToggleExpand(key)}>
                      展开剩余 {group.items.length - perGroup} 只
                    </button>
                  )}
                  {showAll && perGroup > 0 && !keyword && group.items.length > perGroup && (
                    <button className="surge-more" onClick={() => onToggleExpand(key)}>收起</button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="surge-col-foot">
        {noData
          ? '待数据'
          : `全部 ${month.total} 只 / ${month.sectorCount} 板块${keyword ? ` · 命中 ${hitSectors} 板块` : ''}${perGroup > 0 && !keyword ? ` · 每组前 ${perGroup}` : ''}`}
      </div>
    </section>
  );
}

export default function SurgeBoard() {
  const [data, setData] = useState<SurgeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [year, setYear] = useState(0);
  const [threshold, setThreshold] = useState(50);
  const [thresholdDraft, setThresholdDraft] = useState('50');
  const [basis, setBasis] = useState<SurgeBasis>('low-high');
  const [scope, setScope] = useState<SurgeScope>('all');
  const [excludeNew, setExcludeNew] = useState(true);
  const [perGroup, setPerGroup] = useState(5);
  const [search, setSearch] = useState('');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async (force = false): Promise<void> => {
    setLoading(true);
    try {
      const result = await api.surgeMonths({
        ...(year ? { year } : {}), threshold, basis, scope, excludeNew, force,
      });
      setData(result);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [year, threshold, basis, scope, excludeNew]);

  useEffect(() => { void load(); }, [load]);
  // 口径或股票池变化后，旧抽屉里的命中依据已失效，直接关闭
  useEffect(() => { setSelection(null); }, [year, threshold, basis, scope, excludeNew]);

  const years = data?.availableYears.length ? data.availableYears : [new Date().getFullYear()];
  const activeYear = year || data?.year || years[0]!;
  const keyword = search.trim().toLowerCase();
  const activeCode = selection?.hit.code ?? '';
  /** 板块元信息：全年合计命中数 + 马卡龙配色（按行业分冷暖，族内用深浅区分） */
  const sectorMeta = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of data?.months ?? []) {
      for (const hit of m.items) counts.set(hit.sector, (counts.get(hit.sector) ?? 0) + 1);
    }
    const colors = buildSectorColors(counts.keys());
    const meta = new Map<string, SectorMeta>();
    for (const [sector, yearCount] of counts) {
      meta.set(sector, {
        yearCount,
        color: colors.get(sector) ?? { family: 'misc', bg: '#f4f7fb', accent: '#cbd5e1' },
      });
    }
    return meta;
  }, [data]);
  const sectorTotal = sectorMeta.size;

  /** 抽屉里的「同板块其他个股」：当月同板块的全部命中个股（不受搜索框影响） */
  const peers = useMemo(() => {
    if (!selection) return [];
    const m = data?.months.find((x) => x.month === selection.month.month);
    return (m?.items ?? []).filter((i) => i.sector === selection.hit.sector);
  }, [selection, data]);

  const commitThreshold = (): void => {
    const n = Number(thresholdDraft);
    if (Number.isFinite(n) && n >= 1 && n <= 1000) setThreshold(Math.round(n));
    else setThresholdDraft(String(threshold));
  };

  const toggleGroup = (key: string): void => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };
  const toggleAll = (keys: string[], value: boolean): void => {
    setCollapsed((prev) => {
      const next = { ...prev };
      for (const key of keys) next[key] = value;
      return next;
    });
  };
  const toggleExpand = (key: string): void => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  /** 标题行全局按钮：作用于 12 列当前可见的全部板块分组（跟随搜索过滤结果） */
  const allGroupKeys = useMemo(() => {
    const keys: string[] = [];
    for (const m of data?.months ?? []) {
      for (const g of groupBySector(m.items, sectorMeta)) {
        keys.push(`${m.month}|${g.sector}`);
      }
    }
    return keys;
  }, [data, sectorMeta]);
  const allCollapsed = allGroupKeys.length > 0 && allGroupKeys.every((k) => collapsed[k]);
  const allExpanded = allGroupKeys.length > 0 && allGroupKeys.every((k) => !collapsed[k]);
  const setAllCollapsed = (value: boolean): void => {
    const next: Record<string, boolean> = {};
    if (value) for (const key of allGroupKeys) next[key] = true;
    // 展开时直接清空，顺带复位被搜索过滤掉的分组旧状态
    setCollapsed(next);
  };

  return (
    <main className={`surge-page${loading && data ? ' is-loading' : ''}`}>
      <div className="surge-toolbar">
        <div className="surge-heading">
          <div>
            <b>月度涨幅统计</b>
            <span>每月「上月 + 当月」两月窗口（1 月＝去年 12 月 + 1 月）；按自然月归属、同一波只归一列；排除新股；按涨停板块分类，每月板块按当月股票数降序（强的在上），板块色按行业冷暖区分</span>
          </div>
          <div className="surge-heading-right">
            {loading && <span className="surge-busy">统计中…</span>}
            <button
              className="btn"
              disabled={!allGroupKeys.length || allExpanded}
              onClick={() => setAllCollapsed(false)}
              title={allExpanded ? '当前已全部展开' : '展开 12 列全部板块分组（与每列「展开全部板块」同义）'}
            >全部展开</button>
            <button
              className="btn"
              disabled={!allGroupKeys.length || allCollapsed}
              onClick={() => setAllCollapsed(true)}
              title={allCollapsed ? '当前已全部折叠' : '折叠 12 列全部板块分组（与每列「折叠全部板块」同义）'}
            >全部折叠</button>
            <button className="btn" onClick={() => void load(true)} title="强制重新读取数据库">刷新</button>
          </div>
        </div>

        <div className="surge-controls">
          <label>年份
            <select value={activeYear} onChange={(e) => setYear(Number(e.target.value))}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <label>涨幅阈值
            <span className="threshold-box">
              <input
                type="number" min={1} max={1000} value={thresholdDraft}
                onChange={(e) => setThresholdDraft(e.target.value)}
                onBlur={commitThreshold}
                onKeyDown={(e) => { if (e.key === 'Enter') commitThreshold(); }}
              />
              <i>%</i>
            </span>
          </label>
          <div className="seg small">
            {THRESHOLD_PRESETS.map((t) => (
              <button
                key={t} className={threshold === t ? 'active' : ''}
                onClick={() => { setThreshold(t); setThresholdDraft(String(t)); }}
              >
                {t}%
              </button>
            ))}
          </div>
          <label>价格口径
            <select value={basis} onChange={(e) => setBasis(e.target.value as SurgeBasis)}>
              {BASIS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label>股票池
            <select value={scope} onChange={(e) => setScope(e.target.value as SurgeScope)}>
              {SCOPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label>新股
            <div className="seg small">
              <button className={excludeNew ? 'active' : ''} onClick={() => setExcludeNew(true)}>排除</button>
              <button className={!excludeNew ? 'active' : ''} onClick={() => setExcludeNew(false)}>包含</button>
            </div>
          </label>
          <label>每组显示
            <select value={perGroup} onChange={(e) => setPerGroup(Number(e.target.value))}>
              {PER_GROUP_OPTIONS.map((n) => (
                <option key={n} value={n}>{n === 0 ? '全部' : `前 ${n} 只`}</option>
              ))}
            </select>
          </label>
          <input
            className="search surge-search" value={search}
            placeholder="代码 / 名称 / 板块 · 空格分隔多个关键词"
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {error && <div className="surge-error">统计失败：{error}</div>}

        <div className="surge-summary">
          {data ? (
            <>
              <span>日K <b>{data.firstDay ?? '—'} ~ {data.lastDay ?? '—'}</b></span>
              <span>标的 <b>{data.universe.toLocaleString()}</b> 只{data.excludeNew && <span>（排除新股 {data.excludedNewStocks}）</span>}</span>
              <span>扫描 <b>{data.rowsScanned.toLocaleString()}</b> 根</span>
              <span className={data.prevDecemberRows > 0 ? '' : 'surge-summary-note'}>
                去年 12 月 <b>{data.prevDecemberRows.toLocaleString()}</b> 根 / <b>{data.prevDecemberCodes.toLocaleString()}</b> 只
              </span>
              <span>12 列合计 <b className="up">{data.totalHits.toLocaleString()}</b> 条</span>
              <span>去重 <b>{data.duplicatesRemoved.toLocaleString()}</b> 次 · 板块 <b>{sectorTotal}</b> 类</span>
              <span className="surge-summary-note">{data.fromCache ? '缓存命中' : `计算 ${data.elapsedMs} ms`}</span>
            </>
          ) : (
            <span>正在读取全年日K…</span>
          )}
        </div>

        <div className="surge-legend">
          <span className="surge-legend-title">板块色系</span>
          {familyLegend().map((f) => (
            <span className="surge-legend-item" key={f.family}>
              <i style={{ background: f.bg, borderColor: f.accent }} />
              {f.label}
            </span>
          ))}
          <span className="surge-legend-note">冷色＝科技成长，暖色＝周期消费，绿色＝新能源医药；同系板块用深浅区分</span>
        </div>
      </div>

      <div className="surge-grid">
        {!data && loading ? (
          <div className="surge-loading">正在按 12 个月扫描日K，首次统计约需几秒…</div>
        ) : (data?.months ?? []).map((month) => (
          <MonthColumn
            key={month.month}
            month={month}
            keyword={keyword}
            sectorMeta={sectorMeta}
            activeCode={activeCode}
            perGroup={perGroup}
            collapsed={collapsed}
            expanded={expanded}
            onToggleGroup={toggleGroup}
            onToggleAll={toggleAll}
            onToggleExpand={toggleExpand}
            onSelect={(hit) => setSelection({ hit, month })}
          />
        ))}
      </div>

      {selection && (
        <HitDrawer
          key={`${selection.hit.code}|${selection.month.month}`}
          selection={selection}
          peers={peers}
          onClose={() => setSelection(null)}
        />
      )}
    </main>
  );
}
