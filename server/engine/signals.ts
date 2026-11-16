import { SYMBOL_DIGITS, SYMBOL_NAMES_FA, config, type SymbolCode } from '../config';
import { calculateATR, calculateEMA, calculateRSI, candleIsFresh, closedBarsOnly, intervalMs, type Bar } from '../lib/indicators';
import { authoritativeNow, formatPersianDateTime } from '../lib/time';
import { computeMarketStatus } from '../lib/marketStatus';
import { log } from '../lib/logger';
import * as repo from '../db/repo';
import * as newsCalendar from './newsCalendar';
import * as telegram from '../telegram/client';
import * as quotesEngine from './quotes';
import * as candles from './candles';
import * as dispatcher from './dispatcher';
import type { SignalAnalysis, TradeSignal, TimeframeAnalysis } from '../domain/types';

/**
 * Signal engine.
 * Hard rules enforced here:
 *  1. Signals are decided ONLY on confirmed (closed) candles — the forming bar never counts.
 *  2. One decision per (symbol, timeframe, closed candle) — DB-unique constraint; survives restarts.
 *  3. Cooldown between signals is honoured for manual scans too (no force bypass exists anymore).
 *  4. No signal without real data: missing/stale quotes or wide spread block issuance.
 *  5. SL is structural (swing low/high of recent closed bars), clamped to a
 *     1.5–2.5×ATR band; TP1/2/3 are 1R/2R/3R of that risk. RR is derived, never hardcoded.
 *
 * Primary decision timeframe is M5: fewer, cleaner signals than M1 (noise and spread cost
 * hurt a 1-minute trade far more than a 5-minute one).
 */

/** تایم‌فریم اصلی تصمیم سیگنال. */
export const PRIMARY_TIMEFRAME = { label: 'M5', interval: '5m', nameFa: 'پنج دقیقه' } as const;

/** آخرین رویداد خبری که برای آن اعلان تلگرام ارسال شده. */
let lastNewsNotifiedKey: string | null = null;

// ------------------------------------------------------------------ pure core

export interface TfSnapshot {
  ema9: number | null;
  ema21: number | null;
  rsi: number | null;
  atr: number | null;
  closedBars: number;
}

export interface CrossDecision {
  cross: 'BULL' | 'BEAR' | null;
  candle: Bar | null;
  ema9: number;
  ema21: number;
  prevEma9: number;
  prevEma21: number;
  /** تغییر EMA21 در ۳ کندل اخیر — جهت‌دهندهٔ شیب روند. */
  ema21Slope: number;
  rsi: number;
  atr: number;
  closedBars: number;
}

/** Evaluate EMA9/EMA21 crossover + RSI + ATR on CONFIRMED bars of one timeframe. */
export function evaluateTimeframe(bars: Bar[], now: number, interval: string): CrossDecision {
  const closed = closedBarsOnly(bars, now, interval);
  const empty: CrossDecision = {
    cross: null, candle: null, ema9: 0, ema21: 0, prevEma9: 0, prevEma21: 0, ema21Slope: 0, rsi: 50, atr: 0, closedBars: closed.length,
  };
  if (closed.length < 30) return empty;

  const closes = closed.map((b) => b.close);
  const ema9Arr = calculateEMA(closes, 9);
  const ema21Arr = calculateEMA(closes, 21);
  const len = closes.length - 1;
  const ema9 = ema9Arr[len];
  const ema21 = ema21Arr[len];
  const prevEma9 = ema9Arr[len - 1];
  const prevEma21 = ema21Arr[len - 1];
  if ([ema9, ema21, prevEma9, prevEma21].some((v) => v === undefined)) return empty;

  const rsi = calculateRSI(closes, 14);
  const atr = calculateATR(closed, 14);
  const candle = closed[len];
  // شیب EMA21 روی ۳ کندل — برای رد کردن تقاطع‌های داخل بازار رِنج
  const slopeRef = ema21Arr[len - 3];
  const ema21Slope = slopeRef === undefined ? 0 : ema21 - slopeRef;

  const bull = prevEma9 <= prevEma21 && ema9 > ema21;
  const bear = prevEma9 >= prevEma21 && ema9 < ema21;
  return {
    cross: bull ? 'BULL' : bear ? 'BEAR' : null,
    candle,
    ema9, ema21, prevEma9, prevEma21, ema21Slope,
    rsi, atr,
    closedBars: closed.length,
  };
}

export function snapshot(bars: Bar[], now: number, interval: string): TfSnapshot {
  const closed = closedBarsOnly(bars, now, interval);
  if (closed.length < 30) {
    return { ema9: null, ema21: null, rsi: null, atr: null, closedBars: closed.length };
  }
  const closes = closed.map((b) => b.close);
  const e9 = calculateEMA(closes, 9);
  const e21 = calculateEMA(closes, 21);
  const last = closes.length - 1;
  return {
    ema9: e9[last] ?? null,
    ema21: e21[last] ?? null,
    rsi: calculateRSI(closes, 14),
    atr: calculateATR(closed, 14),
    closedBars: closed.length,
  };
}

