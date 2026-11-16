import { Router } from 'express';
import { rateLimit } from '../lib/rateLimit';
import * as candles from '../engine/candles';
import * as repo from '../db/repo';
import { config, type SymbolCode } from '../config';
import { log } from '../lib/logger';
import {
  runBacktest,
  computeBacktestMetrics,
  runSweep,
  rankSweep,
  sanitizeSweepAxes,
  suggestSweepAxes,
  DEFAULT_BACKTEST_CONFIG,
  DEFAULT_SWEEP_AXES,
  MAX_SWEEP_POINTS,
  type BacktestHtfContext,
  type BacktestMetrics,
  type BacktestTrade,
  type SweepAxes,
  type SweepPoint,
} from '../backtest/engine';
import type { Bar } from '../lib/indicators';
import {
  PRIMARY_TIMEFRAME,
  SL_ATR_MIN,
  SL_ATR_MAX,
  MIN_BODY_ATR,
} from '../engine/signals';

export const backtestRouter = Router();

const limiter = rateLimit({ windowMs: 60_000, max: 6, keyPrefix: 'backtest' });

/** سقف کندل M5 تازه از منبع (TwelveData حداکثر ۵۰۰۰ کندل در هر درخواست می‌دهد). */
const BACKTEST_BARS = 5000;
/**
 * سقف کندل M5 خوانده‌شده از DB — تاریخچهٔ پرشده با scripts/backfill-candles.ts
 * (~۸ هزار کندل) به‌علاوهٔ کندل‌هایی که اسکن زنده ذخیره می‌کند.
 */
const DB_BARS = 25000;
/** نتیجه گران است؛ تا این مدت بدون محاسبهٔ دوباره سرو می‌شود. */
const CACHE_TTL_MS = 10 * 60_000;
/** حداکثر نقطهٔ منحنی حقوق برای اسپارک‌لاین جمع‌وجور. */
const MAX_CURVE_POINTS = 60;

export interface BacktestSummary {
  ok: boolean;
  generatedAt: number;
  /** true اگر نتیجه از کش آمده باشد (بدون محاسبهٔ دوباره). */
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
  /** منحنی حقوق فشرده‌شده به حداکثر MAX_CURVE_POINTS نقطه. */
  equityCurve: number[];
  /** معاملات تکی بک‌تست (جهت، ورود، نتیجه، R) — برای بررسی دورهٔ بازنده. */
  trades: BacktestTrade[];
  error?: string;
}

/** یک سطر اسکن؛ منحنی حقوق نمی‌آید تا پاسخ جدول جمع‌وجور بماند. */
export interface SweepRow {
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

export interface SweepResponse {
  ok: boolean;
  generatedAt: number;
  bars: number;
  /** بازه‌ای که واقعاً آزمون شد. */
  axes: SweepAxes;
  /** ترکیب‌های اجراشده، از بهترین به بدترین. */
  rows: SweepRow[];
  error?: string;
}

let cache: { at: number; payload: BacktestSummary } | null = null;
let inFlight: Promise<BacktestSummary> | null = null;

/** منحنی بلند را به تعداد نقطهٔ محدود کاهش می‌دهد و اول/آخر را حفظ می‌کند. */
function thinCurve(curve: number[], maxPoints: number): number[] {
  if (curve.length <= maxPoints) return curve;
  const step = (curve.length - 1) / (maxPoints - 1);
  const out: number[] = [];
  for (let i = 0; i < maxPoints; i++) out.push(curve[Math.round(i * step)]);
  return out;
}

function paramsOf() {
  return {
    primary: PRIMARY_TIMEFRAME.label,
    minConfidence: DEFAULT_BACKTEST_CONFIG.minConfidence,
    atrFloor: DEFAULT_BACKTEST_CONFIG.atrFloor,
    slAtrMin: SL_ATR_MIN,
    slAtrMax: SL_ATR_MAX,
    minBodyAtr: MIN_BODY_ATR,
    maxSpreadAtrRatio: config.engine.maxSpreadAtrRatio,
    warmupBars: DEFAULT_BACKTEST_CONFIG.warmupBars,
    lookaheadBars: DEFAULT_BACKTEST_CONFIG.maxLookahead,
  };
}

const SYMBOL: SymbolCode = 'XAUUSD';

async function safeBars(interval: string, limit: number) {
  try {
    return await candles.fetchConfirmedBars(SYMBOL, interval, limit);
  } catch (err: any) {
    log('warn', 'Backtest', `واکشی ${interval} ناموفق بود: ${err?.message || err}`);
    return [];
  }
}

/**
 * تاریخچهٔ M5 از منبع + کندل‌های ذخیره‌شده در DB (یکتا بر اساس زمان باز شدن).
 * DB با گذشت زمان بلندتر می‌شود، پس پنجرهٔ بک‌تست خودش رشد می‌کند.
 */
async function mergedM5(): Promise<Bar[]> {
  const [fresh, stored] = await Promise.all([
    safeBars(PRIMARY_TIMEFRAME.interval, BACKTEST_BARS),
    repo
      .getCandles(SYMBOL, PRIMARY_TIMEFRAME.interval, DB_BARS)
      .then((rows) => rows.filter((r) => !r.isOpen))
      .catch(() => []),
  ]);

  const seen = new Set<string>();
  const out: Bar[] = [];
  for (const b of [...stored, ...fresh]) {
    const key = new Date(b.openTime).toISOString();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...b, openTime: key });
  }
  return out.sort((a, b) => new Date(a.openTime).getTime() - new Date(b.openTime).getTime());
}

