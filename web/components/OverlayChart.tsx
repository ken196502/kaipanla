/**
 * 板块个股叠加图：
 * - 纵轴用百分比（窗口首日收盘 = 0%），不同价位的票才能叠在同一张图上比较；
 * - 选中的票画蜡烛：涨＝空心线框、跌＝实心，红涨绿跌；
 * - 同板块其它票用板块马卡龙单色细线叠加，只作背景参考；
 * - 横轴按窗口内交易日对齐，整图自适应宽度，不做左右滚动。
 */
import type { KlineMark, KlineRow } from '../../shared/types';

const W = 820;
const H = 520;
const PAD_L = 54;
const PAD_R = 18;
const TOP = 16;
const PLOT_BOTTOM = 410;
const AXIS_Y = 456;

const UP = '#d92b2b';
const DOWN = '#16a34a';
const GRID = '#e8edf3';
const ZERO = '#c3ccd8';

export interface OverlaySeries {
  code: string;
  name: string;
  /** 窗口内的日K，按日期升序 */
  rows: KlineRow[];
  /** 是否为当前选中的票 */
  active: boolean;
  /** 未选中时该股叠加线的颜色（每只个股一种） */
  color: string;
}

interface PctPoint {
  day: string;
  o: number;
  h: number;
  l: number;
  c: number;
}

function fmtPct(v: number, decimals = 0): string {
  if (Math.abs(v) < 0.05) return '0%';
  return `${v > 0 ? '+' : ''}${v.toFixed(decimals)}%`;
}

/** 以窗口内首个交易日收盘价为基准，换算成百分比 */
function toPct(rows: KlineRow[]): { base: number; baseDay: string; points: PctPoint[] } {
  const first = rows[0];
  if (!first || !first.close) return { base: 0, baseDay: '', points: [] };
  const k = 100 / first.close;
  return {
    base: first.close,
    baseDay: first.day,
    points: rows.map((r) => ({
      day: r.day,
      o: r.open * k - 100,
      h: r.high * k - 100,
      l: r.low * k - 100,
      c: r.close * k - 100,
    })),
  };
}

