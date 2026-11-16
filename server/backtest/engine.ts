import type { Bar } from '../lib/indicators';
import { intervalMs } from '../lib/indicators';
import { evaluateTimeframe, evaluateEntry, PRIMARY_TIMEFRAME } from '../engine/signals';
import { SYMBOL_DIGITS } from '../config';

// ------------------------------------------------------------------ types

export interface BacktestTrade {
  type: 'BUY' | 'SELL';
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  openTime: string;
  outcome: TradeOutcome['outcome'];
  rMultiple: number;
  barsToOutcome: number;
  confidence: number;
  /** ATR پایه‌ای که سطوح روی آن ساخته شد (پس از اعمال کف). */
  atr: number;
}

export interface TradeOutcome {
  outcome: 'TP1' | 'TP2' | 'TP3' | 'SL' | 'OPEN';
  barsToOutcome: number;
  rMultiple: number;
}

export interface BacktestMetrics {
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

export interface BacktestResult {
  trades: BacktestTrade[];
  metrics: BacktestMetrics;
}

/**
 * کندل‌های M15/H1/H4 که مستقیم از منبع می‌آیند — مثل اسکن زنده.
 * اگر برای یک تایم‌فریم داده نرسد، همان M5 بازنمونه‌گیری می‌شود (مسیر تخریب‌شده).
 * هر کندل فقط وقتی دیده می‌شود که در زمان `evalNow` بسته شده باشد (بدون نگاه به آینده).
 */
export interface BacktestHtfContext {
  m15?: Bar[];
  h1?: Bar[];
  h4?: Bar[];
}

export interface BacktestConfig {
  /** تایم‌فریمی که تصمیم روی آن گرفته می‌شود — همان M5 اسکن زنده. */
  primaryInterval: string;
  /** Minimum bars needed before first evaluation. */
  warmupBars: number;
  /** Minimum confidence to take a trade (default 74). */
  minConfidence: number;
  /** Max bars to look forward for trade outcome (default: 200). */
  maxLookahead: number;
  /** ATR floor per symbol. */
  atrFloor: number;
}

export const DEFAULT_BACKTEST_CONFIG: BacktestConfig = {
  primaryInterval: PRIMARY_TIMEFRAME.interval,
  warmupBars: 60,
  minConfidence: 74,
  maxLookahead: 200,
  atrFloor: 1.8,
};

/**
 * سقف کندل HTF که در هر تصمیم بررسی می‌شود. اندیکاتورهای HTF هم (EMA21/9) با
 * چند صد کندل به مقدار نهایی می‌رسند و اسکن زنده هم همین حجم را می‌گیرد.
 */
const HTF_TAIL = 300;

/**
 * تعداد کندل M5 که برای محاسبهٔ اندیکاتورهای هر تصمیم دیده می‌شود.
 * EMA/RSI/ATR با همین دنباله حساب می‌شوند: پس از ~۳۰۰ کندل سهم مقدار اولیه
 * (SMA) به ~۱e-۱۲ می‌رسد، یعنی با تاریخچهٔ کامل یکی است؛ اسکن زنده هم بیش از
 * ۲۴۰ کندل نمی‌بیند. این‌طور هزینهٔ replay خطی می‌ماند، نه درجه‌دوم.
 */
const EVAL_WINDOW = 300;

const round = (n: number, digits = 2): number => Number(n.toFixed(digits));

// ------------------------------------------------------------------ pure: trade outcome simulation

/**
 * Simulate a trade's outcome by walking forward through future bars.
 *
 * هر سطح با یک قاعدهٔ واحد سنجیده می‌شود: در BUY سقف کندل و در SELL کف کندل
 * «بهترین قیمت» است؛ کف/سقف مخالف هم استاپ را می‌سنجد.
 * اگر در یک کندل هم استاپ و هم هدف لمس شود، استاپ برنده است (محافظه‌کارانه).
 */
export function simulateTradeOutcome(
  type: 'BUY' | 'SELL',
  levels: { sl: number; tp1: number; tp2: number; tp3: number },
  futureBars: Bar[]
): TradeOutcome {
  const buy = type === 'BUY';

  for (let i = 0; i < futureBars.length; i++) {
    const bar = futureBars[i];
    const stopHit = buy ? bar.low <= levels.sl : bar.high >= levels.sl;
    if (stopHit) return { outcome: 'SL', barsToOutcome: i + 1, rMultiple: -1 };

    const best = buy ? bar.high : bar.low;
    const reached = (level: number) => (buy ? best >= level : best <= level);
    // از دورترین هدف به نزدیک‌ترین: رسیدن به TP3 یعنی TP1 و TP2 هم لمس شده‌اند.
    if (reached(levels.tp3)) return { outcome: 'TP3', barsToOutcome: i + 1, rMultiple: 3 };
    if (reached(levels.tp2)) return { outcome: 'TP2', barsToOutcome: i + 1, rMultiple: 2 };
    if (reached(levels.tp1)) return { outcome: 'TP1', barsToOutcome: i + 1, rMultiple: 1 };
  }

  return { outcome: 'OPEN', barsToOutcome: futureBars.length, rMultiple: 0 };
}

// ------------------------------------------------------------------ pure: metrics computation

/** متریک‌های R-based؛ معاملات باز در نرخ برد و منحنی حقوق شمرده نمی‌شوند. */
export function computeBacktestMetrics(trades: BacktestTrade[]): BacktestMetrics {
  const equityCurve: number[] = [0];
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let wins = 0;
  let losses = 0;
  let openTrades = 0;
  let sumR = 0;
  let grossProfit = 0;
  let grossLoss = 0;

  for (const trade of trades) {
    if (trade.outcome === 'OPEN') {
      openTrades++;
      continue;
    }
    if (trade.outcome === 'SL') {
      losses++;
      grossLoss += Math.abs(trade.rMultiple);
    } else {
      wins++;
      grossProfit += trade.rMultiple;
    }
    sumR += trade.rMultiple;
    equity += trade.rMultiple;
    equityCurve.push(equity);
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  const closedTrades = wins + losses;
  return {
    totalTrades: trades.length,
    wins,
    losses,
    openTrades,
    winRate: closedTrades ? round((wins / closedTrades) * 100) : 0,
    avgR: closedTrades ? round(sumR / closedTrades, 3) : 0,
    maxDrawdown: round(maxDrawdown, 3),
    // بدون ضرر، نسبت سود/ضرر تعریف‌نشده است — نه یک عدد ساختگی.
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : null,
    equityCurve,
  };
}

// ------------------------------------------------------------------ resampling helper

/** Resample bars to a higher timeframe by grouping on the interval's epoch bucket. */
export function resampleBars(bars: Bar[], targetInterval: string): Bar[] {
  const ms = intervalMs(targetInterval);
  if (ms <= 0 || bars.length === 0) return [];

  // پیش از گروه‌بندی مرتب می‌کنیم: open/close هر سطل به ترتیب زمانی کندل‌های داخلش وابسته است.
  const groups = new Map<number, Bar[]>();
  for (const bar of [...bars].sort((a, b) => Date.parse(a.openTime) - Date.parse(b.openTime))) {
    const bucket = Math.floor(Date.parse(bar.openTime) / ms) * ms;
    const group = groups.get(bucket) ?? [];
    group.push(bar);
    groups.set(bucket, group);
  }

  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bucket, group]) => ({
      openTime: new Date(bucket).toISOString(),
      open: group[0].open,
      close: group[group.length - 1].close,
      high: Math.max(...group.map((b) => b.high)),
      low: Math.min(...group.map((b) => b.low)),
      volume: group.reduce((sum, b) => sum + (b.volume ?? 0), 0),
    }));
}

