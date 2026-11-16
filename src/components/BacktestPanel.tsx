import React, { useCallback, useEffect, useState } from 'react';
import { LineChart, RefreshCw, AlertTriangle, Activity, Grid3x3 } from 'lucide-react';
import { postJson, apiUrl } from '../utils/api';
import { formatPersianDateTime } from '../utils/dateTime';

interface BacktestMetrics {
  totalTrades: number;
  wins: number;
  losses: number;
  openTrades: number;
  winRate: number;
  avgR: number;
  maxDrawdown: number;
  profitFactor: number | null;
  equityCurve: number[];
}

interface BacktestSummary {
  ok: boolean;
  generatedAt: number;
  cached: boolean;
  bars: number;
  span: { from: string | null; to: string | null };
  params: {
    primary: string;
    minConfidence: number;
    atrFloor: number;
    slAtrMin: number;
    slAtrMax: number;
    minBodyAtr: number;
    maxSpreadAtrRatio: number;
    warmupBars: number;
    lookaheadBars: number;
  };
  metrics: BacktestMetrics;
  equityCurve: number[];
  trades: Array<{
    type: 'BUY' | 'SELL';
    entry: number;
    outcome: 'TP1' | 'TP2' | 'TP3' | 'SL' | 'OPEN';
    rMultiple: number;
    openTime: string;
  }>;
  error?: string;
}

interface SweepRow {
  minConfidence: number;
  atrFloor: number;
  totalTrades: number;
  wins: number;
  losses: number;
  openTrades: number;
  winRate: number;
  avgR: number;
  maxDrawdown: number;
  profitFactor: number | null;
}

interface SweepResponse {
  ok: boolean;
  generatedAt: number;
  bars: number;
  axes: { minConfidence: number[]; atrFloor: number[] };
  rows: SweepRow[];
  error?: string;
}

/** زیر این تعداد معاملهٔ بسته‌شده، میانگین R بیشتر شانس است تا مهارت. */
const MIN_TRUSTED_TRADES = 5;

const faNum = (n: number, digits = 0): string =>
  Number.isFinite(n) ? n.toLocaleString('fa-IR', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';

const formatDelayMs = (ms: number): string => {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'کمتر از یک دقیقه';
  if (minutes < 60) return `${faNum(minutes)} دقیقه`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${faNum(h)} ساعت و ${faNum(m)} دقیقه` : `${faNum(h)} ساعت`;
};

const faTime = (ms: number): string => {
  if (!ms) return '—';
  try {
    return new Intl.DateTimeFormat('fa-IR', {
      timeZone: 'Asia/Tehran',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(ms));
  } catch {
    return '—';
  }
};

/**
 * «۹۰، ۹۲٫۵, 95» → [90, 92.5, 95] — ارقام فارسی/عربی و جداکننده‌های مختلف را می‌پذیرد.
 * سقف هر محور ۵ مقدار است (همان سقف موتور)؛ بیش از آن بی‌صدا بریده می‌شود.
 */
const parseAxis = (text: string): number[] => {
  const latin = text
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/٫/g, '.');
  const values = latin.split(/[^0-9.]+/).map(Number).filter(Number.isFinite);
  return [...new Set(values)].sort((a, b) => a - b).slice(0, 5);
};

/**
 * پوشش دادهٔ بک‌تست: «از ۱۴۰۵/۰۸/۱۵ تا ۱۴۰۵/۰۸/۲۲ · ۷.۳ روز».
 * بدون این، عدد «۱۳۷۰ کندل» تنهایی نمی‌گوید نمونه چقدر عقب می‌رود.
 */
const spanLabel = (span: { from: string | null; to: string | null } | undefined): string | null => {
  if (!span?.from || !span?.to) return null;
  const days = (Date.parse(span.to) - Date.parse(span.from)) / 86_400_000;
  if (!Number.isFinite(days)) return null;
  // نمونهٔ کوتاه یک رقم اعشار می‌گیرد (تفاوت چند ساعته مهم است)؛ نمونهٔ بلند فقط روز کامل.
  const dayText = faNum(days, days < 10 ? 1 : 0);
  return `از ${formatPersianDateTime(span.from).jalaliDate} تا ${formatPersianDateTime(span.to).jalaliDate} · ${dayText} روز`;
};

/**
 * اسپارک‌لاین منحنی حقوق.
 * خط صفر (شروع) به‌صورت خط‌چین رسم می‌شود تا سود/ضرر نسبت به نقطهٔ شروع خوانده شود.
 */
const EquitySpark: React.FC<{ values: number[]; positive: boolean }> = ({ values, positive }) => {
  const W = 260;
  const H = 62;
  const pad = 4;

  if (values.length < 2) {
    return (
      <div className="h-[62px] flex items-center justify-center text-[10px] text-[#6e7681]">
        منحنی حقوق هنوز شکل نگرفته
      </div>
    );
  }

  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = max - min || 1;
  const x = (i: number) => pad + (i / (values.length - 1)) * (W - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / range) * (H - pad * 2);

  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(values.length - 1).toFixed(1)},${y(min).toFixed(1)} L${x(0).toFixed(1)},${y(min).toFixed(1)} Z`;
  const stroke = positive ? '#3fb950' : '#f85149';
  const fill = positive ? '#3fb950' : '#f85149';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[62px]" preserveAspectRatio="none" role="img" aria-label="منحنی حقوق">
      <line x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} stroke="#30363d" strokeWidth="1" strokeDasharray="3 3" />
      <path d={area} fill={fill} opacity="0.12" />
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r="2.4" fill={stroke} />
    </svg>
  );
};

