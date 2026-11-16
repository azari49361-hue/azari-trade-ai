import React, { useEffect, useMemo, useState } from 'react';
import { History, AlertTriangle, Zap } from 'lucide-react';
import { ScanDecisionRow } from '../types';
import { gateLabel, OUTCOME_VIEW } from '../utils/scanGates';
import { formatPersianDateTime } from '../utils/dateTime';
import { apiUrl } from '../utils/api';

interface SignalScanPathProps {
  symbol: string;
  candleOpenTime?: string | null;
}

const faNum = (n: number): string => n.toLocaleString('fa-IR');

const faTime = (iso: string): string => {
  const { time24 } = formatPersianDateTime(iso);
  return time24 || '—';
};

/**
 * ردیف‌های تاریخچهٔ اسکن مربوط به همان کندلِ یک سیگنال.
 * نشان می‌دهد سیگنال روی این کندل از کدام دروازه‌ها گذشته تا صادر شده است.
 */
export const SignalScanPath: React.FC<SignalScanPathProps> = ({ symbol, candleOpenTime }) => {
  const [rows, setRows] = useState<ScanDecisionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!candleOpenTime) return;
    let cancelled = false;
    setRows(null);
    setError(null);

    void (async () => {
      try {
        const url = `/api/scan-history/candle?symbol=${encodeURIComponent(symbol)}&candle=${encodeURIComponent(
          candleOpenTime
        )}`;
        const res = await fetch(apiUrl(url));
        const json: any = await res.json().catch(() => ({}));
        if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
        if (!cancelled) setRows(json.rows as ScanDecisionRow[]);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'خواندن مسیر اسکن ناموفق بود');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [symbol, candleOpenTime]);

  const summary = useMemo(() => {
    if (!rows) return null;
    const skipped = rows.filter((r) => r.outcome === 'skipped').length;
    const signals = rows.filter((r) => r.outcome === 'signal').length;
    const blocked = rows.filter((r) => r.outcome === 'blocked' || r.outcome === 'deduped' || r.outcome === 'error').length;
    const gates = Array.from(new Set(rows.filter((r) => r.gate).map((r) => r.gate as string)));
    return { skipped, signals, blocked, gates };
  }, [rows]);

  /** ردیف‌های تکراری پشت‌سرهم (همان دروازه/نتیجه/دلیل) در یک ردیف با تعداد و بازهٔ زمانی ادغام می‌شوند. */
  const grouped = useMemo(() => {
    type Group = {
      key: string;
      gate: string | null;
      outcome: string;
      reason: string;
      count: number;
      firstAt: string;
      lastAt: string;
    };
    const out: Group[] = [];
    for (const r of rows || []) {
      const last = out[out.length - 1];
      if (last && last.gate === r.gate && last.outcome === r.outcome && last.reason === r.reason) {
        last.count += 1;
        last.lastAt = r.scannedAt;
        continue;
      }
      out.push({
        key: `${r.id}`,
        gate: r.gate,
        outcome: r.outcome,
        reason: r.reason,
        count: 1,
        firstAt: r.scannedAt,
        lastAt: r.scannedAt,
      });
    }
    return out;
  }, [rows]);

  if (!candleOpenTime) {
    return (
      <div className="mt-2 rounded-lg border border-[#21262d] bg-[#0b1a26]/60 px-2.5 py-2 text-[10px] text-[#8b949e]">
        کندل مرجع این سیگنال ثبت نشده است، پس مسیر اسکن قابل بازیابی نیست.
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-[#1a3040] bg-[#0b1a26]/70 px-2.5 py-2 text-[10px]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[#8b949e]">
        <History className="w-3 h-3 text-[#58a6ff]" />
        <span className="text-[#c9d1d9]">مسیر اسکن این کندل</span>
        <span className="font-mono" dir="ltr">
          {new Date(candleOpenTime).toISOString().slice(0, 16).replace('T', ' ')}Z
        </span>
      </div>

      {error && (
        <div className="mt-1.5 flex items-center gap-1 text-[#f85149]">
          <AlertTriangle className="w-3 h-3" />
          <span>{error}</span>
        </div>
      )}

      {!error && rows === null && <div className="mt-1.5 text-[#8b949e]">در حال خواندن…</div>}

      {!error && rows && rows.length === 0 && (
        <div className="mt-1.5 text-[#8b949e]">
          برای این کندل ردیفی در تاریخچه نیست (تاریخچه ۷ روز نگه داشته می‌شود).
        </div>
      )}

      {!error && rows && rows.length > 0 && summary && (
        <>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="px-1.5 py-0.5 rounded border bg-[#0d1117] border-[#21262d] text-[#c9d1d9]">
              {faNum(rows.length)} اسکن
            </span>
            <span className="px-1.5 py-0.5 rounded border bg-[#d29922]/15 border-[#d29922]/35 text-[#e3b341]">
              {faNum(summary.skipped)} رد
            </span>
            {summary.blocked > 0 && (
              <span className="px-1.5 py-0.5 rounded border bg-[#21262d] border-[#30363d] text-[#8b949e]">
                {faNum(summary.blocked)} متوقف/تکراری
              </span>
            )}
            <span className="px-1.5 py-0.5 rounded border bg-[#238636]/20 border-[#238636]/40 text-[#3fb950]">
              {faNum(summary.signals)} سیگنال
            </span>
            {summary.gates.length > 0 && (
              <span className="text-[#8b949e]">
                دروازه‌های دیده‌شده: <span className="text-[#e3b341]">{summary.gates.map((g) => gateLabel(g)).join(' ← ')}</span>
              </span>
            )}
          </div>

          <div className="mt-1.5 max-h-40 overflow-y-auto divide-y divide-[#161b22]">
            {grouped.slice(0, 40).map((g) => {
              const view = OUTCOME_VIEW[g.outcome] || OUTCOME_VIEW.skipped;
              const isSignal = g.outcome === 'signal';
              const timeText =
                g.count > 1 ? `${faTime(g.firstAt)} → ${faTime(g.lastAt)}` : faTime(g.firstAt);
              return (
                <div
                  key={g.key}
                  className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1 ${
                    isSignal
                      ? 'bg-[#238636]/15 border-r-2 border-[#3fb950] pr-1.5 rounded-sm'
                      : ''
                  }`}
                >
                  {isSignal && <Zap className="w-3 h-3 text-[#3fb950]" />}
                  <span className="font-mono text-[#8b949e]" dir="ltr">
                    {timeText}
                  </span>
                  {g.count > 1 && (
                    <span className="px-1.5 py-0.5 rounded border border-[#1a3040] bg-[#0d1117] text-[#58a6ff] font-mono text-[9px]">
                      ×{faNum(g.count)}
                    </span>
                  )}
                  <span
                    className={`px-1.5 py-0.5 rounded border text-[9px] ${
                      isSignal ? 'bg-[#238636]/25 text-[#3fb950] border-[#238636]/60 font-bold' : view.cls
                    }`}
                  >
                    {view.label}
                  </span>
                  {g.gate && (
                    <span className={isSignal ? 'text-[#3fb950]' : 'text-[#e3b341]'}>{gateLabel(g.gate)}</span>
                  )}
                  <span className={isSignal ? 'text-[#d8ffe9] truncate max-w-full' : 'text-[#8b949e] truncate max-w-full'} title={g.reason}>
                    {g.reason}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};
