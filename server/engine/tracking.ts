import { config } from '../config';
import { log } from '../lib/logger';
import { authoritativeNow, formatPersianDateTime } from '../lib/time';
import { computeMarketStatus } from '../lib/marketStatus';
import * as repo from '../db/repo';
import * as quotesEngine from './quotes';
import * as candles from './candles';
import { evaluateTimeframe } from './signals';
import * as telegram from '../telegram/client';
import { signalPnlUsd } from '../telegram/messages';
import type { PriceAlert, TradeSignal } from '../domain/types';

/**
 * 24/7 gold target tracker + trade-protection warnings.
 * Rules:
 *  - Frozen weekend/stale prices never trigger hits (market gate + LIVE-only quotes).
 *  - Hit statuses are terminal: TP3_HIT/SL_HIT are recorded and never overwritten by CLOSED.
 *  - Every hit is journaled in signal_events; channel notifications retry within the run.
 *  - Stage-1 (yellow) and Stage-2 (red) protection warnings, red BEFORE any new signal path.
 */

export interface HitEvent {
  target: 'SL' | 'TP1' | 'TP2' | 'TP3';
  price: number;
}

/** Pure hit evaluation given current bid/ask (BUY exits on bid, SELL exits on ask). */
export function evaluateGoldHits(
  sig: Pick<TradeSignal, 'type' | 'sl' | 'tp1' | 'tp2' | 'tp3' | 'slHitAt' | 'tp1HitAt' | 'tp2HitAt' | 'tp3HitAt'>,
  bid: number,
  ask: number
): HitEvent[] {
  const events: HitEvent[] = [];
  const isBuy = sig.type === 'BUY';

  // Protective exit first
  if (!sig.slHitAt && ((isBuy && bid <= sig.sl) || (!isBuy && ask >= sig.sl))) {
    return [{ target: 'SL', price: sig.sl }];
  }

  // Profit targets with catch-up (hitting TP3 means TP1/TP2 were passed too)
  const tp1Done = Boolean(sig.tp1HitAt);
  const tp2Done = Boolean(sig.tp2HitAt);
  const tp3Done = Boolean(sig.tp3HitAt);

  if (!tp3Done && ((isBuy && bid >= sig.tp3) || (!isBuy && ask <= sig.tp3))) {
    if (!tp1Done) events.push({ target: 'TP1', price: sig.tp1 });
    if (!tp2Done) events.push({ target: 'TP2', price: sig.tp2 });
    events.push({ target: 'TP3', price: sig.tp3 });
    return events;
  }
  if (!tp2Done && ((isBuy && bid >= sig.tp2) || (!isBuy && ask <= sig.tp2))) {
    if (!tp1Done) events.push({ target: 'TP1', price: sig.tp1 });
    events.push({ target: 'TP2', price: sig.tp2 });
    return events;
  }
  if (!tp1Done && ((isBuy && bid >= sig.tp1) || (!isBuy && ask <= sig.tp1))) {
    events.push({ target: 'TP1', price: sig.tp1 });
  }
  return events;
}

const notifyFailures = new Map<string, { target: HitEvent['target']; price: number; pnlUsd: number; attempts: number }>();
const notifyDone = new Set<string>();

/**
 * TP/SL notifications go to the channel (the group concept was removed by owner request).
 * Event names keep the historical GROUP_ prefix so existing signal history stays consistent.
 */
async function notifyChannel(sigId: string, target: HitEvent['target'], price: number, pnlUsd: number): Promise<void> {
  const key = `${sigId}:${target}`;
  if (notifyDone.has(key)) return;
  const res = await telegram.sendTargetUpdate(target, price, pnlUsd);
  if (res.ok) {
    notifyDone.add(key);
    notifyFailures.delete(key);
    await repo.addSignalEvent(sigId, `GROUP_${target}_SENT`, price, { messageId: res.messageId });
  } else {
    const prev = notifyFailures.get(key);
    const attempts = (prev?.attempts || 0) + 1;
    notifyFailures.set(key, { target, price, pnlUsd, attempts });
    await repo.addSignalEvent(sigId, `GROUP_${target}_FAILED`, price, { error: res.description, attempt: attempts });
    if (attempts >= 10) {
      notifyFailures.delete(key);
      log('error', 'Tracking', `ارسال ${target} به کانال پس از ${attempts} تلاش متوقف شد (${sigId}).`);
    }
  }
}

