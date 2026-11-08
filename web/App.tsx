import { useCallback, useEffect, useState } from 'react';
import type { DaySummary, DetailRow, Health } from '../shared/types';
import { api } from './api';
import LimitList from './components/LimitList';
import StockPane from './components/StockPane';
import SurgeBoard from './components/SurgeBoard';

type View = 'review' | 'surge';

export default function App() {
  const [view, setView] = useState<View>('review');
  const [health, setHealth] = useState<Health | null>(null);
  const [days, setDays] = useState<DaySummary[]>([]);
  const [day, setDay] = useState('');
  const [rows, setRows] = useState<DetailRow[]>([]);
  const [selected, setSelected] = useState<DetailRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [stamp, setStamp] = useState(0);

  const loadDays = useCallback(async (): Promise<void> => {
    const [h, d] = await Promise.all([api.health(), api.days()]);
    setHealth(h);
    setDays(d.days);
    setDay((prev) => (prev && d.days.some((x) => x.day === prev) ? prev : (d.days[0]?.day ?? '')));
    setError('');
  }, []);

  useEffect(() => {
    void loadDays().catch((e: unknown) => {
      setError(`后端连接失败：${e instanceof Error ? e.message : String(e)}`);
    });
  }, [loadDays]);

  useEffect(() => {
    if (!day) return;
    let cancelled = false;
    setLoading(true);
    api.rows({ day })
      .then((r) => {
        if (cancelled) return;
        setRows(r.rows);
        setSelected(r.rows[0] ?? null);
        setError('');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setRows([]);
        setSelected(null);
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [day, stamp]);

  const handleRefresh = (): void => {
    setStamp((v) => v + 1);
    void loadDays().catch(() => undefined);
  };

  const latest = days.find((d) => d.day === day);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">啦</span>
          <div className="brand-text">
            <h1>开盘啦 · 涨停复盘</h1>
            <p>{view === 'review' ? '每日涨停板列表 / 个股日K' : '12 个月 · 自最低点涨幅统计'}</p>
          </div>
        </div>
        <nav className="view-tabs">
          <button className={view === 'review' ? 'active' : ''} onClick={() => setView('review')}>
            涨停复盘
          </button>
          <button className={view === 'surge' ? 'active' : ''} onClick={() => setView('surge')}>
            月度统计
          </button>
        </nav>
        <div className="topbar-right">
          {health ? (
            <span className="pill ok"><i className="dot" />后端在线</span>
          ) : (
            <span className="pill"><i className="dot pulse" />连接中</span>
          )}
          <span className="pill">{days.length} 个交易日</span>
          {health && <span className="pill">日K {(health.klineRows ?? 0).toLocaleString()} 根</span>}
          <button className="btn" onClick={handleRefresh} title="重新读取数据库">刷新</button>
        </div>
      </header>

      {view === 'review' && error && <div className="global-error">{error}</div>}

      {view === 'review' ? (
        <main className="workspace">
          <LimitList
            days={days}
            day={day}
            onDayChange={setDay}
            rows={rows}
            loading={loading}
            latest={latest}
            selectedCode={selected?.code ?? null}
            onSelect={setSelected}
          />
          <StockPane row={selected} day={day} />
        </main>
      ) : (
        <SurgeBoard />
      )}
    </div>
  );
}
