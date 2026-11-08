import type { KlineMark, KlineRow } from '../../shared/types';

const W = 520;
const H = 300;
const PAD_L = 46;
const PAD_R = 12;
const TOP = 12;
const PRICE_BOTTOM = 196;
const VOL_TOP = 212;
const VOL_BOTTOM = 258;
const AXIS_Y = 282;

const UP = '#d92b2b';
const DOWN = '#16a34a';
const GRID = '#e8edf3';
const LABEL = '#8590a0';
const MA5 = '#e0930c';
const MA20 = '#2f6fd0';

/** 中国习惯：涨红跌绿 */
function color(open: number, close: number): string {
  return close >= open ? UP : DOWN;
}

function maPath(asc: KlineRow[], n: number, x: (i: number) => number, y: (p: number) => number): string {
  const points: string[] = [];
  for (let i = n - 1; i < asc.length; i += 1) {
    let sum = 0;
    for (let j = i - n + 1; j <= i; j += 1) sum += asc[j]!.close;
    points.push(`${x(i).toFixed(1)},${y(sum / n).toFixed(1)}`);
  }
  return points.join(' ');
}

export default function Candles({
  rows, marks, windowSize,
}: {
  /** API 返回日期降序，组件内部反转为升序 */
  rows: KlineRow[];
  marks: KlineMark[];
  windowSize: number;
}) {
  if (rows.length === 0) {
    return <div className="chart-empty">这只票还没有日K数据<small>日K由后台任务下载，下载完成后刷新即可</small></div>;
  }

  const asc = [...rows].reverse().slice(-windowSize);
  const lows = asc.map((r) => r.low);
  const highs = asc.map((r) => r.high);
  let min = Math.min(...lows);
  let max = Math.max(...highs);
  const padding = (max - min) * 0.08 || max * 0.02 || 1;
  min -= padding;
  max += padding;
  const y = (p: number): number => PRICE_BOTTOM - ((p - min) / (max - min)) * (PRICE_BOTTOM - TOP);

  const chartW = W - PAD_L - PAD_R;
  const step = chartW / asc.length;
  const bodyW = Math.max(1.4, Math.min(9, step * 0.62));
  const x = (i: number): number => PAD_L + step * i + step / 2;
  const maxVol = Math.max(1, ...asc.map((r) => r.volume));
  const dateEvery = Math.max(1, Math.ceil(asc.length / 6));
  const markMap = new Map(marks.map((m) => [m.day, m]));
  const grid = Array.from({ length: 5 }, (_, i) => min + ((max - min) * i) / 4);

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="日K蜡烛图">
        <rect x={PAD_L} y={TOP} width={chartW} height={PRICE_BOTTOM - TOP} fill="#fff" />
        {grid.map((p, i) => (
          <g key={i}>
            <line x1={PAD_L} y1={y(p)} x2={W - PAD_R} y2={y(p)} stroke={GRID} strokeWidth="1" />
            <text x={PAD_L - 6} y={y(p) + 3.5} textAnchor="end" className="axis-text">{p.toFixed(2)}</text>
          </g>
        ))}
        <line x1={PAD_L} y1={VOL_TOP - 6} x2={W - PAD_R} y2={VOL_TOP - 6} stroke={GRID} strokeWidth="1" />

        {asc.map((r, i) => {
          const cx = x(i);
          const c = color(r.open, r.close);
          const yO = y(r.open);
          const yC = y(r.close);
          const volH = (r.volume / maxVol) * (VOL_BOTTOM - VOL_TOP);
          const mark = markMap.get(r.day);
          const chg = r.changePct === null ? '—' : `${r.changePct > 0 ? '+' : ''}${r.changePct.toFixed(2)}%`;
          return (
            <g key={r.day}>
              <title>
                {`${r.day}  开 ${r.open.toFixed(2)} 高 ${r.high.toFixed(2)} 低 ${r.low.toFixed(2)} 收 ${r.close.toFixed(2)}\n涨跌幅 ${chg}  量 ${Math.round(r.volume).toLocaleString()} 手${mark ? `\n${mark.kind === 'limit' ? '涨停' : '破板'}：${mark.reason || '—'}` : ''}`}
              </title>
              <line x1={cx} y1={y(r.high)} x2={cx} y2={y(r.low)} stroke={c} strokeWidth="1" />
              <rect x={cx - bodyW / 2} y={Math.min(yO, yC)} width={bodyW} height={Math.max(1.2, Math.abs(yC - yO))} fill={c} />
              <rect x={cx - bodyW / 2} y={VOL_BOTTOM - volH} width={bodyW} height={Math.max(0.6, volH)} fill={c} opacity="0.55" />
              {mark && (mark.kind === 'limit'
                ? <circle cx={cx} cy={VOL_BOTTOM + 8} r="2.4" fill={UP} />
                : <circle cx={cx} cy={VOL_BOTTOM + 8} r="2.2" fill="#fff" stroke={UP} strokeWidth="1.2" />)}
              {i % dateEvery === 0 && (
                <text x={cx} y={AXIS_Y} textAnchor="middle" className="axis-text">{r.day.slice(5)}</text>
              )}
            </g>
          );
        })}

        {asc.length >= 5 && (
          <polyline points={maPath(asc, 5, x, y)} fill="none" stroke={MA5} strokeWidth="1.2" opacity="0.9" />
        )}
        {asc.length >= 20 && (
          <polyline points={maPath(asc, 20, x, y)} fill="none" stroke={MA20} strokeWidth="1.2" opacity="0.9" />
        )}
      </svg>
      <div className="chart-legend">
        <span><i style={{ background: UP }} />涨</span>
        <span><i style={{ background: DOWN }} />跌</span>
        <span><i style={{ background: MA5 }} />MA5</span>
        <span><i style={{ background: MA20 }} />MA20</span>
        <span><i className="mark-dot" />涨停</span>
        <span className="legend-right">最近 {asc.length} / {rows.length} 根 · 前复权</span>
      </div>
    </div>
  );
}
