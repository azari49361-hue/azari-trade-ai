import { config } from '../config';
import { log } from '../lib/logger';
import { formatPersianDateTime } from '../lib/time';
import { scanAll } from './signals';
import * as quotesEngine from './quotes';
import * as candles from './candles';
import * as telegram from '../telegram/client';

/**
 * چرخهٔ اسکن خودکار + ناظر آن.
 *
 * چرا: اگر یک اسکن به‌خاطر قطعی فید یا درخواست معلق گیر کند، قفل `running` برای همیشه
 * بسته می‌ماند و اسکن بی‌صدا متوقف می‌شود. این ماژول:
 *  - هر اسکن را با سقف زمانی اجرا می‌کند و در صورت گیر کردن، قفل را آزاد می‌کند؛
 *  - اگر بیشتر از حد آستانه هیچ اسکنی کامل نشود، کش کندل را پاک و فید قیمت را دوباره می‌زند؛
 *  - یک‌بار به تلگرام مالک هشدار «اسکن متوقف» می‌دهد و در بازگشت، پیام بهبودی می‌فرستد؛
 *  - وضعیتش را برای داشبورد (`/api/state → scanHealth`) افشا می‌کند.
 */

const TICK_MS = config.engine.scanIntervalMs;
const TIMEOUT_MS = config.engine.scanTimeoutMs;
const STALL_MS = config.engine.scanStallAlertMs;
/** فاصلهٔ بررسی ناظر: حداکثر ۳۰ ثانیه، حداقل یک‌سوم آستانه. */
const SUPERVISE_MS = Math.max(5_000, Math.min(30_000, Math.floor(STALL_MS / 3)));
/** حداقل فاصله بین دو هشدار توقف پیاپی (ضد اسپم). */
export const ALERT_REPEAT_MS = 15 * 60_000;

export type ScanLoopState = 'OK' | 'STALLED' | 'WAITING' | 'MARKET_CLOSED';

export interface ScanHealthStatus {
  state: ScanLoopState;
  thresholdMs: number;
  timeoutMs: number;
  intervalMs: number;
  adminChatConfigured: boolean;
  running: boolean;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  stalledForMs: number | null;
  lastError: string | null;
  lastBlockedReason: string | null;
  timeoutRecoveries: number;
  lastAlertAt: string | null;
}

// ------------------------------------------------------------------ pure logic

/** آیا با این فاصله از آخرین اسکن موفق، اسکن «متوقف» حساب می‌شود؟ */
export function isScanStalled(now: number, lastSuccessAt: number | null, startedAt: number, thresholdMs: number): boolean {
  const base = lastSuccessAt ?? startedAt;
  return now - base > thresholdMs;
}

/** آیا زمان ارسال هشدار توقف رسیده است؟ (اولین بار یا بعد از دورهٔ تکرار) */
export function shouldAlertStall(now: number, lastAlertAt: number | null, repeatMs: number = ALERT_REPEAT_MS): boolean {
  return lastAlertAt === null || now - lastAlertAt >= repeatMs;
}

/** وضعیت نمایشی برای داشبورد — فقط از زمان‌های واقعی. */
export function computeScanState(input: {
  now: number;
  startedAt: number;
  lastSuccessAt: number | null;
  marketClosed: boolean;
  thresholdMs: number;
}): ScanLoopState {
  if (input.marketClosed) return 'MARKET_CLOSED';
  if (input.lastSuccessAt === null) {
    return input.now - input.startedAt > input.thresholdMs ? 'STALLED' : 'WAITING';
  }
  return isScanStalled(input.now, input.lastSuccessAt, input.startedAt, input.thresholdMs) ? 'STALLED' : 'OK';
}

// ------------------------------------------------------------------ runtime state

const startedAt = Date.now();
let started = false;
let running = false;
let runStartedAt: number | null = null;
let lastAttemptAt: number | null = null;
let lastSuccessAt: number | null = null;
let lastError: string | null = null;
let lastBlockedReason: string | null = null;
let timeoutRecoveries = 0;
let lastAlertAt: number | null = null;
let alertedWhileStalled = false;

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

export function status(now: number = Date.now()): ScanHealthStatus {
  const marketClosed = quotesEngine.isBrokerClosed();
  const state = computeScanState({ now, startedAt, lastSuccessAt, marketClosed, thresholdMs: STALL_MS });
  const base = lastSuccessAt ?? startedAt;
  return {
    state,
    thresholdMs: STALL_MS,
    timeoutMs: TIMEOUT_MS,
    intervalMs: TICK_MS,
    adminChatConfigured: telegram.hasAdminChat(),
    running,
    lastAttemptAt: iso(lastAttemptAt),
    lastSuccessAt: iso(lastSuccessAt),
    stalledForMs: state === 'STALLED' ? now - base : null,
    lastError,
    lastBlockedReason,
    timeoutRecoveries,
    lastAlertAt: iso(lastAlertAt),
  };
}

/** اجرای scanAll با سقف زمانی. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err: any = new Error(`SCAN_TIMEOUT: اسکن بیش از ${Math.round(ms / 1000)} ثانیه طول کشید`);
      err.code = 'SCAN_TIMEOUT';
      reject(err);
    }, ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

/** بازیابی فید: پاک‌کردن کش کندل + پول تازهٔ قیمت. */
function recoverFeed(): void {
  candles.clearCandleCache();
  void quotesEngine.pollOnce().catch((e) => log('warn', 'ScanLoop', `پول بازیابی شکست خورد: ${e?.message}`));
}