async function applyHit(sig: TradeSignal, ev: HitEvent): Promise<void> {
  const now = authoritativeNow();
  const fmt = formatPersianDateTime(now, 'Asia/Tehran');
  const field = { SL: 'slHitAt', TP1: 'tp1HitAt', TP2: 'tp2HitAt', TP3: 'tp3HitAt' }[ev.target] as
    | 'slHitAt'
    | 'tp1HitAt'
    | 'tp2HitAt'
    | 'tp3HitAt';
  const status = { SL: 'SL_HIT', TP1: 'TP1_HIT', TP2: 'TP2_HIT', TP3: 'TP3_HIT' }[ev.target] as TradeSignal['status'];

  // Terminal statuses are kept; closed_at marks the end without erasing WHICH end it was.
  const terminal = ev.target === 'SL' || ev.target === 'TP3';
  await repo.updateSignal(sig.id, {
    [field]: now,
    status,
    ...(terminal ? { closedAt: now } : {}),
  } as any);
  await repo.addSignalEvent(sig.id, `${ev.target}_HIT`, ev.price, {
    jalaliDate: fmt.jalaliDate,
    tehranTime: fmt.time24,
    previousStatus: sig.status,
    newStatus: status,
  });
  log('info', 'Tracking', `${sig.id}: ${ev.target} محقق شد @ ${ev.price}`);
  await notifyChannel(sig.id, ev.target, ev.price, signalPnlUsd(sig, ev.price));
}

async function recordAlert(
  stage: 'YELLOW' | 'RED',
  sig: TradeSignal,
  sentOk: boolean
): Promise<void> {
  const now = authoritativeNow();
  const fmt = formatPersianDateTime(now, 'Asia/Tehran');
  const gold = quotesEngine.getQuote('XAUUSD');
  const alert: PriceAlert = {
    id: `tp_alt_${now.getTime()}_${Math.random().toString(36).slice(2, 6)}`,
    symbol: 'XAUUSD',
    nameFa: 'طلا (XAU/USD)',
    price: gold?.mid ?? sig.entry,
    change: 0,
    direction: sig.type === 'BUY' ? 'DOWN' : 'UP',
    alertType: stage === 'RED' ? 'REVERSAL_RED' : 'REVERSAL_YELLOW',
    activeTradeEntry: sig.entry,
    activeTradeDirection: sig.type,
    detailsFa:
      stage === 'RED'
        ? 'سیگنال مخالف شکل گرفت — معامله قبلی توسط سیستم محافظت بسته شد'
        : 'فشردگی میانگین‌ها و ورود RSI به فاز مخالف (تغییر جهت در حال مشاهده)',
    telegramSent: sentOk,
    createdAt: now.toISOString(),
  };
  await repo.addAlert(alert);
  await repo.addSignalEvent(sig.id, stage === 'RED' ? 'WARNING_RED' : 'WARNING_YELLOW', alert.price, {
    tehranTime: fmt.time24,
    telegramSent: sentOk,
  });
}

/** تایم‌فریم ذخیره‌شده روی سیگنال → بازه کندل؛ هشدارها باید با تصمیم هم‌زبان باشند. */
const INTERVAL_BY_TIMEFRAME: Record<string, string> = { M1: '1m', M5: '5m', M15: '15m', H1: '1h', H4: '4h' };

