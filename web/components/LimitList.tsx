import { useMemo, useState } from 'react';
import type { DaySummary, DetailRow } from '../../shared/types';
import { dayLabel, money, pct } from '../format';

type Kind = 'limit' | 'broken' | 'all';
type SortKey = 'default' | 'seal' | 'change' | 'time';

const KINDS: Array<{ key: Kind; label: string }> = [
  { key: 'limit', label: '涨停' },
  { key: 'broken', label: '破板' },
  { key: 'all', label: '全部' },
];

function themeText(row: DetailRow): string {
  const extra = (row.themes ?? []).filter((t) => t && t !== row.reason);
  return extra.length ? extra.slice(0, 3).join(' / ') : (row.sector || '');
}

export default function LimitList({
  days, day, onDayChange, rows, loading, latest, selectedCode, onSelect,
}: {
  days: DaySummary[];
  day: string;
  onDayChange: (day: string) => void;
  rows: DetailRow[];
  loading: boolean;
  latest: DaySummary | undefined;
  selectedCode: string | null;
  onSelect: (row: DetailRow) => void;
}) {
  const [kind, setKind] = useState<Kind>('limit');
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('default');
  const [desc, setDesc] = useState(true);

  const index = days.findIndex((d) => d.day === day);
  const go = (delta: number): void => {
    const next = index + delta;
    if (next >= 0 && next < days.length) onDayChange(days[next]!.day);
  };

  const visible = useMemo(() => {
    const kw = query.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (kind !== 'all' && r.kind !== kind) return false;
      if (!kw) return true;
      return [r.code, r.name, r.reason, r.sector, ...(r.themes ?? [])]
        .some((s) => String(s ?? '').toLowerCase().includes(kw));
    });
    if (sortKey !== 'default') {
      list.sort((a, b) => {
        let diff = 0;
        if (sortKey === 'seal') diff = a.seal - b.seal;
        else if (sortKey === 'change') diff = a.change - b.change;
        else diff = a.time.localeCompare(b.time);
        return desc ? -diff : diff;
      });
    }
    return list;
  }, [rows, kind, query, sortKey, desc]);

  const toggleSort = (key: SortKey): void => {
    if (sortKey === key) setDesc((v) => !v);
    else { setSortKey(key); setDesc(key !== 'time'); }
  };
  const arrow = (key: SortKey): string => (sortKey !== key ? '' : desc ? ' ↓' : ' ↑');

  return (
    <section className="pane list-pane">
      <div className="pane-head">
        <div className="day-nav">
          <button className="nav-btn" onClick={() => go(1)} disabled={index < 0 || index >= days.length - 1}>
            ‹ 更早
          </button>
          <select
            className="day-select"
            value={day}
            onChange={(e) => onDayChange(e.target.value)}
            disabled={days.length === 0}
          >
            {days.length === 0 && <option value="">暂无日期</option>}
            {days.map((d) => (
              <option key={d.day} value={d.day}>
                {d.day} · 涨停 {d.limitCount}
              </option>
            ))}
          </select>
          <button className="nav-btn" onClick={() => go(-1)} disabled={index <= 0}>
            更新 ›
          </button>
          <span className="day-week">{day ? dayLabel(day).slice(11) : '—'}</span>
        </div>
        <div className="day-stats">
          <span>涨停 <b className="up">{latest?.limitCount ?? '—'}</b></span>
          <span>破板 <b className="down">{latest?.brokenCount ?? '—'}</b></span>
          <span>总封单 <b>{money(latest?.totalSeal ?? 0)}</b></span>
        </div>
      </div>

      <div className="list-tools">
        <div className="seg">
          {KINDS.map((k) => (
            <button key={k.key} className={kind === k.key ? 'active' : ''} onClick={() => setKind(k.key)}>
              {k.label}
            </button>
          ))}
        </div>
        <input
          className="search"
          value={query}
          placeholder="搜索代码 / 名称 / 题材"
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="tool-count">{visible.length} 只</span>
      </div>

      <div className="list-head">
        <span>#</span>
        <span>代码</span>
        <span>名称</span>
        <span>连板</span>
        <span>时间</span>
        <button onClick={() => toggleSort('seal')}>封单{arrow('seal')}</button>
        <span>题材</span>
        <button onClick={() => toggleSort('change')}>涨幅{arrow('change')}</button>
      </div>

      <div className="list-body">
        {loading ? (
          <div className="empty">读取当日涨停数据…</div>
        ) : visible.length === 0 ? (
          <div className="empty">
            {rows.length === 0 ? '这一天库里还没有数据' : '没有符合条件的个股'}
            <small>可在 tmux 中用 /api/scrape 补抓该交易日</small>
          </div>
        ) : (
          visible.map((r, i) => (
            <button
              key={`${r.code}-${r.kind}`}
              className={`list-row${selectedCode === r.code ? ' active' : ''}`}
              onClick={() => onSelect(r)}
            >
              <span className="c-idx">{i + 1}</span>
              <span className="c-code">{r.code}</span>
              <span className="c-name">
                <span className="name-line">
                  <b>{r.name}</b>
                  {r.kind === 'broken' && <i className="broken-chip">破板</i>}
                </span>
                <em>{(r.tags ?? []).join(' · ') || r.sector || '—'}</em>
              </span>
              <span className={`c-board${r.boards ? ' multi' : ''}`}>{r.boards || '首板'}</span>
              <span className="c-time">{r.time || '—'}</span>
              <span className="c-seal">{money(r.seal)}</span>
              <span className="c-reason">
                <b>{r.reason || '—'}</b>
                <em>{themeText(r) || '—'}</em>
              </span>
              <span className={`c-change ${r.change >= 0 ? 'up' : 'down'}`}>{pct(r.change)}</span>
            </button>
          ))
        )}
      </div>

      <div className="pane-foot">
        共 {visible.length} 只 · 点击任意一行切换右侧日K与分时
        <span>数据源 开盘啦 apphis.kaipanla.com</span>
      </div>
    </section>
  );
}
