import { useEffect, useState } from 'react';
import type { DetailRow, KlineSeriesResponse } from '../../shared/types';
import { money, pct, sourceLabel } from '../format';
import { api } from '../api';
import Candles from './Candles';

const WINDOWS = [
  { value: 60, label: '60' },
  { value: 90, label: '90' },
  { value: 160, label: '160' },
  { value: 500, label: '全部' },
];

/** 分时占位：只画坐标骨架，不请求任何分时数据 */
function IntradayPlaceholder({ row, day }: { row: DetailRow | null; day: string }) {
  return (
    <div className="intraday-pane">
      <div className="pane-subhead">
        <h2>分时走势</h2>
        <span className="tag-muted">暂未接入</span>
        <span className="subhead-right">{row ? `${row.name} · ${day}` : '—'}</span>
      </div>
      <div className="intraday-area">
        <svg viewBox="0 0 520 220" preserveAspectRatio="xMidYMid meet" role="img" aria-label="分时图占位">
          <rect x="42" y="12" width="466" height="166" fill="#fcfdff" stroke="#e8edf3" />
          {[0, 1, 2, 3, 4].map((i) => (
            <g key={i}>
              <line x1="42" y1={12 + i * 41.5} x2="508" y2={12 + i * 41.5} stroke="#e8edf3" strokeWidth="1" />
              <text x="36" y={16 + i * 41.5} textAnchor="end" className="axis-text">
                {['+10%', '+5%', '0', '-5%', '-10%'][i]}
              </text>
            </g>
          ))}
          {[275, 508].map((px, i) => (
            <line key={i} x1={px} y1="12" x2={px} y2="178" stroke="#e8edf3" strokeWidth="1" strokeDasharray="3 3" />
          ))}
          <line x1="42" y1="95" x2="508" y2="95" stroke="#c9d2df" strokeWidth="1" strokeDasharray="5 4" />
          {['09:30', '10:30', '11:30/13:00', '14:00', '15:00'].map((t, i) => (
            <text key={t} x={42 + i * 116.5} y="198" textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'} className="axis-text">
              {t}
            </text>
          ))}
        </svg>
        <div className="intraday-mask">
          <b>分时数据暂不下载</b>
          <span>布局已就位 · 选中个股会同步切换到这里</span>
        </div>
      </div>
    </div>
  );
}

export default function StockPane({ row, day }: { row: DetailRow | null; day: string }) {
  const [series, setSeries] = useState<KlineSeriesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [windowSize, setWindowSize] = useState(90);

  const code = row?.code ?? '';
  useEffect(() => {
    if (!code) { setSeries(null); return; }
    let cancelled = false;
    setLoading(true);
    setError('');
    api.klineSeries(code)
      .then((r) => { if (!cancelled) setSeries(r); })
      .catch((e: unknown) => {
        if (!cancelled) { setSeries(null); setError(e instanceof Error ? e.message : String(e)); }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [code]);

  const source = series?.rows[0]?.source;

  return (
    <section className="pane stock-pane">
      <div className="stock-head">
        {row ? (
          <>
            <div className="stock-title">
              <b>{row.name}</b>
              <span className="mono">{row.code}</span>
              <span className={`stock-badge${row.boards ? ' multi' : ''}`}>{row.boards || '首板'}</span>
              {row.kind === 'broken' && <span className="stock-badge broken">破板</span>}
            </div>
            <div className="stock-sub">
              {row.time || '—'} 封板 · {row.reason || '—'} · 封单 {money(row.seal)}
            </div>
            <div className="stock-price">
              <span className={row.change >= 0 ? 'up' : 'down'}>{pct(row.change)}</span>
              <span className="mono">¥ {row.price.toFixed(2)}</span>
            </div>
          </>
        ) : (
          <div className="stock-title muted">左侧选择一只个股</div>
        )}
      </div>

      <div className="chart-pane">
        <div className="pane-subhead">
          <h2>日K</h2>
          <div className="seg small">
            {WINDOWS.map((w) => (
              <button key={w.value} className={windowSize === w.value ? 'active' : ''} onClick={() => setWindowSize(w.value)}>
                {w.label}
              </button>
            ))}
          </div>
          <span className="subhead-right">
            {source ? sourceLabel(source) : '前复权'}
          </span>
        </div>
        <div className="chart-area">
          {loading ? (
            <div className="chart-empty">读取 {code} 日K…</div>
          ) : error ? (
            <div className="chart-empty">日K读取失败：{error}</div>
          ) : (
            <Candles rows={series?.rows ?? []} marks={series?.marks ?? []} windowSize={windowSize} />
          )}
        </div>
        {series && series.total > 0 && (
          <div className="chart-foot">
            库内 {series.total} 根 · 今年涨停/破板标记 {series.marks.length} 天
            · 红涨绿跌，实心红点＝收盘涨停，空心＝盘中破板
          </div>
        )}
      </div>

      <IntradayPlaceholder row={row} day={day} />
    </section>
  );
}
