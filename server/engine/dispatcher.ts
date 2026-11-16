import { log } from '../lib/logger';
import { config } from '../config';
import { authoritativeNow } from '../lib/time';
import * as repo from '../db/repo';
import * as telegram from '../telegram/client';
import type { PreSignalStatus, TradeSignal } from '../domain/types';

/**
 * Gold signal dispatcher with PERSISTED scheduling.
 * Flow: signal row inserted as PENDING → pre-signal sent to channel → configurable
 *      countdown (PRE_SIGNAL_DELAY_SECONDS, 15s by default for M5) → main signal sent
 *      to channel → status ACTIVE.
 * Because the schedule lives in the DB, a server restart can never lose a pending signal:
 * on boot the same tick resumes any PENDING rows (recovery built in).
 */

const MAX_SEND_ATTEMPTS = 40;
const RETRY_DELAY_MS = 45_000;

const attemptCounts = new Map<string, number>();
let preSignalView: PreSignalStatus | null = null;

/** Called right after the scanner inserted a new PENDING gold signal. */
export async function enqueue(_sig: TradeSignal): Promise<void> {
  // The row is already persisted as PENDING; the next tick (≤1s) picks it up.
  // Nothing time-critical is kept in memory here.
}

export async function tick(): Promise<void> {
  try {
    const pending = await repo.listPendingGoldDispatches();
    preSignalView = null;

    for (const sig of pending) {
      const now = authoritativeNow();

      // Stage 1: pre-signal
      if (!sig.preSignalSentAt) {
        if (telegram.isConnected()) {
          const res = await telegram.sendPreSignalToChannel();
          if (res.ok) {
            await repo.addSignalEvent(sig.id, 'PRE_SIGNAL_SENT', null, { emoji: res.emoji, phrase: res.phrase });
          } else {
            await repo.addSignalEvent(sig.id, 'PRE_SIGNAL_FAILED', null, { error: res.description });
            log('warn', 'Dispatcher', `پیش‌سیگنال ${sig.id} ارسال نشد: ${res.description}`);
          }
        } else {
          await repo.addSignalEvent(sig.id, 'PRE_SIGNAL_SKIPPED', null, { reason: 'تلگرام تنظیم نشده است' });
        }
        const dispatchAt = new Date(now.getTime() + config.engine.preSignalDelayMs);
        await repo.updateSignal(sig.id, { preSignalSentAt: now, dispatchAt });
        continue;
      }

      // Stage 2: main channel dispatch (after the pre-signal countdown)
      if (!sig.channelSentAt) {
        if (!telegram.isConnected()) {
          // No telegram configured: keep the signal visible on the dashboard without waiting.
          await repo.updateSignal(sig.id, { status: 'ACTIVE' });
          await repo.addSignalEvent(sig.id, 'DISPATCH_SKIPPED_NO_TELEGRAM');
          continue;
        }

        if (sig.dispatchAt && new Date(sig.dispatchAt).getTime() > now.getTime()) {
          // Countdown running — publish live status for the dashboard banner.
          const remaining = Math.ceil((new Date(sig.dispatchAt).getTime() - now.getTime()) / 1000);
          preSignalView = {
            active: true,
            symbol: 'XAUUSD',
            targetTime: new Date(sig.dispatchAt).getTime(),
            remainingSeconds: remaining,
            emoji: '⚡',
            phrase: 'سیگنال اصلی در راه است!',
            direction: sig.type,
            entry: sig.entry,
          };
          continue;
        }

        const attempts = (attemptCounts.get(sig.id) || 0) + 1;
        attemptCounts.set(sig.id, attempts);
        await repo.addSignalEvent(sig.id, 'DISPATCH_ATTEMPT', null, { attempt: attempts });

        const sentAt = authoritativeNow();
        const res = await telegram.sendChannelSignal(sig);
        if (res.ok) {
          attemptCounts.delete(sig.id);
          await repo.updateSignal(sig.id, { status: 'ACTIVE', channelSentAt: sentAt });
          await repo.addSignalEvent(sig.id, 'CHANNEL_SIGNAL_SENT', sig.entry, { messageId: res.messageId });
          // تأخیر واقعی برای بررسی: از پیش‌سیگنال تا رسیدن سیگنال اصلی به کانال
          const delaySec = sig.preSignalSentAt
            ? ((sentAt.getTime() - new Date(sig.preSignalSentAt).getTime()) / 1000).toFixed(1)
            : '? ';
          log('info', 'Dispatcher', `سیگنال طلا ${sig.id} به کانال ارسال شد (تأخیر از پیش‌سیگنال: ${delaySec}s | هدف: ${config.engine.preSignalDelayMs / 1000}s).`);
        } else if (attempts >= MAX_SEND_ATTEMPTS) {
          attemptCounts.delete(sig.id);
          await repo.updateSignal(sig.id, { status: 'ACTIVE' });
          await repo.addSignalEvent(sig.id, 'DISPATCH_GAVE_UP', null, { error: res.description });
          log('error', 'Dispatcher', `ارسال سیگنال ${sig.id} پس از ${attempts} تلاش متوقف شد: ${res.description}`);
        } else {
          await repo.updateSignal(sig.id, { dispatchAt: new Date(now.getTime() + RETRY_DELAY_MS) });
          await repo.addSignalEvent(sig.id, 'DISPATCH_FAILED', null, { error: res.description });
        }
      }
    }
  } catch (err: any) {
    log('error', 'Dispatcher', `خطا در چرخه پخش سیگنال: ${err?.message}`);
  }
}

export function getPreSignalStatus(): PreSignalStatus | null {
  return preSignalView;
}

export function startDispatcher(): void {
  // Recovery log: pending rows from before a restart are resumed by the same tick.
  void repo
    .listPendingGoldDispatches()
    .then((rows) => {
      if (rows.length > 0) {
        log('info', 'Dispatcher', `${rows.length} سیگنال معلق از قبل پیدا شد — زمان‌بندی از سر گرفته می‌شود.`);
      }
    })
    .catch(() => undefined);

  const loop = () => void tick();
  loop();
  setInterval(loop, 1000);
}