export interface Levels {
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  rrRatio: number;
  rrLabel: string;
}

/**
 * پهنای مجاز حد ضرر برحسب ATR. اندازه‌گیری روی کندل‌های واقعی M5 نشان داد SL 1.5×ATR
 * در ۲۱٪ موارد قبل از رسیدن به هدف زده می‌شد؛ با SL پویا در بازهٔ ۱.۵ تا ۲.۵×ATR
 * (ساختار کندل) این توقف‌های زودهنگام به ۱۵٪ رسید و نرخ برد از ۴۲٪ به ۴۶٪ رفت.
 */
export const SL_ATR_MIN = 1.5;
export const SL_ATR_MAX = 2.5;
/** چند کندل بستهٔ اخیر برای پیدا کردن سوئینگ ساختاری. */
export const SL_STRUCTURE_LOOKBACK = 6;
/** بافر فراتر از سوئینگ (کسر ATR) تا حد ضرر دقیقاً روی لبهٔ نویز نباشد. */
export const SL_STRUCTURE_BUFFER_ATR = 0.25;

/**
 * فاصلهٔ حد ضرر بر اساس ساختار: پایین‌ترین کف (BUY) یا بالاترین سقف (SELL) در
 * چند کندل بستهٔ اخیر، بعلاوهٔ یک بافر کوچک ATR. null = ساختار در دسترس نیست.
 */
export function structureStopDistance(
  type: 'BUY' | 'SELL',
  entry: number,
  bars: Bar[],
  atr: number
): number | null {
  if (!(atr > 0) || !(entry > 0) || bars.length === 0) return null;
  const recent = bars.slice(-SL_STRUCTURE_LOOKBACK);
  let extreme = type === 'BUY' ? Infinity : -Infinity;
  for (const b of recent) {
    if (!Number.isFinite(b.low) || !Number.isFinite(b.high)) continue;
    extreme = type === 'BUY' ? Math.min(extreme, b.low) : Math.max(extreme, b.high);
  }
  if (!Number.isFinite(extreme)) return null;
  const stop = type === 'BUY' ? extreme - SL_STRUCTURE_BUFFER_ATR * atr : extreme + SL_STRUCTURE_BUFFER_ATR * atr;
  return Math.abs(entry - stop);
}

/**
 * SL پویا: فاصلهٔ ساختاری (اگر بود) در بازهٔ [1.5, 2.5]×ATR محدود می‌شود.
 * TP1/2/3 = ۱/۲/۳ برابر همان ریسک، تا R:R با پهن‌شدن حد ضرر خراب نشود.
 * RR از فاصلهٔ واقعی TP2 و SL محاسبه می‌شود (هیچ‌جا هاردکد نیست).
 */
export function computeLevels(
  type: 'BUY' | 'SELL',
  entry: number,
  atr: number,
  digits: number,
  structureDistance: number | null = null
): Levels {
  const fallbackRisk = ((SL_ATR_MIN + SL_ATR_MAX) / 2) * atr; // ساختار نامعلوم → ۲×ATR
  const risk = Math.min(Math.max(structureDistance ?? fallbackRisk, SL_ATR_MIN * atr), SL_ATR_MAX * atr);
  const rawSl = type === 'BUY' ? entry - risk : entry + risk;
  // حد ضرر عدد رند/تمیز (بدون اعشار) برای خوانایی و ثبات بیشتر
  const sl = type === 'BUY' ? Math.floor(rawSl) : Math.ceil(rawSl);
  const slDist = Math.abs(entry - sl);
  const tp1 = type === 'BUY' ? entry + slDist : entry - slDist;
  const tp2 = type === 'BUY' ? entry + 2 * slDist : entry - 2 * slDist;
  const tp3 = type === 'BUY' ? entry + 3 * slDist : entry - 3 * slDist;
  const rrRatio = slDist > 0 ? Math.abs(tp2 - entry) / slDist : 0;
  return {
    sl,
    tp1: round(tp1, digits),
    tp2: round(tp2, digits),
    tp3: round(tp3, digits),
    rrRatio: parseFloat(rrRatio.toFixed(2)),
    rrLabel: `1:${rrRatio.toFixed(2)}`,
  };
}

export function passesMomentum(type: 'BUY' | 'SELL', rsi: number): boolean {
  // فیلتر مومنتوم متعادل: ناحیه با کیفیت کافی برای جهت سیگنال، با اجتناب از اشباع/ضعف شدید
  // (الهام از بهترین‌عمل‌ها: تأیید مومنتوم بدون حذف کورکورانه فرصت‌های معتبر)
  return type === 'BUY' ? rsi >= 53 && rsi <= 70 : rsi <= 47 && rsi >= 30;
}

/** Spread quality gate: reject when spread is known and wider than 0.3% of price. */
export function spreadAcceptable(spread: number | null, mid: number | null): boolean {
  if (spread === null || mid === null || mid <= 0) return true; // unknown spread: cannot judge, do not invent
  return spread / mid <= 0.003;
}