const Metric: React.FC<{ label: string; value: string; hint?: string; tone?: 'good' | 'bad' | 'flat' }> = ({
  label,
  value,
  hint,
  tone = 'flat',
}) => {
  const color = tone === 'good' ? 'text-[#3fb950]' : tone === 'bad' ? 'text-[#f85149]' : 'text-[#c9d1d9]';
  return (
    <div className="rounded-lg border border-[#0f3a55]/60 bg-[#0b1a26]/70 px-2.5 py-2" title={hint}>
      <div className="text-[9px] text-[#8b949e] mb-0.5 whitespace-nowrap">{label}</div>
      <div className={`text-sm font-bold font-mono leading-tight ${color}`} dir="ltr">
        {value}
      </div>
    </div>
  );
};

export const BacktestPanel: React.FC = () => {
  const [data, setData] = useState<BacktestSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [sweep, setSweep] = useState<SweepResponse | null>(null);
  const [sweeping, setSweeping] = useState<boolean>(false);
  const [sweepProgress, setSweepProgress] = useState<{ done: number; total: number; remainingMs: number } | null>(null);
  // پیش‌فرض‌ها همان شبکهٔ پیش‌فرض موتور (DEFAULT_SWEEP_AXES): حول پارامترهای فعلی.
  // مقادیر در localStorage ذخیره می‌شوند تا با reload از دست نروند.
  const [confInput, setConfInput] = useState<string>(() => {
    try { return window.localStorage.getItem('backtest.sweep.conf') ?? '70, 74, 78'; } catch { return '70, 74, 78'; }
  });
  const [atrInput, setAtrInput] = useState<string>(() => {
    try { return window.localStorage.getItem('backtest.sweep.atr') ?? '1.4, 1.8, 2.2'; } catch { return '1.4, 1.8, 2.2'; }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem('backtest.sweep.conf', confInput);
      window.localStorage.setItem('backtest.sweep.atr', atrInput);
    } catch { /* ignore */ }
  }, [confInput, atrInput]);

  const load = useCallback(async (force: boolean) => {
    try {
      if (force) setRefreshing(true);
      const res = force
        ? await postJson<BacktestSummary>('/api/backtest/refresh')
        : await (await fetch(apiUrl('/api/backtest/summary'))).json();
      setData(res);
      setError(res?.ok === false ? res.error || 'بک‌تست نتیجه‌ای نداشت.' : null);
    } catch (err: any) {
      setError(err?.message || 'خطا در دریافت بک‌تست');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const runSweep = useCallback(async () => {
    const minConfidence = parseAxis(confInput);
    const atrFloor = parseAxis(atrInput);
    if (!minConfidence.length || !atrFloor.length) {
      setSweep({
        ok: false,
        generatedAt: Date.now(),
        bars: 0,
        axes: { minConfidence, atrFloor },
        rows: [],
        error: 'برای اسکن، مقدارهای اعتماد و ATR را با کاما جدا کن.',
      });
      return;
    }
    setSweeping(true);
    const totalCombos = minConfidence.length * atrFloor.length;
    setSweepProgress({ done: 0, total: totalCombos, remainingMs: 0 });
    try {
      const res = await fetch(apiUrl('/api/backtest/sweep?stream=1'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/x-ndjson' },
        body: JSON.stringify({ minConfidence, atrFloor }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        let parsed: any;
        try { parsed = JSON.parse(txt); } catch { /* ignore */ }
        if (parsed) { setSweep(parsed as SweepResponse); return; }
        throw new Error(txt || `HTTP ${res.status}`);
      }
      if (!res.body) throw new Error('پاسخ سرور خالی بود');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          let obj: any;
          try { obj = JSON.parse(line); } catch { continue; }
          if (obj.type === 'progress') {
            setSweepProgress({ done: obj.done, total: obj.total, remainingMs: obj.remainingMs });
          } else if (obj.type === 'result' || obj.type === 'error') {
            const { type: _t, ...rest } = obj;
            setSweep(rest as SweepResponse);
          }
        }
      }
      const tail = buffer.trim();
      if (tail) {
        try {
          const obj = JSON.parse(tail);
          if (obj.type === 'result' || obj.type === 'error') {
            const { type: _t, ...rest } = obj;
            setSweep(rest as SweepResponse);
          }
        } catch { /* ignore trailing */ }
      }
    } catch (err: any) {
      setSweep({
        ok: false,
        generatedAt: Date.now(),
        bars: 0,
        axes: { minConfidence: [], atrFloor: [] },
        rows: [],
        error: err?.message || 'خطا در اسکن پارامترها',
      });
    } finally {
      setSweeping(false);
      setSweepProgress(null);
    }
  }, [confInput, atrInput]);

  const m = data?.metrics;
  const tradeCount = m?.totalTrades ?? 0;
  const coverage = spanLabel(data?.span);
  const positive = (data?.equityCurve?.[data.equityCurve.length - 1] ?? 0) >= 0;

  return (
    <div className="mystic-frame rounded-xl border border-[#0f3a55]/60 bg-[#071522]/75 backdrop-blur-sm h-full flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 border-b border-[#0f3a55]/50">
        <div className="flex items-center gap-2 min-w-0">
          <LineChart className="w-4 h-4 text-[#58a6ff]" />
          <span className="text-xs font-bold text-white">بک‌تست پارامتر فعلی</span>
          <span className="text-[10px] text-[#8b949e]">
            {data?.params.primary ?? 'M5'} · {faNum(tradeCount)} معامله
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => void runSweep()}
            disabled={sweeping || loading}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold bg-[#21262d] text-[#c9d1d9] border border-[#30363d] hover:border-[#58a6ff]/50 transition disabled:opacity-50 cursor-pointer"
            title="اجرای بک‌تست روی بازه‌ای از آستانهٔ اعتماد و کف ATR و رتبه‌بندی نتیجه"
          >
            <Grid3x3 className={`w-3 h-3 ${sweeping ? 'animate-pulse' : ''}`} />
            <span>
              {sweeping
                ? sweepProgress
                  ? `اسکن ${faNum(sweepProgress.done)}/${faNum(sweepProgress.total)}…`
                  : 'در حال اسکن…'
                : 'اسکن پارامترها'}
            </span>
          </button>
          <button
            onClick={() => void load(true)}
            disabled={refreshing || loading}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold bg-[#21262d] text-[#c9d1d9] border border-[#30363d] hover:border-[#58a6ff]/50 transition disabled:opacity-50 cursor-pointer"
            title="محاسبهٔ دوباره روی دادهٔ تاریخی تازه"
          >
            <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
            <span>{refreshing ? 'در حال محاسبه…' : 'بازخوانی'}</span>
          </button>
        </div>
      </div>

      <div className="px-3.5 py-2.5 flex-1 min-h-0 overflow-y-auto flex flex-col gap-2.5">
        {loading ? (
          <div className="flex items-center gap-1.5 text-[11px] text-[#8b949e] py-4">
            <Activity className="w-3.5 h-3.5 animate-pulse" />
            در حال replay دادهٔ تاریخی…
          </div>
        ) : error ? (
          <div className="flex items-start gap-1.5 text-[10px] text-[#e3b341] bg-[#d29922]/10 border border-[#d29922]/30 rounded-lg px-2 py-1.5 leading-relaxed">
            <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              <Metric
                label="نرخ برد"
                value={`${faNum(m?.winRate ?? 0, 1)}%`}
                hint={`${faNum(m?.wins ?? 0)} برد / ${faNum(m?.losses ?? 0)} ضرر`}
                tone={(m?.winRate ?? 0) >= 50 ? 'good' : 'bad'}
              />
              <Metric
                label="میانگین R"
                value={`${(m?.avgR ?? 0) >= 0 ? '+' : ''}${faNum(m?.avgR ?? 0, 2)}`}
                hint="میانگین بازده هر معامله بر حسب R"
                tone={(m?.avgR ?? 0) > 0 ? 'good' : 'bad'}
              />
              <Metric
                label="حداکثر افت"
                value={`${faNum(m?.maxDrawdown ?? 0, 2)}R`}
                hint="بیشترین افت منحنی حقوق از سقف قبلی"
                tone={(m?.maxDrawdown ?? 0) === 0 ? 'flat' : 'bad'}
              />
              <Metric
                label="ضریب سود"
                value={m?.profitFactor == null ? '—' : faNum(m.profitFactor, 2)}
                hint="سود ناخالص تقسیم بر ضرر ناخالص؛ بدون ضرر ثبت‌شده تعریف‌نشده است"
                tone={(m?.profitFactor ?? 0) >= 1 ? 'good' : 'bad'}
              />
            </div>

            <EquitySpark values={data?.equityCurve ?? []} positive={positive} />

            {(data?.trades?.length ?? 0) > 0 && (
              <div className="border-t border-[#0f3a55]/40 pt-1.5">
                <div className="text-[10px] text-[#c9d1d9] mb-1">
                  معاملات ({faNum(data?.trades?.length ?? 0)})
                </div>
                <div className="max-h-[150px] overflow-y-auto overflow-x-auto">
                  <table className="w-full table-fixed text-[9px] text-[#c9d1d9]">
                    <colgroup>
                      <col className="w-[18%]" />
                      <col className="w-[42%]" />
                      <col className="w-[16%]" />
                      <col className="w-[24%]" />
                    </colgroup>
                    <thead className="text-[#8b949e] sticky top-0 bg-[#071522]">
                      <tr>
                        <th className="text-right font-normal py-0.5 px-1">جهت</th>
                        <th className="text-right font-normal px-1">ورود</th>
                        <th className="text-right font-normal px-1">نتیجه</th>
                        <th className="text-right font-normal px-1">R</th>
                      </tr>
                    </thead>
                    <tbody className="mono-nums">
                      {(data?.trades ?? []).map((t, i) => {
                        const win = t.outcome.startsWith('TP');
                        const loss = t.outcome === 'SL';
                        return (
                          <tr key={`${t.openTime}-${i}`} className={loss ? 'bg-[#da3633]/5' : ''}>
                            <td className={`py-0.5 px-1 whitespace-nowrap ${t.type === 'BUY' ? 'text-[#3fb950]' : 'text-[#f85149]'}`}>
                              {t.type === 'BUY' ? 'خرید' : 'فروش'}
                            </td>
                            <td className="px-1 whitespace-nowrap" dir="ltr">{faNum(t.entry, 2)}</td>
                            <td className={`px-1 whitespace-nowrap ${win ? 'text-[#3fb950]' : loss ? 'text-[#f85149]' : 'text-[#8b949e]'}`}>
                              {t.outcome === 'OPEN' ? 'باز' : t.outcome}
                            </td>
                            <td className={`px-1 whitespace-nowrap ${t.rMultiple > 0 ? 'text-[#3fb950]' : t.rMultiple < 0 ? 'text-[#f85149]' : 'text-[#8b949e]'}`} dir="ltr">
                              {t.rMultiple > 0 ? '+' : ''}
                              {faNum(t.rMultiple, 2)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="border-t border-[#0f3a55]/40 pt-1.5 text-[9px] text-[#8b949e] leading-relaxed">
              {coverage && (
                <div className="text-[10px] text-[#c9d1d9] mb-1" title="بازهٔ تاریخی که بک‌تست روی آن اجرا شده">
                  🗓 {coverage} · {faNum(data?.bars ?? 0)} کندل
                </div>
              )}
              <span className="font-mono" dir="ltr">
                SL {faNum(data?.params.slAtrMin ?? 0, 1)}–{faNum(data?.params.slAtrMax ?? 0, 1)}×ATR · body≥
                {faNum(data?.params.minBodyAtr ?? 0, 2)}×ATR · conf≥{faNum(data?.params.minConfidence ?? 0)}
              </span>
              <div className="mt-0.5">
                محاسبه {faTime(data?.generatedAt ?? 0)}
                {data?.cached ? ' · از کش' : ''}
                {(m?.openTrades ?? 0) > 0 ? ` · ${faNum(m!.openTrades)} باز` : ''}
              </div>
            </div>

            <div className="border-t border-[#0f3a55]/40 pt-1.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] text-[#8b949e]">
                <label className="flex items-center gap-1">
                  اعتماد
                  <input
                    dir="ltr"
                    value={confInput}
                    onChange={(e) => setConfInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !sweeping) void runSweep();
                    }}
                    disabled={sweeping}
                    spellCheck={false}
                    aria-label="آستانه‌های اعتماد برای اسکن، جداشده با کاما"
                    className="w-[76px] rounded border border-[#0f3a55]/60 bg-[#0d1117]/70 px-1 py-0.5 font-mono text-[10px] text-[#c9d1d9] outline-none focus:border-[#58a6ff]/60 disabled:opacity-50"
                  />
                </label>
                <label className="flex items-center gap-1">
                  ATR
                  <input
                    dir="ltr"
                    value={atrInput}
                    onChange={(e) => setAtrInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !sweeping) void runSweep();
                    }}
                    disabled={sweeping}
                    spellCheck={false}
                    aria-label="کف‌های ATR برای اسکن، جداشده با کاما"
                    className="w-[76px] rounded border border-[#0f3a55]/60 bg-[#0d1117]/70 px-1 py-0.5 font-mono text-[10px] text-[#c9d1d9] outline-none focus:border-[#58a6ff]/60 disabled:opacity-50"
                  />
                </label>
                <span className="text-[8px] opacity-80">با کاما · اعتماد ۵۰–۹۵ · ATR ۰٫۵–۵ · هر محور تا ۵ مقدار</span>
              </div>
              {sweeping && sweepProgress && (
                <div className="mt-1 flex items-center gap-2 text-[9px] text-[#8b949e]">
                  <div className="flex-1 h-1 rounded bg-[#0f3a55]/40 overflow-hidden">
                    <div
                      className="h-full bg-[#58a6ff] transition-all duration-300"
                      style={{ width: `${sweepProgress.total ? (sweepProgress.done / sweepProgress.total) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="whitespace-nowrap">
                    {faNum(sweepProgress.done)}/{faNum(sweepProgress.total)} ترکیب
                    {sweepProgress.remainingMs > 0 ? ` · ~${formatDelayMs(sweepProgress.remainingMs)} مانده` : ''}
                  </span>
                </div>
              )}
            </div>

            {sweep && (
              <div className="border-t border-[#0f3a55]/40 pt-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 mb-1">
                  <span className="text-[10px] text-[#c9d1d9] whitespace-nowrap">🌐 اسکن پارامترها</span>
                  {sweep.ok && (
                    <span className="text-[9px] text-[#8b949e]" title="بازه‌ای که آزمون شد">
                      اعتماد {faNum(sweep.axes.minConfidence[0] ?? 0)}–
                      {faNum(sweep.axes.minConfidence[sweep.axes.minConfidence.length - 1] ?? 0)} · ATR{' '}
                      {faNum(sweep.axes.atrFloor[0] ?? 0, 1)}–
                      {faNum(sweep.axes.atrFloor[sweep.axes.atrFloor.length - 1] ?? 0, 1)} ·{' '}
                      {faNum(sweep.rows.length)} ترکیب
                    </span>
                  )}
                </div>
                {sweep.rows.length === 0 ? (
                  <div className="text-[10px] text-[#e3b341] leading-relaxed">{sweep.error ?? 'نتیجه‌ای نبود.'}</div>
                ) : (
                  <div className="max-h-[170px] overflow-y-auto overflow-x-auto">
                    <table className="w-full text-[9px] text-[#c9d1d9]">
                      <thead className="text-[#8b949e] sticky top-0 bg-[#071522]">
                        <tr>
                          <th className="text-right font-normal py-0.5">#</th>
                          <th className="text-right font-normal">اعتماد</th>
                          <th className="text-right font-normal">ATR</th>
                          <th className="text-right font-normal">معامله</th>
                          <th className="text-right font-normal">برد٪</th>
                          <th className="text-right font-normal">avgR</th>
                          <th className="text-right font-normal">افت</th>
                          <th className="text-right font-normal">PF</th>
                        </tr>
                      </thead>
                      <tbody className="mono-nums">
                        {sweep.rows.map((r, i) => {
                          const isCurrent =
                            r.minConfidence === (data?.params.minConfidence ?? NaN) &&
                            r.atrFloor === (data?.params.atrFloor ?? NaN);
                          const thin = r.wins + r.losses < MIN_TRUSTED_TRADES;
                          return (
                            <tr
                              key={`${r.minConfidence}-${r.atrFloor}`}
                              className={i === 0 ? 'bg-[#3fb950]/10' : isCurrent ? 'bg-[#58a6ff]/10' : ''}
                              title={
                                (isCurrent ? 'پارامترهای فعلی · ' : '') +
                                (thin ? 'نمونه کم است؛ این رتبه قابل اتکا نیست' : '')
                              }
                            >
                              <td className="py-0.5 whitespace-nowrap">
                                {faNum(i + 1)}
                                {i === 0 ? ' ★' : ''}
                              </td>
                              <td>{faNum(r.minConfidence)}</td>
                              <td>{faNum(r.atrFloor, 1)}</td>
                              <td className="whitespace-nowrap">
                                {faNum(r.totalTrades)}
                                {thin ? ' ⚠' : ''}
                              </td>
                              <td>{faNum(r.winRate)}</td>
                              <td className={r.avgR > 0 ? 'text-[#3fb950]' : 'text-[#f85149]'}>
                                {r.avgR > 0 ? '+' : ''}
                                {faNum(r.avgR, 2)}
                              </td>
                              <td>{faNum(r.maxDrawdown, 1)}</td>
                              <td>{r.profitFactor == null ? '—' : faNum(r.profitFactor, 1)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="mt-1 text-[9px] text-[#8b949e] leading-relaxed">
                  رتبه: میانگین R، سپس نمونهٔ بزرگ‌تر، سپس افت کمتر · ⚠ کمتر از {faNum(MIN_TRUSTED_TRADES)} معاملهٔ
                  بسته‌شده
                </div>
                {sweep.rows.length > 1 &&
                  new Set(sweep.rows.map((r) => `${r.totalTrades}|${r.avgR}`)).size === 1 && (
                    <div className="mt-0.5 text-[9px] text-[#e3b341] leading-relaxed">
                      در این نمونه هر ترکیبی نتیجهٔ یکسان داد؛ آستانه‌ها هنوز معامله‌ای را عوض نمی‌کنند.
                    </div>
                  )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