// ------------------------------------------------------------------ main backtest replay

/**
 * Replay the scan logic on historical bars and record every trade it would have taken.
 *
 * `m5Bars` باید فقط کندل‌های بسته باشد (همان قرارداد اسکن زنده)؛
 * تصمیم هر نقطه روی کندل i گرفته می‌شود و نتیجه‌اش با کندل‌های بعدی سنجیده می‌شود.
 */
export function runBacktest(
  m5Bars: Bar[],
  config: Partial<BacktestConfig> = {},
  htf: BacktestHtfContext = {}
): BacktestResult {
  const cfg = { ...DEFAULT_BACKTEST_CONFIG, ...config };
  const byTime = (a: Bar, b: Bar) => Date.parse(a.openTime) - Date.parse(b.openTime);
  const bars = [...m5Bars].sort(byTime);

  /**
   * HTF: منبع (مثل اسکن زنده) یا باز‌نمونه‌گیری از همان M5.
   * منبع معمولاً فقط چند روز آخر را می‌دهد؛ اگر پنجرهٔ replay از آن بلندتر باشد،
   * تنها راه پوشش کل بازه با HTF باز‌نمونه‌گیری‌شده است (کندلِ نیمه‌کاره هم با
   * فیلتر زمانِ بسته‌شدن در evaluateEntry حذف می‌شود، پس نگاه به آینده رخ نمی‌دهد).
   */
  const pickHtf = (source: Bar[] | undefined, fallback: string): Bar[] => {
    const resampled = resampleBars(bars, fallback);
    const src = source?.length ? [...source].sort(byTime) : [];
    if (!src.length) return resampled;
    if (!resampled.length) return src;
    return Date.parse(src[0].openTime) <= Date.parse(resampled[0].openTime) ? src : resampled;
  };
  const m15Bars = pickHtf(htf.m15, '15m');
  const h1Bars = pickHtf(htf.h1, '1h');
  const h4Bars = pickHtf(htf.h4, '4h');

  /** تعداد کندل‌هایی که در لحظهٔ `now` بسته شده‌اند (arrays زمانی مرتب‌اند). */
  const closedCount = (arr: Bar[], ms: number, now: number): number => {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (Date.parse(arr[mid].openTime) + ms <= now) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  /** فقط دنبالهٔ اخیر HTF؛ ارسال کل تاریخچه در هر کندل، replay را درجه‌دوم می‌کرد. */
  const htfTail = (arr: Bar[], ms: number, now: number): Bar[] => {
    const end = closedCount(arr, ms, now);
    return arr.slice(Math.max(0, end - HTF_TAIL), end);
  };

  const m15Ms = intervalMs('15m');
  const h1Ms = intervalMs('1h');
  const h4Ms = intervalMs('4h');

  const trades: BacktestTrade[] = [];

  // کندل‌های گذشته یک‌بار ساخته می‌شوند، نه با slice در هر گام (که replay را درجه‌دوم می‌کرد).
  const seen: Bar[] = bars.slice(0, cfg.warmupBars);

  for (let i = cfg.warmupBars; i < bars.length; i++) {
    seen.push(bars[i]);
    const evalNow = Date.parse(bars[i].openTime) + intervalMs(cfg.primaryInterval);

    // EMA/RSI/ATR فقط به دنبالهٔ اخیر حساس‌اند: پس از چند صد کندل اثر مقدار اولیه
    // در دقت اعشار محو می‌شود و اسکن زنده هم بیش از ۲۴۰ کندل نمی‌بیند.
    const decision = evaluateTimeframe(
      seen.length > EVAL_WINDOW ? seen.slice(-EVAL_WINDOW) : seen,
      evalNow,
      cfg.primaryInterval
    );
    // همان زنجیرهٔ واحد ورود که اسکن زنده اجرا می‌کند — `cross === null` هم همان‌جا رد می‌شود.
    const plan = evaluateEntry({
      decision,
      primaryBars: seen,
      htf: {
        m15: htfTail(m15Bars, m15Ms, evalNow),
        h1: htfTail(h1Bars, h1Ms, evalNow),
        h4: htfTail(h4Bars, h4Ms, evalNow),
      },
      now: evalNow,
      digits: SYMBOL_DIGITS.XAUUSD,
      atrFloor: cfg.atrFloor,
      minConfidence: cfg.minConfidence,
    });
    if (!plan.ok || !decision.candle) continue;
    const candle = decision.candle;

    const outcome = simulateTradeOutcome(plan.type, plan.levels, bars.slice(i + 1, i + 1 + cfg.maxLookahead));
    trades.push({
      type: plan.type,
      entry: plan.entry,
      sl: plan.levels.sl,
      tp1: plan.levels.tp1,
      tp2: plan.levels.tp2,
      tp3: plan.levels.tp3,
      openTime: candle.openTime,
      confidence: plan.confidence,
      atr: plan.atr,
      ...outcome,
    });
  }

  return { trades, metrics: computeBacktestMetrics(trades) };
}

// ------------------------------------------------------------------ parameter sweep

export interface SweepAxes {
  /** آستانه‌های اعتماد که هرکدام یک بار replay می‌شوند. */
  minConfidence: number[];
  /** کف‌های ATR که با هر آستانهٔ اعتماد ترکیب می‌شوند. */
  atrFloor: number[];
}

export interface SweepPoint {
  minConfidence: number;
  atrFloor: number;
  metrics: BacktestMetrics;
}

/** شبکهٔ پیش‌فرض وقتی معامله‌ای برای اندازه‌گیری نباشد: حول پارامترهای فعلی. */
export const DEFAULT_SWEEP_AXES: SweepAxes = {
  minConfidence: [70, 74, 78],
  atrFloor: [1.4, 1.8, 2.2],
};

/** هر نقطه یک replay کامل است؛ این سقف درخواست گران را محدود می‌کند. */
export const MAX_SWEEP_POINTS = 25;

/** سقف مقادیر هر محور و بازهٔ مجاز آن‌ها (بیرون از این بازه پارامتر بی‌معناست). */
const MAX_AXIS_VALUES = 5;
const AXIS_RANGE = {
  minConfidence: { lo: 50, hi: 95 },
  atrFloor: { lo: 0.5, hi: 5 },
} as const;

/**
 * ورودی نامطمئن را به شبکهٔ امن تبدیل می‌کند: اعداد متناهی، بدون تکرار، مرتب،
 * در بازهٔ مجاز و محدود به سقف. محوری که مقدار معتبری ندارد به پیش‌فرض برمی‌گردد.
 */
export function sanitizeSweepAxes(input: unknown): SweepAxes {
  const body = (input ?? {}) as Record<string, unknown>;
  const axis = (name: keyof SweepAxes): number[] => {
    const raw = body[name];
    if (!Array.isArray(raw)) return DEFAULT_SWEEP_AXES[name];
    const { lo, hi } = AXIS_RANGE[name];
    const values = [...new Set(raw)]
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi)
      .sort((a, b) => a - b);
    return values.length ? values.slice(0, MAX_AXIS_VALUES) : DEFAULT_SWEEP_AXES[name];
  };
  return { minConfidence: axis('minConfidence'), atrFloor: axis('atrFloor') };
}