/** کندل‌های M5 + HTF؛ خلاصه و اسکن هر دو روی همین ورودی اجرا می‌شوند. */
async function loadInputs(): Promise<{ bars: Bar[]; htf: BacktestHtfContext }> {
  const [bars, m15, h1, h4] = await Promise.all([
    mergedM5(),
    safeBars('15m', 300),
    safeBars('1h', 200),
    safeBars('4h', 60),
  ]);
  return { bars, htf: { m15, h1, h4 } };
}

function sweepRow({ minConfidence, atrFloor, metrics }: SweepPoint): SweepRow {
  const { totalTrades, wins, losses, openTrades, winRate, avgR, maxDrawdown, profitFactor } = metrics;
  return { minConfidence, atrFloor, totalTrades, wins, losses, openTrades, winRate, avgR, maxDrawdown, profitFactor };
}

async function compute(): Promise<BacktestSummary> {
  const params = paramsOf();
  const base: Omit<BacktestSummary, 'metrics' | 'equityCurve' | 'trades'> = {
    ok: false,
    generatedAt: Date.now(),
    cached: false,
    bars: 0,
    span: { from: null, to: null },
    params,
  };

  const { bars, htf } = await loadInputs();

  if (bars.length < DEFAULT_BACKTEST_CONFIG.warmupBars + 30) {
    return {
      ...base,
      // همان متریک‌های «بدون معامله» که موتور می‌دهد — از جمله profitFactor = null؛
      // یک نسخهٔ دستی اینجا نگه نمی‌داریم تا دوباره از موتور جدا نیفتد.
      metrics: computeBacktestMetrics([]),
      equityCurve: [0],
      trades: [],
      error: `دادهٔ کافی نیست (${bars.length} کندل M5) — بک‌تست حداقل ${DEFAULT_BACKTEST_CONFIG.warmupBars + 30} کندل M5 می‌خواهد.`,
    };
  }

  const result = runBacktest(bars, {}, htf);
  return {
    ...base,
    ok: true,
    bars: bars.length,
    span: { from: bars[0]?.openTime ?? null, to: bars[bars.length - 1]?.openTime ?? null },
    metrics: result.metrics,
    equityCurve: thinCurve(result.metrics.equityCurve, MAX_CURVE_POINTS),
    trades: result.trades,
  };
}

/** محاسبه با کش؛ درخواست‌های هم‌زمان یک محاسبه را شریک می‌شوند. */
async function getSummary(force: boolean): Promise<BacktestSummary> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return { ...cache.payload, cached: true };
  }
  if (inFlight) return inFlight;
  inFlight = compute()
    .then((payload) => {
      cache = { at: Date.now(), payload };
      return payload;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** متریک‌های بک‌تست برای مجموعه‌پارامتر فعلی (کش‌شده). */
backtestRouter.get('/backtest/summary', async (_req, res) => {
  try {
    res.json(await getSummary(false));
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'خطا در اجرای بک‌تست' });
  }
});

/** محاسبهٔ دوباره با نادیده‌گرفتن کش (برای دکمهٔ «بازخوانی»). */
backtestRouter.post('/backtest/refresh', limiter, async (_req, res) => {
  try {
    cache = null;
    res.json(await getSummary(true));
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'خطا در اجرای بک‌تست' });
  }
});