export default function OverlayChart({
  series, marks, baseLabel,
}: {
  series: OverlaySeries[];
  /** 选中票的涨停/破板标记 */
  marks: KlineMark[];
  /** 百分比基准说明，显示在图例右侧 */
  baseLabel: string;
}) {
  const days = [...new Set(series.flatMap((s) => s.rows.map((r) => r.day)))].sort();
  if (days.length === 0) {
    return (
      <div className="chart-empty">
        这个窗口还没有日K数据
        <small>日K由后台任务下载，下载完成后刷新即可</small>
      </div>
    );
  }

  const index = new Map(days.map((d, i) => [d, i]));
  const chartW = W - PAD_L - PAD_R;
  const step = chartW / days.length;
  const x = (i: number): number => PAD_L + step * i + step / 2;

  const prepared = series.filter((s) => s.rows.length > 0).map((s) => ({ ...s, ...toPct(s.rows) }));
  let min = Infinity;
  let max = -Infinity;
  for (const s of prepared) {
    for (const p of s.points) {
      if (p.l < min) min = p.l;
      if (p.h > max) max = p.h;
    }
  }
  if (!Number.isFinite(min)) { min = -1; max = 1; }
  min = Math.min(min, 0);
  max = Math.max(max, 0);
  const padding = (max - min) * 0.08 || 1;
  min -= padding;
  max += padding;
  const y = (p: number): number => PLOT_BOTTOM - ((p - min) / (max - min)) * (PLOT_BOTTOM - TOP);

  const gridVals = Array.from({ length: 5 }, (_, i) => min + ((max - min) * i) / 4);
  /** 区间窄时用一位小数，避免刻度都变成 0% */
  const decimals = (max - min) < 12 ? 1 : 0;
  const dateEvery = Math.max(1, Math.ceil(days.length / 8));
  const markMap = new Map(marks.map((m) => [m.day, m]));
  const active = prepared.find((s) => s.active);
  const others = prepared.filter((s) => !s.active);

  return (
    <div className="chart-wrap overlay-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="板块个股叠加日K">
        <rect x={PAD_L} y={TOP} width={chartW} height={PLOT_BOTTOM - TOP} fill="#fff" />
        {gridVals.map((v, i) => (
          <g key={i}>
            <line x1={PAD_L} y1={y(v)} x2={W - PAD_R} y2={y(v)} stroke={GRID} strokeWidth="1" />
            <text x={PAD_L - 6} y={y(v) + 3.5} textAnchor="end" className="axis-text">{fmtPct(v, decimals)}</text>
          </g>
        ))}
        <line x1={PAD_L} y1={y(0)} x2={W - PAD_R} y2={y(0)} stroke={ZERO} strokeWidth="1" strokeDasharray="4 3" />

        {!active && (
          <text x={PAD_L + chartW / 2} y={TOP + 18} textAnchor="middle" className="axis-text">
            选中个股在这个窗口没有日K数据
          </text>
        )}

        {/* 同板块其它个股：每只一种颜色 */}
        {others.map((s) => (
          <polyline
            key={s.code}
            points={s.points.map((p) => `${x(index.get(p.day) ?? 0).toFixed(1)},${y(p.c).toFixed(1)}`).join(' ')}
            fill="none"
            stroke={s.color}
            strokeWidth="1"
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity="0.6"
          >
            <title>{`${s.name || s.code} · 同板块其它个股`}</title>
          </polyline>
        ))}

        {/* 当前选中：涨空心线框、跌实心 */}
        {active && active.points.map((p) => {
          const i = index.get(p.day) ?? 0;
          const cx = x(i);
          const up = p.c >= p.o;
          const color = up ? UP : DOWN;
          const bodyW = Math.max(2, Math.min(10, step * 0.55));
          const yO = y(p.o);
          const yC = y(p.c);
          const mark = markMap.get(p.day);
          return (
            <g key={p.day}>
              <title>
                {`${p.day} 开 ${fmtPct(p.o, decimals)} 高 ${fmtPct(p.h, decimals)} 低 ${fmtPct(p.l, decimals)} 收 ${fmtPct(p.c, decimals)}`
                  + `${mark ? `\n${mark.kind === 'limit' ? '涨停' : '破板'}：${mark.reason || '—'}` : ''}`}
              </title>
              <line x1={cx} y1={y(p.h)} x2={cx} y2={y(p.l)} stroke={color} strokeWidth="1" />
              <rect
                x={cx - bodyW / 2}
                y={Math.min(yO, yC)}
                width={bodyW}
                height={Math.max(1.2, Math.abs(yC - yO))}
                fill={up ? '#fff' : color}
                stroke={color}
                strokeWidth="1.1"
              />
              {mark && (mark.kind === 'limit'
                ? <circle cx={cx} cy={PLOT_BOTTOM + 9} r="2.4" fill={UP} />
                : <circle cx={cx} cy={PLOT_BOTTOM + 9} r="2.2" fill="#fff" stroke={UP} strokeWidth="1.2" />)}
            </g>
          );
        })}

        {days.map((d, i) => (i % dateEvery === 0 ? (
          <text key={d} x={x(i)} y={AXIS_Y} textAnchor="middle" className="axis-text">{d.slice(5)}</text>
        ) : null))}
      </svg>
      <div className="chart-legend">
        <span><i className="lg-hollow" />选中·涨（空心）</span>
        <span><i className="lg-solid" />选中·跌（实心）</span>
        <span className="lg-multi">
          {others.slice(0, 4).map((s) => <i key={s.code} style={{ background: s.color }} />)}
          同板块其它个股（每只一色）
        </span>
        <span className="legend-right">{baseLabel}</span>
      </div>
    </div>
  );
}