/** یک بک‌تست کامل برای هر ترکیب محورها. */
export function runSweep(
  m5Bars: Bar[],
  axes: SweepAxes,
  config: Partial<BacktestConfig> = {},
  htf: BacktestHtfContext = {}
): SweepPoint[] {
  const points: SweepPoint[] = [];
  for (const minConfidence of axes.minConfidence) {
    for (const atrFloor of axes.atrFloor) {
      const { metrics } = runBacktest(m5Bars, { ...config, minConfidence, atrFloor }, htf);
      points.push({ minConfidence, atrFloor, metrics });
    }
  }
  return points;
}

/**
 * شبکه‌ای حول خود معاملات، نه حول اعداد ثابت.
 *
 * اگر آستانه‌ها بیرون از بازهٔ واقعی داده باشند (مثلاً اعتماد ۷۰ در حالی که همهٔ
 * معاملات ۹۰+ دارند)، همهٔ ترکیب‌ها یک نتیجه می‌دهند و اسکن بی‌فایده می‌شود.
 *
 * محور اعتماد روی [کمینه، میانه، بیشینه] اعتماد معاملات می‌نشیند.
 * محور ATR روی ATR واقعی و فاصلهٔ حد ضرر: تا وقتی کف ATR کمتر از فاصلهٔ ساختاری
 * باشد، فقط اهداف را مقیاس می‌کند و نتیجهٔ R را عوض نمی‌کند؛ پس یک نقطه هم بالای
 * آن آزمون می‌شود وگرنه ستون ATR همیشه یک عدد تکراری نشان می‌دهد.
 */