/**
 * اجرای بک‌تست روی شبکه‌ای از پارامترها و برگرداندن نتیجهٔ رتبه‌بندی‌شده.
 * بدنه اختیاری است: { minConfidence?: number[], atrFloor?: number[] }.
 */
backtestRouter.post('/backtest/sweep', limiter, async (req, res) => {
  // streaming (NDJSON) وقتی کلاینت بخواهد پیشرفت را ببیند: ?stream=1 یا Accept مناسب.
  const wantStream =
    req.query.stream === '1' ||
    String(req.headers.accept || '').includes('application/x-ndjson') ||
    String(req.headers.accept || '').includes('text/event-stream');

  try {
    const { bars, htf } = await loadInputs();
    if (bars.length < DEFAULT_BACKTEST_CONFIG.warmupBars + 30) {
      const need = DEFAULT_BACKTEST_CONFIG.warmupBars + 30;
      const payload = {
        ok: false,
        generatedAt: Date.now(),
        bars: bars.length,
        axes: DEFAULT_SWEEP_AXES,
        rows: [],
        error: `دادهٔ کافی نیست (${bars.length} کندل M5) — اسکن حداقل ${need} کندل می‌خواهد.`,
      };
      if (wantStream) {
        res.setHeader('Content-Type', 'application/x-ndjson');
        res.write(JSON.stringify({ type: 'result', ...payload }) + '\n');
        res.end();
      } else {
        res.json(payload);
      }
      return;
    }

    const requested = sanitizeSweepAxes(req.body);
    const axes = req.body && (req.body.minConfidence || req.body.atrFloor)
      ? requested
      : suggestSweepAxes(runBacktest(bars, { minConfidence: 0, atrFloor: 0 }, htf).trades);

    if (axes.minConfidence.length * axes.atrFloor.length > MAX_SWEEP_POINTS) {
      const payload = { ok: false, bars: 0, axes, rows: [], error: 'تعداد ترکیب‌ها بیش از حد مجاز است.' };
      if (wantStream) {
        res.setHeader('Content-Type', 'application/x-ndjson');
        res.write(JSON.stringify({ type: 'result', ...payload }) + '\n');
        res.end();
      } else {
        res.status(400).json(payload);
      }
      return;
    }

    const total = axes.minConfidence.length * axes.atrFloor.length;

    if (!wantStream) {
      const rows = rankSweep(runSweep(bars, axes, {}, htf)).map(sweepRow);
      res.json({ ok: true, generatedAt: Date.now(), bars: bars.length, axes, rows });
      return;
    }

    // حالت استریم: ترکیب‌ها یکی‌یکی اجرا می‌شوند و پیشرفت ارسال می‌شود.
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.flushHeaders?.();
    const write = (obj: any) => res.write(JSON.stringify(obj) + '\n');

    const started = Date.now();
    const points: import('../backtest/engine').SweepPoint[] = [];
    let done = 0;
    try {
      for (const minConfidence of axes.minConfidence) {
        for (const atrFloor of axes.atrFloor) {
          const { metrics } = runBacktest(bars, { minConfidence, atrFloor }, htf);
          // فقط فیلدهای لازم بک‌تست را نگه می‌داریم (همان config پیش‌فرض بک‌تست).
          points.push({ minConfidence, atrFloor, metrics });
          done++;
          const elapsed = Date.now() - started;
          const avg = done > 0 ? elapsed / done : 0;
          const remaining = Math.max(0, Math.round(avg * (total - done)));
          write({ type: 'progress', done, total, elapsedMs: elapsed, remainingMs: remaining });
        }
      }
      const rows = rankSweep(points).map(sweepRow);
      write({ type: 'result', ok: true, generatedAt: Date.now(), bars: bars.length, axes, rows });
    } catch (err: any) {
      write({ type: 'error', ok: false, bars: bars.length, axes, rows: [], error: err?.message || 'خطا در اسکن پارامترها' });
    } finally {
      res.end();
    }
  } catch (err: any) {
    const payload = { ok: false, bars: 0, axes: DEFAULT_SWEEP_AXES, rows: [], error: err?.message || 'خطا در اسکن پارامترها' };
    if (wantStream && res.headersSent) {
      try { res.write(JSON.stringify({ type: 'error', ...payload }) + '\n'); } catch { /* ignore */ }
      res.end();
    } else if (wantStream) {
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.write(JSON.stringify({ type: 'error', ...payload }) + '\n');
      res.end();
    } else {
      res.status(500).json(payload);
    }
  }
});