async function protectionCheck(sig: TradeSignal): Promise<void> {
  // سیگنال‌های قدیمی‌تر (M1) با همان بازه‌ی خودشان رصد می‌شوند تا هشدار با تصمیم هم‌زبان باشد.
  const interval = INTERVAL_BY_TIMEFRAME[sig.timeframe] ?? '5m';
  const bars = await candles.fetchConfirmedBars('XAUUSD', interval, 240);
  const decision = evaluateTimeframe(bars, Date.now(), interval);
  if (decision.closedBars < 30) return;

  const isBuy = sig.type === 'BUY';
  const oppositeCross = (isBuy && decision.cross === 'BEAR') || (!isBuy && decision.cross === 'BULL');

  // Stage 2 (RED): confirmed opposite cross → close the tracked trade.
  if (oppositeCross && !sig.warningRedAt) {
    const res = await telegram.sendProtectionWarning(sig, 'RED');
    await recordAlert('RED', sig, res.ok);
    const now = authoritativeNow();
    await repo.updateSignal(sig.id, { warningRedAt: now, status: 'REVERSED', reversedAt: now, closedAt: now });
    log('warn', 'Tracking', `${sig.id}: برگشت تأیید شد — وضعیت REVERSED.`);
    return;
  }

  // Stage 1 (YELLOW): EMA compression + momentum leaning opposite → early heads-up.
  const gap = Math.abs(decision.ema9 - decision.ema21);
  const narrowing = gap / (decision.candle?.close || 1) < 0.0004 || gap <= 0.4;
  const rsiLean = isBuy ? decision.rsi < 50 : decision.rsi > 50;
  if (narrowing && rsiLean && !sig.warningYellowAt) {
    const res = await telegram.sendProtectionWarning(sig, 'YELLOW');
    await recordAlert('YELLOW', sig, res.ok);
    await repo.updateSignal(sig.id, { warningYellowAt: authoritativeNow() });
  }
}

export async function tick(): Promise<void> {
  try {
    const market = computeMarketStatus(
      quotesEngine.getDataAgeMs(),
      quotesEngine.isBrokerClosed(),
      config.engine.quoteMaxAgeMs
    );
    // Frozen weekend / disconnected feed: keep positions untouched until real trading resumes.
    if (!market.isOpen) return;

    const gold = quotesEngine.getQuote('XAUUSD');
    if (!gold || gold.quoteState !== 'LIVE' || gold.bid === null || gold.ask === null) return;

    const activeSignals = await repo.findActiveGoldSignals();

    for (const sig of activeSignals) {
      const events = evaluateGoldHits(sig, gold.bid, gold.ask);
      for (const ev of events) {
        await applyHit(sig, ev);
        // reflect the hit locally so catch-up ordering within this pass stays correct
        if (ev.target === 'SL') sig.slHitAt = new Date().toISOString();
        if (ev.target === 'TP1') sig.tp1HitAt = new Date().toISOString();
        if (ev.target === 'TP2') sig.tp2HitAt = new Date().toISOString();
        if (ev.target === 'TP3') sig.tp3HitAt = new Date().toISOString();
      }
      if (events.length === 0 && (sig.status === 'ACTIVE' || sig.status === 'TP1_HIT' || sig.status === 'TP2_HIT')) {
        await protectionCheck(sig);
      }
    }

    // Retry failed group notifications from this run
    for (const [key, info] of notifyFailures) {
      const sigId = key.split(':')[0];
      const res = await telegram.sendTargetUpdate(info.target, info.price, info.pnlUsd);
      if (res.ok) {
        notifyDone.add(key);
        notifyFailures.delete(key);
        await repo.addSignalEvent(sigId, `GROUP_${info.target}_SENT`, info.price, { retry: true });
      }
    }

    await repo.heartbeat({ lastTrackingAt: new Date() });
  } catch (err: any) {
    log('error', 'Tracking', `خطا در چرخه پیگیری اهداف: ${err?.message}`);
  }
}

export function startTracking(): void {
  const loop = () => void tick();
  loop();
  setInterval(loop, 2000);
}