export function suggestSweepAxes(trades: BacktestTrade[]): SweepAxes {
  if (trades.length === 0) return DEFAULT_SWEEP_AXES;

  const unique = (values: number[]): number[] => [...new Set(values)].sort((a, b) => a - b);
  const median = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const round2 = (n: number): number => Math.round(n * 100) / 100;

  const confidences = unique(trades.map((t) => t.confidence));
  const confidenceAxis = unique([confidences[0], median(confidences), confidences[confidences.length - 1]]);

  const midAtr = median(trades.map((t) => t.atr));
  const midStop = median(trades.map((t) => Math.abs(t.entry - t.sl)));
  const atrAxis = unique([midAtr, midStop / 2, midStop].map(round2));

  return { minConfidence: confidenceAxis, atrFloor: atrAxis };
}

/**
 * رتبه‌بندی از بهترین به بدترین:
 *   ۱. میانگین R هر معامله (انتظار ریاضی)
 *   ۲. نمونهٔ بزرگ‌تر، چون avgR روی چند معامله شانس است نه مهارت
 *   ۳. افت سرمایهٔ کمتر
 * ترکیب‌های بدون معاملهٔ بسته‌شده ته صف می‌روند، وگرنه avgR صفر آن‌ها را از
 * ترکیب‌های واقعاً ضررده بالاتر می‌نشاند.
 */
export function rankSweep(points: SweepPoint[]): SweepPoint[] {
  const closed = (p: SweepPoint): number => p.metrics.wins + p.metrics.losses;
  return [...points].sort((a, b) => {
    const aHasSample = closed(a) > 0;
    if (aHasSample !== closed(b) > 0) return aHasSample ? -1 : 1;
    if (a.metrics.avgR !== b.metrics.avgR) return b.metrics.avgR - a.metrics.avgR;
    if (closed(a) !== closed(b)) return closed(b) - closed(a);
    return a.metrics.maxDrawdown - b.metrics.maxDrawdown;
  });
}