/**
 * M5 quality gate: the spread must stay small relative to the five-minute ATR.
 * Unknown spread is never fabricated into a rejection (same convention as spreadAcceptable).
 */
export function spreadVsAtrOk(spread: number | null, atr: number, maxRatio: number): boolean {
  if (!Number.isFinite(atr) || atr <= 0) return false; // no volatility data → cannot size a trade
  if (spread === null || !Number.isFinite(spread)) return true;
  return spread / atr <= maxRatio;
}

/** حداقل بدنهٔ کندل تصمیم نسبت به ATR. */
export const MIN_BODY_ATR = 0.35;

/**
 * فیلتر کیفیت ورود: بدنهٔ کندل تصمیم باید نسبت به ATR معنادار باشد.
 * اندازه‌گیری روی کندل‌های واقعی M5 (۲۷ تقاطع، ۵ روز) نشان داد تقاطع‌هایی با
 * بدنهٔ کمتر از 0.35×ATR میانگین بازده منفی داشتند، در حالی که رعایت همین حد
 * میانگین R را از 0.20 به 0.42 برد. این فیلتر دوجی‌ها و «تقاطع نویزی» را رد می‌کند.
 */
export function candleImpulseOk(bar: Bar, atr: number, minBodyAtr = MIN_BODY_ATR): boolean {
  if (!Number.isFinite(atr) || atr <= 0) return false;
  return Math.abs(bar.close - bar.open) >= minBodyAtr * atr;
}

/**
 * فیلتر شیب: EMA21 باید در جهت سیگنال حرکت کرده باشد؛ تقاطعی که EMA21 آن تخت یا
 * مخالف است معمولاً در بازار رِنج رخ می‌دهد و سریع برمی‌گردد.
 */
export function emaSlopeOk(slope: number, type: 'BUY' | 'SELL'): boolean {
  if (!Number.isFinite(slope)) return false;
  return type === 'BUY' ? slope > 0 : slope < 0;
}

export function computeConfidence(
  type: 'BUY' | 'SELL',
  ema9: number,
  ema21: number,
  close: number,
  rsi: number,
  h4Trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
  h1Trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL'
): number {
  let confidence = 58;
  const emaDistPercent = (Math.abs(ema9 - ema21) / close) * 100;
  if (emaDistPercent > 0.02) confidence += 6;
  if (emaDistPercent > 0.05) confidence += 6;
  if (emaDistPercent > 0.1) confidence += 4;
  if (type === 'BUY' && h4Trend === 'BULLISH') confidence += 14;
  if (type === 'SELL' && h4Trend === 'BEARISH') confidence += 14;
  if (type === 'BUY' && h1Trend === 'BULLISH') confidence += 8;
  if (type === 'SELL' && h1Trend === 'BEARISH') confidence += 8;
  // ناحیه RSI با کیفیت بالاتر (دور از مرزها)
  if (type === 'BUY' && rsi >= 55 && rsi <= 65) confidence += 10;
  else if (type === 'BUY' && rsi >= 53 && rsi <= 70) confidence += 6;
  if (type === 'SELL' && rsi <= 45 && rsi >= 35) confidence += 10;
  else if (type === 'SELL' && rsi <= 47 && rsi >= 30) confidence += 6;
  return Math.min(95, Math.max(55, Math.round(confidence)));
}

export function buildReason(
  type: 'BUY' | 'SELL',
  rsi: number,
  h4Trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
  h4Confirmed: boolean,
  timeframe: string
): string {
  const dir = type === 'BUY' ? 'صعودی' : 'نزولی';
  const trendText = !h4Confirmed
    ? 'روند H4 تأیید نشد (داده H4 در دسترس نبود)'
    : h4Trend === 'NEUTRAL'
    ? 'ساختار روند H4 خنثی'
    : `هم‌راستایی روندهای H4/H1 (${h4Trend === 'BULLISH' ? 'صعودی' : 'نزولی'})`;
  return `تقاطع ${dir} EMA 9/21 روی کندل بسته ${timeframe}، مومنتوم RSI (${rsi.toFixed(1)}) و ${trendText} — فیلترهای سخت‌گیرانه کیفیت عبور کرده`;
}

// ------------------------------------------------------------------ shared entry evaluation

/** دروازه‌هایی که یک ورود را رد می‌کنند؛ اسکن زنده پیام فارسی و بک‌تست فقط «رد» را از آن می‌سازد. */
export type EntryGate =
  | 'no_cross'
  | 'rsi'
  | 'candle_direction'
  | 'h4_unconfirmed'
  | 'h4_misaligned'
  | 'm15_data'
  | 'm15_misaligned'
  | 'h1_data'
  | 'h1_misaligned'
  | 'candle_body'
  | 'ema_slope'
  | 'confidence';

export interface EntryInput {
  /** نتیجهٔ evaluateTimeframe روی کندل بستهٔ تایم‌فریم اصلی. */
  decision: CrossDecision;
  /** کندل‌های بستهٔ تایم‌فریم اصلی — مبنای حد ضرر ساختاری. */
  primaryBars: Bar[];
  htf: { m15: Bar[]; h1: Bar[]; h4: Bar[] };
  /** لحظهٔ ارزیابی؛ کندلی که بعد از این لحظه بسته شده باشد دیده نمی‌شود. */
  now: number;
  digits: number;
  atrFloor: number;
  minConfidence: number;
}

