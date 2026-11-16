import { config } from '../config';
import { intervalMs, type Bar } from '../lib/indicators';
import { computeMarketStatus } from '../lib/marketStatus';
import { log } from '../lib/logger';
import { formatPersianDateTime } from '../lib/time';
import * as quotesEngine from './quotes';
import * as candles from './candles';
import * as telegram from '../telegram/client';
import { PRIMARY_TIMEFRAME } from './signals';

/**
 * Candle freshness watchdog.
 *
 * Why: every price-derived number (entry, TP, SL) comes from the newest CLOSED candle. If that
 * candle is old, the dashboard and any future signal are working on stale data — and the user
 * only finds out when a trade is already open. So the owner gets a private Telegram message as
 * soon as the newest closed M5 candle is older than the threshold (10 min by default), and a
 * recovery message when fresh data returns.
 *
 * Rules:
 *  - Alerts go to the owner's private chat only (never to the signal channel).
 *  - Market hours only: a weekend/broker-closed feed is silent by design.
 *  - Repeats at most once per 30 minutes while the feed stays stale (no spam).
 */

/** How often the watchdog samples the candle feed. */
export const CHECK_INTERVAL_MS = 60_000;
/** Minimum gap between two "still stale" reminders. */
export const REPEAT_ALERT_MS = 30 * 60_000;

export interface StaleTracker {
  /** When the last stale alert was actually sent (ms), null when currently healthy. */
  alertedAt: number | null;
}

export type StaleAction = 'ALERT' | 'RECOVERED' | null;

/** Pure decision function: what (if anything) to do about the current candle age. */
export function staleAction(
  ageMs: number,
  thresholdMs: number,
  tracker: StaleTracker,
  now: number,
  repeatMs: number = REPEAT_ALERT_MS
): StaleAction {
  if (ageMs > thresholdMs) {
    if (tracker.alertedAt !== null && now - tracker.alertedAt < repeatMs) return null;
    return 'ALERT';
  }
  return tracker.alertedAt !== null ? 'RECOVERED' : null;
}

/** Age of the newest closed candle, measured from the moment it closed (ms). */
export function newestCandleAgeMs(bars: readonly Bar[], now: number, interval: string): number | null {
  const span = intervalMs(interval);
  if (!bars.length || span <= 0) return null;
  let newest = -Infinity;
  for (const b of bars) {
    const open = new Date(b.openTime).getTime();
    if (Number.isFinite(open) && open > newest) newest = open;
  }
  if (newest === -Infinity) return null;
  return Math.max(0, now - (newest + span));
}

