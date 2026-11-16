import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { History, RefreshCw, Filter, CheckCircle2, AlertTriangle, Timer } from 'lucide-react';
import { ScanDecisionRow, ScanHistoryResponse } from '../types';
import { formatPersianDateTime } from '../utils/dateTime';
import { GATE_LABELS, gateLabel, OUTCOME_VIEW } from '../utils/scanGates';
import { apiUrl } from '../utils/api';

const RANGES = [
  { hours: 1, label: '۱ ساعت' },
  { hours: 6, label: '۶ ساعت' },
  { hours: 24, label: '۲۴ ساعت' },
];

const faNum = (n: number): string => n.toLocaleString('fa-IR');

const faClock = (iso: string): string => {
  const { jalaliDate, time24 } = formatPersianDateTime(iso);
  return jalaliDate && time24 ? `${jalaliDate} ${time24}` : '—';
};

export const ScanHistoryPanel: React.FC = () => {
  const [hours, setHours] = useState<number>(6);
  const [gate, setGate] = useState<string>('');
  const [symbol, setSymbol] = useState<string>('');
  const [data, setData] = useState<ScanHistoryResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (range: number, gateFilter: string, symbolFilter: string) => {
    try {
      const params = new URLSearchParams({ hours: String(range), limit: '200' });
      if (gateFilter) params.set('gate', gateFilter);
      if (symbolFilter) params.set('symbol', symbolFilter);
      const res = await fetch(apiUrl(`/api/scan-history?${params.toString()}`));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ScanHistoryResponse;
      if (!json.ok) throw new Error('پاسخ نامعتبر از سرور');
      setData(json);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'خواندن تاریخچه ناموفق بود');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void load(hours, gate, symbol);
  }, [hours, gate, symbol, load]);

  // به‌روزرسانی دوره‌ای — تب پنهان درخواست نمی‌فرستد
  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden) return;
      void load(hours, gate, symbol);
    }, 20_000);
    return () => clearInterval(id);
  }, [hours, gate, symbol, load]);

  const stats = useMemo(() => {
    const byGate = data?.byGate || [];
    const total = byGate.reduce((sum, g) => sum + g.count, 0);
    const signals = byGate.filter((g) => g.outcome === 'signal').reduce((s, g) => s + g.count, 0);
    const max = byGate.reduce((m, g) => Math.max(m, g.count), 0) || 1;
    return { byGate, total, signals, max };
  }, [data]);

  const recent: ScanDecisionRow[] = data?.recent || [];

  return (
    <div className="mystic-frame rounded-2xl border border-[#0f3a55]/60 bg-[#071522]/75 backdrop-blur-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 border-b border-[#0f3a55]/50">
        <div className="flex items-center gap-2 min-w-0">
          <History className="w-4 h-4 text-[#58a6ff]" />
          <span className="text-xs font-bold text-white">تاریخچهٔ رد اسکن‌ها</span>
          <span className="text-[10px] text-[#8b949e]">
            اولین دروازه‌ای که جلوی هر اسکن را گرفته — بدون صدا زدن API
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {RANGES.map((r) => (
            <button
              key={r.hours}
              onClick={() => setHours(r.hours)}
              className={`px-2 py-1 rounded-md border text-[10px] transition cursor-pointer ${
                hours === r.hours
                  ? 'bg-[#1a5a7a]/40 text-[#e6f6ff] border-[#1a5a7a]'
                  : 'bg-[#0b1a26]/60 text-[#8b949e] border-[#1a3040] hover:text-[#c9d1d9]'
              }`}
            >
              {r.label}
            </button>
          ))}
          <button
            onClick={() => void load(hours, gate, symbol)}
            className="mystic-btn flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] transition cursor-pointer"
            title="به‌روزرسانی دستی"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            <span>به‌روزرسانی</span>
          </button>
        </div>
      </div>

      <div className="px-3.5 py-2.5 space-y-3">
        {/* فیلتر بر اساس دروازه و نماد */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] pb-2 border-b border-[#161b22]">
          <Filter className="w-3 h-3 text-[#58a6ff]" />
          <label className="flex items-center gap-1 text-[#8b949e]">
            <span>دروازه:</span>
            <select
              value={gate}
              onChange={(e) => setGate(e.target.value)}
              className="bg-[#0b1a26] border border-[#1a3040] rounded px-1.5 py-0.5 text-[10px] text-[#c9d1d9] cursor-pointer"
              title="فقط ردهای یک دروازهٔ خاص"
            >
              <option value="">همه</option>
              {Object.keys(GATE_LABELS).map((g) => (
                <option key={g} value={g}>
                  {gateLabel(g)} ({g})
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1 text-[#8b949e]">
            <span>نماد:</span>
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="bg-[#0b1a26] border border-[#1a3040] rounded px-1.5 py-0.5 text-[10px] text-[#c9d1d9] cursor-pointer"
              title="فقط ردیف‌های یک نماد"
            >
              <option value="">همه</option>
              {['XAUUSD', 'XAGUSD', 'USOIL', 'DXY'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
              <option value="-">سیستم / بازار (-)</option>
            </select>
          </label>

          {(gate || symbol) && (
            <button
              onClick={() => {
                setGate('');
                setSymbol('');
              }}
              className="px-2 py-0.5 rounded border border-[#1a3040] text-[#8b949e] hover:text-[#c9d1d9] hover:border-[#1a5a7a] transition cursor-pointer"
            >
              پاک کردن فیلتر
            </button>
          )}

          {(gate || symbol) && (
            <span className="text-[#e3b341]">
              فیلتر فعال: {gate ? gateLabel(gate) : 'همهٔ دروازه‌ها'} · {symbol || 'همهٔ نمادها'}
            </span>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-1.5 text-[11px] text-[#f85149]">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>{error}</span>
          </div>
        )}

        {!error && !data && loading && (
          <div className="text-[11px] text-[#8b949e]">در حال خواندن تاریخچه…</div>
        )}

        {data && stats.total === 0 && (
          <div className="text-[11px] text-[#8b949e]">
            در {RANGES.find((r) => r.hours === hours)?.label} گذشته
            {gate || symbol ? ' با این فیلتر ' : ' '}
            ردیفی ثبت نشده است (اسکن خودکار هر ۱۵ ثانیه اجرا می‌شود).
          </div>
        )}

        {data && stats.total > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-[10px]">
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded border bg-[#0b1a26]/70 text-[#c9d1d9] border-[#1a3040]">
                <Filter className="w-3 h-3 text-[#58a6ff]" />
                کل تصمیم‌ها: <span className="font-mono">{faNum(stats.total)}</span>
              </span>
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded border bg-[#238636]/10 text-[#3fb950] border-[#238636]/40">
                <CheckCircle2 className="w-3 h-3" />
                سیگنال: <span className="font-mono">{faNum(stats.signals)}</span>
              </span>
              {stats.byGate[0] && (
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded border bg-[#0b1a26]/70 text-[#8b949e] border-[#1a3040]">
                  <Timer className="w-3 h-3" />
                  بیشترین دلیل: <span className="text-[#e3b341]">{gateLabel(stats.byGate[0].gate)}</span>
                  <span className="font-mono">({faNum(stats.byGate[0].count)})</span>
                </span>
              )}
              <span className="text-[10px] text-[#586069] mr-auto">
                هر ۲۰ ثانیه خودکار به‌روز می‌شود
              </span>
            </div>

            {/* تفکیک دروازه‌ها */}
            <div className="space-y-1.5">
              {stats.byGate.slice(0, 8).map((g) => {
                const view = OUTCOME_VIEW[g.outcome] || OUTCOME_VIEW.skipped;
                const pct = Math.round((g.count / stats.total) * 100);
                return (
                  <div key={`${g.gate}-${g.outcome}`} className="text-[10px]" title={g.lastReason}>
                    <div className="flex items-center gap-2">
                      <span className="w-[150px] shrink-0 truncate text-[#c9d1d9]">{gateLabel(g.gate)}</span>
                      <span className="w-11 shrink-0 font-mono text-[#8b949e]" dir="ltr">
                        {faNum(g.count)}
                      </span>
                      <span className="w-9 shrink-0 font-mono text-[#586069]" dir="ltr">
                        {pct}%
                      </span>
                      <div className="flex-1 h-1.5 rounded-full bg-[#0b1a26] overflow-hidden">
                        <div
                          className={`h-full rounded-full ${g.outcome === 'signal' ? 'bg-[#39b56a]' : 'bg-[#b8862a]'}`}
                          style={{ width: `${Math.max(2, (g.count / stats.max) * 100)}%` }}
                        />
                      </div>
                      <span className={`shrink-0 px-1.5 py-0.5 rounded border text-[9px] ${view.cls}`}>{view.label}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ردیف‌های اخیر */}
            <div className="border-t border-[#21262d] pt-2">
              <div className="flex items-center justify-between text-[10px] text-[#8b949e] mb-1">
                <span>آخرین تصمیم‌ها</span>
                <span>{faNum(recent.length)} ردیف</span>
              </div>
              <div className="max-h-56 overflow-y-auto divide-y divide-[#161b22]">
                {recent.slice(0, 40).map((r) => {
                  const view = OUTCOME_VIEW[r.outcome] || OUTCOME_VIEW.skipped;
                  return (
                    <div key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1 text-[10px]">
                      <span className="font-mono text-[#8b949e] shrink-0" dir="ltr">
                        {faClock(r.scannedAt)}
                      </span>
                      <span className="font-mono text-[#c9d1d9] shrink-0" dir="ltr">
                        {r.symbol}
                      </span>
                      <span className={`shrink-0 px-1.5 py-0.5 rounded border text-[9px] ${view.cls}`}>{view.label}</span>
                      {r.gate && <span className="text-[#e3b341] shrink-0">{gateLabel(r.gate)}</span>}
                      <span className="text-[#8b949e] truncate max-w-full" title={r.reason}>
                        {r.reason}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