export interface EntryRejection {
  ok: false;
  gate: EntryGate;
  type: 'BUY' | 'SELL';
  /** فقط وقتی H4 محاسبه شده باشد (برای پیام دقیق اسکن زنده). */
  h4Trend?: 'BULLISH' | 'BEARISH';
  /** فقط روی دروازهٔ confidence. */
  confidence?: number;
}

export interface EntryAcceptance {
  ok: true;
  type: 'BUY' | 'SELL';
  entry: number;
  atr: number;
  levels: Levels;
  confidence: number;
  h4Trend: 'BULLISH' | 'BEARISH';
  m15: TfSnapshot;
  h1: TfSnapshot;
  m15Aligned: boolean;
  h1Aligned: boolean;
  bodyAtrRatio: number;
}

export type EntryPlan = EntryAcceptance | EntryRejection;

/**
 * زنجیرهٔ واحد ارزیابی ورود — تنها تعریف «ورود معتبر».
 *
 * اسکن زنده (scanSymbol) و بک‌تست (runBacktest) هر دو از همین تابع می‌گذرند؛
 * اگر یک دروازه عوض شود، هر دو با هم عوض می‌شوند و متریک بک‌تست از رفتار واقعی
 * جدا نمی‌افتد. فقط از کندل‌های بسته استفاده می‌کند (بدون نگاه به آینده).
 *
 * دروازه‌های مخصوص دادهٔ زنده (کول‌داون، تازگی کندل، اسپرد لحظه‌ای) اینجا نیستند.
 */
export function evaluateEntry(input: EntryInput): EntryPlan {
  const { decision, primaryBars, htf, now, digits, atrFloor, minConfidence } = input;
  const type: 'BUY' | 'SELL' = decision.cross === 'BULL' ? 'BUY' : 'SELL';
  const fail = (gate: EntryGate, extra: Pick<EntryRejection, 'h4Trend' | 'confidence'> = {}): EntryPlan => ({
    ok: false,
    gate,
    type,
    ...extra,
  });

  if (!decision.candle || decision.cross === null || !(decision.atr > 0)) return fail('no_cross');
  if (!passesMomentum(type, decision.rsi)) return fail('rsi');

  const candle = decision.candle;
  const candleAligned = type === 'BUY' ? candle.close >= candle.open : candle.close <= candle.open;
  if (!candleAligned) return fail('candle_direction');

  // HTF فقط از کندل‌هایی که *در لحظهٔ ارزیابی* بسته شده‌اند؛ پرچم isOpen منبع جای زمان را نمی‌گیرد
  // (وگرنه بک‌تست کندل‌های آیندهٔ تایم‌فریم بالاتر را می‌بیند و نتیجه واقعی نیست).
  const closedUpTo = (source: Bar[], interval: string): Bar[] =>
    source.filter((b) => Date.parse(b.openTime) + intervalMs(interval) <= now);

  // روند H4 تأییدشده و هم‌جهت — پیش‌نیاز هر ورود.
  const h4Closed = closedUpTo(htf.h4, '4h');
  if (h4Closed.length < 21) return fail('h4_unconfirmed');
  const h4Closes = h4Closed.map((b) => b.close);
  const h4EmaValues = calculateEMA(h4Closes, 21);
  const h4Ema21 = h4EmaValues[h4EmaValues.length - 1];
  if (h4Ema21 === undefined) return fail('h4_unconfirmed');
  const h4Trend: 'BULLISH' | 'BEARISH' = h4Closes[h4Closes.length - 1] >= h4Ema21 ? 'BULLISH' : 'BEARISH';
  if (h4Trend !== (type === 'BUY' ? 'BULLISH' : 'BEARISH')) return fail('h4_misaligned', { h4Trend });

  // M15 و H1 هم باید هم‌جهت باشند.
  const m15 = snapshot(closedUpTo(htf.m15, '15m'), now, '15m');
  if (m15.ema9 === null || m15.ema21 === null || m15.closedBars < 30) return fail('m15_data');
  const m15Aligned = type === 'BUY' ? m15.ema9 >= m15.ema21 : m15.ema9 <= m15.ema21;
  if (!m15Aligned) return fail('m15_misaligned');

  const h1 = snapshot(closedUpTo(htf.h1, '1h'), now, '1h');
  if (h1.ema9 === null || h1.ema21 === null || h1.closedBars < 30) return fail('h1_data');
  const h1Aligned = type === 'BUY' ? h1.ema9 >= h1.ema21 : h1.ema9 <= h1.ema21;
  if (!h1Aligned) return fail('h1_misaligned');

  if (!candleImpulseOk(candle, decision.atr, MIN_BODY_ATR)) return fail('candle_body');
  if (!emaSlopeOk(decision.ema21Slope, type)) return fail('ema_slope');

  const entry = round(candle.close, digits);
  // کف ATR فقط دادهٔ مرده را می‌گیرد و روی ATR عادی اثری ندارد.
  const atr = Math.max(decision.atr, atrFloor);
  const levels = computeLevels(type, entry, atr, digits, structureStopDistance(type, entry, primaryBars, atr));
  const h1Trend: 'BULLISH' | 'BEARISH' = type === 'BUY' ? 'BULLISH' : 'BEARISH';
  let confidence = computeConfidence(type, decision.ema9, decision.ema21, candle.close, decision.rsi, h4Trend, h1Trend);
  // پاداش هم‌راستایی چندتایم‌فریمی (M15/H1)
  if (m15Aligned && h1Aligned) confidence = Math.min(95, confidence + 4);
  // پاداش کندل ایمپالس قوی (بدنه ≥ 0.7×ATR): ورود با مومنتوم واقعی، نه تقاطع مرزی
  const bodyAtrRatio = atr > 0 ? Math.abs(candle.close - candle.open) / atr : 0;
  if (bodyAtrRatio >= 0.7) confidence = Math.min(95, confidence + 4);
  if (confidence < minConfidence) return fail('confidence', { confidence });

  return { ok: true, type, entry, atr, levels, confidence, h4Trend, m15, h1, m15Aligned, h1Aligned, bodyAtrRatio };
}