export function buildStaleAlertText(input: {
  symbol: string;
  timeframe: string;
  ageMs: number | null;
  thresholdMs: number;
  newestCandleOpenIso: string | null;
  nowMs: number;
}): string {
  const fmt = formatPersianDateTime(new Date(input.nowMs), 'Asia/Tehran');
  const thresholdMin = Math.round(input.thresholdMs / 60_000);
  const ageText =
    input.ageMs === null
      ? 'داده‌ای نرسیده (هیچ کندل تازه‌ای در دسترس نیست)'
      : `${(input.ageMs / 60_000).toFixed(1)} دقیقه`;
  const candleText = input.newestCandleOpenIso
    ? new Date(input.newestCandleOpenIso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
    : 'نامشخص';
  return (
    `⚠️ هشدار کهنگی داده کندل\n\n` +
    `نماد: ${input.symbol} — تایم‌فریم ${input.timeframe}\n` +
    `سن داده: ${ageText} (حد مجاز ${thresholdMin} دقیقه)\n` +
    `آخرین کندل بسته: ${candleText}\n\n` +
    `🛑 از این کندل برای قیمت ورود/TP/SL استفاده نمی‌شود؛ سیگنال جدید صادر نمی‌شود تا داده تازه شود.\n` +
    `⏰ ${fmt.jalaliDate} ساعت ${fmt.time24} (تهران)`
  );
}

export function buildRecoveryText(input: {
  symbol: string;
  timeframe: string;
  ageMs: number;
  newestCandleOpenIso: string | null;
  nowMs: number;
}): string {
  const fmt = formatPersianDateTime(new Date(input.nowMs), 'Asia/Tehran');
  const candleText = input.newestCandleOpenIso
    ? new Date(input.newestCandleOpenIso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
    : 'نامشخص';
  return (
    `✅ داده کندل دوباره تازه شد\n\n` +
    `نماد: ${input.symbol} — تایم‌فریم ${input.timeframe}\n` +
    `سن داده: ${(input.ageMs / 60_000).toFixed(1)} دقیقه\n` +
    `آخرین کندل بسته: ${candleText}\n\n` +
    `🟢 پایش و صدور سیگنال از سر گرفته شد.\n` +
    `⏰ ${fmt.jalaliDate} ساعت ${fmt.time24} (تهران)`
  );
}

const tracker: StaleTracker = { alertedAt: null };
let sawCandleSinceBoot = false;
let warnedNoAdminChat = false;

/** وضعیت قابل نمایش در داشبورد (بدون حدس: هر فیلد از آخرین بررسی واقعی می‌آید). */
let lastCheckAt: number | null = null;
let lastAgeMs: number | null = null;
let marketOpen: boolean | null = null;
let lastAction: 'ALERT' | 'RECOVERED' | null = null;
let lastAlertAt: number | null = null;
let lastRecoveredAt: number | null = null;

export type CandleHealthState = 'OK' | 'STALE' | 'WAITING' | 'MARKET_CLOSED' | 'DISABLED';

export interface CandleHealthStatus {
  state: CandleHealthState;
  thresholdMs: number;
  checkIntervalMs: number;
  adminChatConfigured: boolean;
  marketOpen: boolean | null;
  lastCheckAt: string | null;
  nextCheckAt: string | null;
  ageMs: number | null;
  lastAction: 'ALERT' | 'RECOVERED' | null;
  lastAlertAt: string | null;
  lastRecoveredAt: string | null;
}

export function status(): CandleHealthStatus {
  const adminChatConfigured = telegram.hasAdminChat();
  let state: CandleHealthState;
  if (!adminChatConfigured) state = 'DISABLED';
  else if (marketOpen === false) state = 'MARKET_CLOSED';
  else if (lastAgeMs === null) state = 'WAITING';
  else state = lastAgeMs > config.engine.candleStaleAfterMs || tracker.alertedAt !== null ? 'STALE' : 'OK';

  const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
  return {
    state,
    thresholdMs: config.engine.candleStaleAfterMs,
    checkIntervalMs: CHECK_INTERVAL_MS,
    adminChatConfigured,
    marketOpen,
    lastCheckAt: iso(lastCheckAt),
    nextCheckAt: iso((lastCheckAt ?? Date.now()) + CHECK_INTERVAL_MS),
    ageMs: lastAgeMs,
    lastAction,
    lastAlertAt: iso(lastAlertAt),
    lastRecoveredAt: iso(lastRecoveredAt),
  };
}

/** One watchdog pass. Exported so it can be exercised without timers. */
export async function checkOnce(now: number = Date.now()): Promise<void> {
  lastCheckAt = now;
  if (!telegram.hasAdminChat()) {
    if (!warnedNoAdminChat) {
      warnedNoAdminChat = true;
      log(
        'info',
        'CandleHealth',
        'چت شخصی مالک تنظیم نشده است — هشدار کهنگی داده غیرفعال می‌ماند (فیلد «چت‌آیدی شخصی من» را در تنظیمات تلگرام پر کنید).'
      );
    }
    return;
  }

  const market = computeMarketStatus(
    quotesEngine.getDataAgeMs(),
    quotesEngine.isBrokerClosed(),
    config.engine.quoteMaxAgeMs
  );
  marketOpen = market.isOpen;
  // Weekend / broker closed: silence is expected, not a data fault.
  if (!market.isOpen) {
    lastAgeMs = null;
    return;
  }

  const symbol = 'XAUUSD';
  const interval = PRIMARY_TIMEFRAME.interval;
  const bars = await candles.fetchConfirmedBars(symbol, interval, 5);
  const ageMs = newestCandleAgeMs(bars, now, interval);
  lastAgeMs = ageMs;
  if (ageMs !== null) sawCandleSinceBoot = true;
  // Before the first successful fetch after boot, "no data" is not evidence of a stale feed.
  if (ageMs === null && !sawCandleSinceBoot) return;

  const thresholdMs = config.engine.candleStaleAfterMs;
  const action = staleAction(ageMs ?? Number.POSITIVE_INFINITY, thresholdMs, tracker, now);

  if (action === 'ALERT') {
    const newest = bars.length ? bars.reduce((a, b) => (new Date(b.openTime) > new Date(a.openTime) ? b : a)) : null;
    const res = await telegram.sendAdminAlert(
      buildStaleAlertText({
        symbol,
        timeframe: PRIMARY_TIMEFRAME.label,
        ageMs,
        thresholdMs,
        newestCandleOpenIso: newest?.openTime ?? null,
        nowMs: now,
      })
    );
    if (res.ok) {
      tracker.alertedAt = now;
      lastAlertAt = now;
      lastAction = 'ALERT';
      log(
        'warn',
        'CandleHealth',
        `${symbol} ${PRIMARY_TIMEFRAME.label}: داده کندل کهنه است (${ageMs === null ? 'بدون داده' : Math.round(ageMs / 60000) + ' دقیقه'}) — هشدار به چت شخصی ارسال شد.`
      );
    } else {
      log('error', 'CandleHealth', `ارسال هشدار کهنگی داده ناموفق: ${res.description}`);
    }
    return;
  }

  if (action === 'RECOVERED') {
    tracker.alertedAt = null;
    lastRecoveredAt = now;
    lastAction = 'RECOVERED';
    const newest = bars.length ? bars.reduce((a, b) => (new Date(b.openTime) > new Date(a.openTime) ? b : a)) : null;
    const res = await telegram.sendAdminAlert(
      buildRecoveryText({
        symbol,
        timeframe: PRIMARY_TIMEFRAME.label,
        ageMs: ageMs ?? 0,
        newestCandleOpenIso: newest?.openTime ?? null,
        nowMs: now,
      })
    );
    if (res.ok) {
      log('info', 'CandleHealth', `${symbol} ${PRIMARY_TIMEFRAME.label}: داده کندل تازه شد — پیام بازگشت ارسال شد.`);
    } else {
      log('error', 'CandleHealth', `ارسال پیام بازگشت داده ناموفق: ${res.description}`);
    }
  }
}

/** Start the 24/7 watchdog (no-op loop is cheap; the logic is in checkOnce). */
export function startCandleHealth(): void {
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    checkOnce()
      .catch((e) => log('error', 'CandleHealth', `پایش کهنگی داده شکست خورد: ${e?.message}`))
      .finally(() => {
        running = false;
      });
  }, CHECK_INTERVAL_MS);
  log(
    'info',
    'CandleHealth',
    `پایش کهنگی داده فعال شد: هر ${CHECK_INTERVAL_MS / 1000} ثانیه، آستانه ${config.engine.candleStaleAfterMs / 60000} دقیقه`
  );
}

/** Test/ops helper: forget in-memory alert state. */
export function resetState(): void {
  tracker.alertedAt = null;
  sawCandleSinceBoot = false;
  warnedNoAdminChat = false;
  lastCheckAt = null;
  lastAgeMs = null;
  marketOpen = null;
  lastAction = null;
  lastAlertAt = null;
  lastRecoveredAt = null;
}