async function runOnce(): Promise<void> {
  const now = Date.now();
  lastAttemptAt = now;
  runStartedAt = now;
  running = true;
  const previousSuccessAt = lastSuccessAt;
  try {
    const summary = await withTimeout(scanAll(), TIMEOUT_MS);
    lastSuccessAt = Date.now();
    lastError = null;
    lastBlockedReason = summary.blocked ?? null;
    if (summary.generated > 0) log('info', 'SignalEngine', `اسکن دوره‌ای: ${summary.generated} سیگنال جدید`);

    // پیام بهبودی فقط اگر قبلاً هشدار توقف داده بودیم
    if (alertedWhileStalled) {
      alertedWhileStalled = false;
      const recoveredAt = Date.now();
      const fmt = formatPersianDateTime(new Date(recoveredAt), 'Asia/Tehran');
      const stallMins = previousSuccessAt ? Math.max(1, Math.round((recoveredAt - previousSuccessAt) / 60_000)) : 0;
      void telegram
        .sendAdminAlert(
          `✅ اسکن خودکار دوباره راه افتاد\n\n` +
            `آخرین اسکن موفق: ${new Date(lastSuccessAt).toISOString().replace('T', ' ').slice(0, 16)} UTC\n` +
            `مدت وقفه تا بازگشت: ${stallMins} دقیقه\n` +
            `⏰ ${fmt.jalaliDate} ساعت ${fmt.time24} (تهران)`
        )
        .catch(() => undefined);
      log('info', 'ScanLoop', 'اسکن بعد از وقفه دوباره سالم شد — پیام بهبودی به مالک ارسال شد.');
    }
  } catch (err: any) {
    lastError = err?.message || String(err);
    if (err?.code === 'SCAN_TIMEOUT') {
      timeoutRecoveries += 1;
      candles.clearCandleCache();
      log('warn', 'ScanLoop', `${lastError} — قفل اسکن آزاد شد و کش کندل پاک شد.`);
    } else {
      log('error', 'SignalEngine', `اسکن دوره‌ای شکست خورد: ${lastError}`);
    }
  } finally {
    running = false;
    runStartedAt = null;
  }
}

/** یک دور بررسی ناظر. */
async function supervise(): Promise<void> {
  const now = Date.now();

  // قفل گیرکرده را آزاد کن
  if (running && runStartedAt !== null && now - runStartedAt > TIMEOUT_MS) {
    running = false;
    runStartedAt = null;
    timeoutRecoveries += 1;
    candles.clearCandleCache();
    log('warn', 'ScanLoop', 'اسکن معلق بود — قفل آزاد و کش کندل پاک شد (ناظر).');
  }

  if (!isScanStalled(now, lastSuccessAt, startedAt, STALL_MS)) return;

  recoverFeed();

  if (!shouldAlertStall(now, lastAlertAt)) return;
  if (!telegram.hasAdminChat()) {
    log('warn', 'ScanLoop', 'اسکن متوقف است ولی چت شخصی مالک تنظیم نشده — هشدار تلگرام فرستاده نشد.');
    return;
  }

  const base = lastSuccessAt ?? startedAt;
  const mins = Math.max(1, Math.round((now - base) / 60_000));
  const fmt = formatPersianDateTime(new Date(now), 'Asia/Tehran');
  const res = await telegram.sendAdminAlert(
    `⛔ اسکن خودکار متوقف شده است\n\n` +
      `بیش از ${mins} دقیقه هیچ اسکنی کامل نشده (آستانه ${Math.round(STALL_MS / 60_000)} دقیقه).\n` +
      `آخرین اسکن موفق: ${lastSuccessAt ? new Date(lastSuccessAt).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : 'هنوز هیچ'}\n` +
      `آخرین خطا: ${lastError || 'نامشخص'}\n` +
      (lastBlockedReason ? `دلیل توقف اسکن: ${lastBlockedReason}\n` : '') +
      `\n♻️ اقدام خودکار: قفل اسکن آزاد، کش کندل پاک و فید قیمت دوباره زده شد؛ چرخه هر ${Math.round(TICK_MS / 1000)} ثانیه تلاش می‌کند.\n` +
      `⏰ ${fmt.jalaliDate} ساعت ${fmt.time24} (تهران)`
  );
  if (res.ok) {
    lastAlertAt = now;
    alertedWhileStalled = true;
    log('warn', 'ScanLoop', `اسکن ${mins} دقیقه متوقف بود — هشدار به چت شخصی مالک ارسال شد.`);
  } else {
    log('error', 'ScanLoop', `ارسال هشدار توقف اسکن ناموفق: ${res.description}`);
  }
}

/** شروع چرخهٔ ۲۴/۷: اسکن دوره‌ای + ناظر. */
export function startScanLoop(): void {
  if (started) return;
  started = true;

  setInterval(() => {
    if (running) return;
    void runOnce();
  }, TICK_MS);

  setInterval(() => {
    void supervise().catch((e) => log('error', 'ScanLoop', `ناظر اسکن شکست خورد: ${e?.message}`));
  }, SUPERVISE_MS);

  log(
    'info',
    'SignalEngine',
    `چرخه اسکن خودکار: هر ${TICK_MS / 1000} ثانیه (سقف هر اسکن ${TIMEOUT_MS / 1000} ثانیه، هشدار توقف بعد از ${STALL_MS / 60_000} دقیقه)`
  );
}