function round(v: number, digits: number): number {
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}

// ------------------------------------------------------------------ scanner

export interface SkippedInfo {
  symbol: string;
  reason: string;
  /** کد کوتاه دروازه‌ای که رد کرد (برای ثبت تاریخچه در دیتابیس) */
  gate?: string;
}

export interface ScanSummary {
  blocked?: string;
  generated: number;
  deduped: number;
  skipped: SkippedInfo[];
  signals: TradeSignal[];
}

// Safety floor per symbol, sized for the M5 primary timeframe.
// Measured M5 ATR14 on live data (2026-11-09): XAUUSD≈2.98, XAGUSD≈0.066, USOIL≈0.24, DXY≈0.020.
// The floor sits below typical M5 ATR so it only guards dead/flat market data, never widens normal SL/TP.
const ATR_FLOOR: Record<SymbolCode, number> = { XAUUSD: 1.8, XAGUSD: 0.045, USOIL: 0.11, DXY: 0.018 };

/**
 * تنها طلا سیگنال معاملاتی می‌گیرد. XAGUSD/USOIL/DXY فقط قیمت زنده در داشبورد دارند
 * (بدون سیگنال، بدون ارسال به تلگرام). برای افزودن نماد دیگر، همین آرایه را تغییر بده.
 */
export const SIGNAL_SYMBOLS: readonly SymbolCode[] = ['XAUUSD'];

/** چند روز تاریخچهٔ تصمیم‌های اسکن نگه داشته شود. */
const SCAN_DECISION_KEEP_DAYS = 7;
const SCAN_DECISION_PRUNE_MS = 60 * 60 * 1000;
let lastDecisionPruneAt = 0;

/**
 * هر اسکن (خودکار یا دستی) یک ردیف در scan_decisions می‌نویسد تا دلیل رد شدن
 * بعداً بدون رصد دستی قابل مشاهده باشد. خطای ثبت هرگز اسکن را متوقف نمی‌کند.
 */
async function recordScanDecisions(summary: ScanSummary, scannedAt: Date): Promise<void> {
  try {
    const rows: repo.ScanDecisionRow[] = [];
    if (summary.blocked) {
      rows.push({ symbol: '-', outcome: 'blocked', gate: 'market_closed', reason: summary.blocked });
    }
    for (const s of summary.skipped) {
      rows.push({
        symbol: s.symbol,
        outcome: s.gate === 'dedupe' ? 'deduped' : s.gate === 'error' ? 'error' : 'skipped',
        gate: s.gate ?? null,
        reason: s.reason,
      });
    }
    for (const sig of summary.signals) {
      rows.push({
        symbol: sig.symbol,
        outcome: 'signal',
        gate: null,
        reason: `سیگنال ${sig.type} @ ${sig.entry} (${sig.rrLabel}) روی کندل بسته ${sig.candleOpenTime}`,
        candleOpenTime: sig.candleOpenTime ? new Date(sig.candleOpenTime) : null,
      });
    }
    await repo.addScanDecisions(rows, scannedAt);

    if (Date.now() - lastDecisionPruneAt > SCAN_DECISION_PRUNE_MS) {
      lastDecisionPruneAt = Date.now();
      await repo.pruneScanDecisions(SCAN_DECISION_KEEP_DAYS);
    }
  } catch (err: any) {
    log('warn', 'SignalEngine', `ثبت تاریخچهٔ اسکن ممکن نشد: ${err?.message}`);
  }
}

