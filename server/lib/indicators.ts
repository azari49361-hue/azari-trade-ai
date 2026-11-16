/**
 * Technical indicators — pure functions, unit-tested.
 * EMA: standard smoothing seeded with SMA of the first `period` values.
 * RSI/ATR: Wilder smoothing.
 */

export function calculateEMA(prices: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  if (prices.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += prices[i];
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < prices.length; i++) {
    const curr = prices[i] * k + prev * (1 - k);
    out[i] = curr;
    prev = curr;
  }
  return out;
}

export function calculateRSI(closes: number[], period = 14): number {
  if (closes.length <= period) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export interface Bar {
  openTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
  /** true when the source marks this bar as still forming */
  isOpen?: boolean;
}

export function calculateATR(bars: Bar[], period = 14): number {
  if (bars.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const cur = bars[i];
    const prev = bars[i - 1];
    trs.push(
      Math.max(cur.high - cur.low, Math.abs(cur.high - prev.close), Math.abs(cur.low - prev.close))
    );
  }
  if (trs.length < period) return 0;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += trs[i];
  let atr = sum / period;
  for (let i = period; i < trs.length; i++) atr = (atr * (period - 1) + trs[i]) / period;
  return atr;
}

/** Interval string → milliseconds. */
export function intervalMs(interval: string): number {
  const m = /^(\d+)([mdh])$/.exec(interval);
  if (!m) return 0;
  const n = parseInt(m[1], 10);
  switch (m[2]) {
    case 'm':
      return n * 60_000;
    case 'h':
      return n * 3_600_000;
    case 'd':
      return n * 86_400_000;
    default:
      return 0;
  }
}

/**
 * A bar is CONFIRMED (closed) only when its window has fully elapsed at `now`.
 * Sources marking isOpen=false are also accepted as closed.
 * This enforces the "signal only after confirmed candle close" rule.
 */
export function isBarClosed(bar: Bar, now: number, interval: string): boolean {
  if (bar.isOpen === true) return false;
  const start = new Date(bar.openTime).getTime();
  if (!Number.isFinite(start)) return false;
  if (bar.isOpen === false) return true;
  return start + intervalMs(interval) <= now;
}

/**
 * Guards the "entry must be close to the live price" property.
 * A decision candle older than `maxAgeIntervals` intervals means the feed (or its ordering) is
 * stale — the entry/TP/SL computed from it would be far from the market, so no signal is allowed.
 */
export function candleIsFresh(
  candleOpenTime: string,
  now: number,
  interval: string,
  maxAgeIntervals = 3
): boolean {
  const open = new Date(candleOpenTime).getTime();
  const span = intervalMs(interval);
  if (!Number.isFinite(open) || span <= 0) return false;
  const closedAt = open + span;
  return now - closedAt <= maxAgeIntervals * span;
}

/**
 * Filter to confirmed bars only, ASCENDING by open time (last closed bar is at index length-1).
 * Sources disagree on order (biquote newest-first, Twelve Data oldest-first), so the order is
 * normalized here — every caller of this function (EMA/RSI/ATR, levels, entry price) depends on it.
 */
export function closedBarsOnly(bars: Bar[], now: number, interval: string): Bar[] {
  // زمان‌ها یک‌بار پارس می‌شوند؛ Date.parse در تابع مقایسه (به‌ازای هر مقایسه)
  // در replay بک‌تست با هزاران کندل، هزینهٔ اصلی بود.
  return bars
    .filter((b) => isBarClosed(b, now, interval))
    .map((b) => ({ b, t: Date.parse(b.openTime) }))
    .sort((x, y) => x.t - y.t)
    .map((x) => x.b);
}