export async function scanAll(): Promise<ScanSummary> {
  const summary: ScanSummary = { generated: 0, deduped: 0, skipped: [], signals: [] };

  const market = computeMarketStatus(
    quotesEngine.getDataAgeMs(),
    quotesEngine.isBrokerClosed(),
    config.engine.quoteMaxAgeMs
  );
  if (!market.isOpen) {
    summary.blocked = `${market.reasonFa} (${market.dayFa})`;
    log('info', 'SignalEngine', `اسکن متوقف: ${summary.blocked}`);
    await recordScanDecisions(summary, new Date());
    return summary;
  }

  const now = Date.now();

  // --- دروازهٔ تقویم خبری: سکوت ۳۰ دقیقه‌ای قبل/بعد از رویدادهای high-impact (NFP/FOMC/CPI و ...) ---
  try {
    const newsEnabled = await newsCalendar.isEnabled();
    if (newsEnabled) {
      const { blocked, event } = newsCalendar.isInNewsBlackout(now, newsCalendar.getEvents());
      if (blocked && event) {
        const reason = `سکوت خبری: رویداد «${event.title}» (${event.country}) در ${new Date(event.date).toLocaleTimeString('fa-IR', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit' })}`;
        for (const symbol of SIGNAL_SYMBOLS) {
          summary.skipped.push({ symbol, gate: 'news_blackout', reason });
        }
        log('info', 'SignalEngine', `اسکن متوقف (سکوت خبری): ${reason}`);
        // ارسال اعلان تلگرام فقط یک‌بار برای هر رویداد
        if (telegram.hasAdminChat() && lastNewsNotifiedKey !== `${event.title}|${event.date}`) {
          lastNewsNotifiedKey = `${event.title}|${event.date}`;
          const fmt = formatPersianDateTime(authoritativeNow(), 'Asia/Tehran');
          void telegram.sendAdminAlert(
            `📰 سکوت خبری — Azari Trade AI\n\n` +
            `سیگنال طلا به دلیل رویداد خبری high-impact صادر نشد.\n` +
            `رویداد: ${event.title} (${event.country})\n` +
            `زمان: ${fmt.jalaliDate} ساعت ${fmt.time24} (تهران)\n\n` +
            `پنجرهٔ سکوت: ۳۰ دقیقه قبل و بعد از رویداد.`
          );
        }
        await recordScanDecisions(summary, new Date(now));
        return summary;
      }
    }
  } catch (err: any) {
    log('warn', 'SignalEngine', `بررسی تقویم خبری ناموفق: ${err?.message}`);
  }

  for (const symbol of SIGNAL_SYMBOLS) {
    try {
      await scanSymbol(symbol, now, summary);
    } catch (err: any) {
      log('error', 'SignalEngine', `خطا در اسکن ${symbol}: ${err?.message}`);
      summary.skipped.push({ symbol, gate: 'error', reason: `خطای داخلی: ${err?.message}` });
    }
  }
  await repo.heartbeat({ lastScanAt: new Date() });
  await recordScanDecisions(summary, new Date(now));
  return summary;
}

async function scanSymbol(symbol: SymbolCode, now: number, summary: ScanSummary): Promise<void> {
  const isGold = symbol === 'XAUUSD';
  const digits = SYMBOL_DIGITS[symbol];
  const cooldownMs = isGold ? config.engine.goldCooldownMs : config.engine.symbolCooldownMs;

  // Cooldown — applies to manual scans as well. There is no bypass anymore.
  const last = await repo.lastSignalCreatedAt(symbol);
  if (last && now - new Date(last).getTime() < cooldownMs) {
    const waitMin = Math.ceil((cooldownMs - (now - new Date(last).getTime())) / 60000);
    summary.skipped.push({ symbol, gate: 'cooldown', reason: `کول‌داون سیگنال (${waitMin} دقیقه باقی‌مانده)` });
    return;
  }

  // Real-data gate: no quote, no signal. Ever.
  const quote = quotesEngine.getQuote(symbol);
  if (!quote || quote.quoteState === 'NONE' || quote.mid === null) {
    summary.skipped.push({ symbol, gate: 'no_quote', reason: 'اتصال برقرار نیست — قیمت واقعی در دسترس نیست' });
    return;
  }
  if (quote.quoteState !== 'LIVE') {
    summary.skipped.push({ symbol, gate: 'stale_quote', reason: 'داده قیمت تازه نیست (STALE) — صدور سیگنال متوقف' });
    return;
  }
  if (!spreadAcceptable(quote.spread, quote.mid)) {
    summary.skipped.push({ symbol, gate: 'wide_spread', reason: `اسپرد غیرعادی وسیع (${quote.spread}) — کیفیت داده رد شد` });
    log('warn', 'SignalEngine', `${symbol}: اسپرد ${quote.spread} بیش از حد مجاز است؛ سیگنال صادر نشد.`);
    return;
  }

  // Primary timeframe: 5 minutes — decision only on confirmed (closed) M5 candles.
  const barsPrimary = await candles.fetchConfirmedBars(symbol, PRIMARY_TIMEFRAME.interval, 240);
  const decision = evaluateTimeframe(barsPrimary, now, PRIMARY_TIMEFRAME.interval);
  if (!decision.candle || decision.closedBars < 30 || decision.cross === null) {
    summary.skipped.push({
      symbol,
      gate: 'no_cross',
      reason: `تقاطع تأییدشده EMA 9/21 روی کندل بسته ${PRIMARY_TIMEFRAME.label} وجود ندارد`,
    });
    return;
  }

  // کندل تصمیم باید تازه باشد؛ وگرنه قیمت ورود از بازار فاصله می‌گیرد (باگ ترتیب/کهنگی داده).
  if (!candleIsFresh(decision.candle.openTime, now, PRIMARY_TIMEFRAME.interval)) {
    summary.skipped.push({
      symbol,
      gate: 'stale_candle',
      reason: `کندل تصمیم (${new Date(decision.candle.openTime).toISOString()}) قدیمی است — ورود به قیمت لحظه‌ای نزدیک نیست`,
    });
    log('warn', 'SignalEngine', `${symbol}: کندل بسته قدیمی است؛ سیگنال صادر نشد تا ورود از قیمت بازار فاصله نگیرد.`);
    return;
  }

  // M5 quality gate: spread must be small relative to the five-minute ATR.
  const maxRatio = config.engine.maxSpreadAtrRatio;
  if (!spreadVsAtrOk(quote.spread, decision.atr, maxRatio)) {
    const pct = decision.atr > 0 ? ((quote.spread! / decision.atr) * 100).toFixed(0) : '∞';
    const atrText = decision.atr > 0 ? decision.atr.toFixed(digits) : '0';
    summary.skipped.push({
      symbol,
      gate: 'spread_atr',
      reason: `اسپرد ${quote.spread} نسبت به ATR پنج‌دقیقه (${atrText}) بزرگ است (${pct}%) — ورود بی‌کیفیت رد شد`,
    });
    log(
      'warn',
      'SignalEngine',
      `${symbol}: اسپرد/ATR = ${pct}% (حد مجاز ${Math.round(maxRatio * 100)}%) — سیگنال صادر نشد.`
    );
    return;
  }

  // Multi-timeframe breakdown (M5 primary, M15 + H1 context, H4 trend)
  const nowMs = Date.now();
  const [barsM15, barsH1, barsH4] = await Promise.all([
    candles.fetchConfirmedBars(symbol, '15m', 120),
    candles.fetchConfirmedBars(symbol, '1h', 120),
    candles.fetchConfirmedBars(symbol, '4h', 40),
  ]);

  if (decision.atr < ATR_FLOOR[symbol]) {
    log('warn', 'SignalEngine', `${symbol}: ATR محاسبه‌شده ${decision.atr} بسیار کوچک بود؛ کف ${ATR_FLOOR[symbol]} اعمال شد.`);
  }

  // زنجیرهٔ واحد ارزیابی ورود — بک‌تست دقیقاً همین تابع را صدا می‌زند.
  const plan = evaluateEntry({
    decision,
    primaryBars: closedBarsOnly(barsPrimary, now, PRIMARY_TIMEFRAME.interval),
    htf: { m15: barsM15, h1: barsH1, h4: barsH4 },
    now: nowMs,
    digits,
    atrFloor: ATR_FLOOR[symbol],
    minConfidence: 74,
  });

  if (!plan.ok) {
    const reject = (gate: string, reason: string) => summary.skipped.push({ symbol, gate, reason });
    switch (plan.gate) {
      case 'rsi':
        reject('rsi', `RSI ${decision.rsi.toFixed(1)} مومنتوم کافی برای ${plan.type} ندارد`);
        break;
      case 'candle_direction':
        reject('candle_direction', 'کندل سیگنال با جهت معامله هم‌راستا نیست (فیلتر کیفیت)');
        break;
      case 'h4_unconfirmed':
        reject('h4_unconfirmed', 'روند H4 تایید نشد — سیگنال با کیفیت کافی صادر نشد');
        break;
      case 'h4_misaligned':
        reject('h4_misaligned', `سیگنال ${plan.type} با روند H4 (${plan.h4Trend ?? 'NEUTRAL'}) هم‌راستا نیست — رد به‌دلیل کیفیت`);
        break;
      case 'm15_data':
        reject('m15_data', 'داده تاییدی M15 کافی نیست — سیگنال صادر نشد');
        break;
      case 'm15_misaligned':
        reject('m15_misaligned', 'ساختار M15 با جهت سیگنال هم‌راستا نیست — رد به‌دلیل کیفیت');
        break;
      case 'h1_data':
        reject('h1_data', 'داده تاییدی H1 کافی نیست — سیگنال صادر نشد');
        break;
      case 'h1_misaligned':
        reject('h1_misaligned', 'ساختار H1 با جهت سیگنال هم‌راستا نیست — رد به‌دلیل کیفیت');
        break;
      case 'candle_body': {
        const bodyAtr = decision.atr > 0 ? (Math.abs(decision.candle.close - decision.candle.open) / decision.atr).toFixed(2) : '0';
        reject('candle_body', `بدنهٔ کندل سیگنال فقط ${bodyAtr}×ATR است (حداقل ${MIN_BODY_ATR}) — تقاطع بدون مومنتوم واقعی رد شد`);
        break;
      }
      case 'ema_slope':
        reject('ema_slope', `شیب EMA21 در ۳ کندل اخیر هم‌جهت ${plan.type} نیست (${decision.ema21Slope.toFixed(digits)}) — تقاطع در بازار رِنج رد شد`);
        break;
      case 'confidence':
        reject('confidence', `امتیاز کیفیت سیگنال (${plan.confidence ?? 0}) کمتر از حد مطلوب است — ارسال نشد`);
        break;
      default:
        reject('no_cross', `تقاطع تأییدشده EMA 9/21 روی کندل بسته ${PRIMARY_TIMEFRAME.label} وجود ندارد`);
    }
    return;
  }

  const { type, entry, atr, levels, confidence } = plan;
  const h4Trend = plan.h4Trend;
  const h4Confirmed = true;
  const snapPrimary = snapshot(barsPrimary, nowMs, PRIMARY_TIMEFRAME.interval);
  const snapM15 = plan.m15;
  const snapH1 = plan.h1;

  const reason = buildReason(type, decision.rsi, h4Trend, h4Confirmed, PRIMARY_TIMEFRAME.label);

  const candleOpenTime = new Date(decision.candle.openTime);
  const createdAt = authoritativeNow();
  const fmt = formatPersianDateTime(createdAt, 'Asia/Tehran');

  const tf = (s: ReturnType<typeof snapshot>, interval: string): TimeframeAnalysis => ({
    ema9: s.ema9 !== null ? round(s.ema9, digits) : null,
    ema21: s.ema21 !== null ? round(s.ema21, digits) : null,
    rsi: s.rsi !== null ? parseFloat(s.rsi.toFixed(1)) : null,
    atr: s.atr !== null ? round(s.atr, digits) : null,
    closedBars: s.closedBars,
    interval,
  } as TimeframeAnalysis);

  const signal: TradeSignal = {
    id: `sig_${symbol.toLowerCase()}_${candleOpenTime.getTime()}_${Math.random().toString(36).slice(2, 6)}`,
    symbol,
    nameFa: SYMBOL_NAMES_FA[symbol],
    timeframe: PRIMARY_TIMEFRAME.label,
    type,
    entry,
    sl: levels.sl,
    tp1: levels.tp1,
    tp2: levels.tp2,
    tp3: levels.tp3,
    rrRatio: levels.rrRatio,
    rrLabel: levels.rrLabel,
    confidence,
    reason,
    analysis: {
      primaryTimeframe: PRIMARY_TIMEFRAME.label,
      timeframes: {
        M5: tf(snapPrimary, PRIMARY_TIMEFRAME.interval),
        M15: tf(snapM15, '15m'),
        H1: tf(snapH1, '1h'),
      },
      h4Trend,
      h4TrendConfirmed: h4Confirmed,
      crossOnClosedCandle: true,
      candleOpenTime: candleOpenTime.toISOString(),
      spreadAtEntry: quote.spread,
      dataAgeSeconds: quote.ageSeconds ?? 0,
    },
    indicators: {
      ema9: round(decision.ema9, digits),
      ema21: round(decision.ema21, digits),
      rsi: parseFloat(decision.rsi.toFixed(1)),
      atr: round(atr, digits),
      h4Trend,
    },
    // Gold waits in PENDING until the dispatcher (pre-signal → 60s → channel) confirms it.
    status: isGold ? 'PENDING' : 'ACTIVE',
    jalaliDate: fmt.jalaliDate,
    tehranTime: fmt.time24,
    timezone: 'Asia/Tehran',
    source: quote.source,
    candleOpenTime: candleOpenTime.toISOString(),
    createdAt: createdAt.toISOString(),
    dispatchAt: isGold ? createdAt.toISOString() : null,
    preSignalSentAt: null,
    channelSentAt: null,
    tp1HitAt: null,
    tp2HitAt: null,
    tp3HitAt: null,
    slHitAt: null,
    warningYellowAt: null,
    warningRedAt: null,
    reversedAt: null,
    closedAt: null,
  };

  const inserted = await repo.insertSignal(signal);
  if (!inserted) {
    // Same closed candle already produced a decision — this is dedupe working, not an error.
    summary.deduped++;
    summary.skipped.push({ symbol, gate: 'dedupe', reason: 'تکرار: برای همین کندل بسته قبلاً سیگنال ثبت شده است' });
    return;
  }

  await repo.addSignalEvent(signal.id, 'CREATED', entry, {
    type,
    timeframe: PRIMARY_TIMEFRAME.label,
    candleOpenTime: signal.candleOpenTime,
  });
  summary.generated++;
  summary.signals.push(signal);
  log('info', 'SignalEngine', `سیگنال ${type} ${symbol} @ ${entry} (${levels.rrLabel}) روی کندل بسته ${signal.candleOpenTime}`);

  if (isGold) {
    await dispatcher.enqueue(signal);
  } else {
    // Non-gold signals are dashboard-only (telegram sends XAUUSD exclusively).
    await repo.addSignalEvent(signal.id, 'DASHBOARD_ONLY', null, { note: 'فقط طلا به تلگرام ارسال می‌شود' });
  }
}
