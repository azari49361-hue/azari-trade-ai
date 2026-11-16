import { Router } from 'express';
import { rateLimit } from '../lib/rateLimit';
import * as telegram from '../telegram/client';
import * as messages from '../telegram/messages';
import { createTestAlert } from '../engine/alerts';
import { normalizeSymbol, config } from '../config';
import * as candleHealth from '../engine/candleHealth';

export const testsRouter = Router();

const limiter = rateLimit({ windowMs: 60_000, max: 12, keyPrefix: 'tests' });

/**
 * Diagnostic sends (rate-limited).
 * Every test message is explicitly labelled "🧪 پیام آزمایشی" so it can never be
 * mistaken for a real trading signal (no fake data requirement).
 * None of these endpoints writes signals into the tracking engine.
 */

testsRouter.post('/test/channel-signal', limiter, async (_req, res) => {
  const result = await telegram.sendTestChannel();
  res.status(result.ok ? 200 : 400).json({
    ok: result.ok,
    description: result.description,
    message: result.ok ? 'پیام آزمایشی به کانال ارسال شد.' : result.description || 'ارسال ناموفق بود.',
  });
});

testsRouter.post('/test/target', limiter, async (req, res) => {
  const target = (req.body?.target as 'TP1' | 'TP2' | 'TP3' | 'SL') || 'TP1';
  if (!['TP1', 'TP2', 'TP3', 'SL'].includes(target)) {
    res.status(400).json({ ok: false, error: 'هدف نامعتبر است.' });
    return;
  }
  const result = await telegram.sendTestTarget(target);
  res.status(result.ok ? 200 : 400).json({
    ok: result.ok,
    description: result.description,
    message: result.ok ? `پیام آزمایشی ${target} به کانال ارسال شد.` : result.description || 'ارسال ناموفق بود.',
  });
});

testsRouter.post('/test/pre-signal', limiter, async (_req, res) => {
  if (!telegram.isConnected()) {
    res.status(400).json({ ok: false, error: 'تلگرام تنظیم نشده است.' });
    return;
  }
  const { emoji, phrase } = messages.randomPreSignal();
  const result = await telegram.sendRawToChannel(`🧪 پیام آزمایشی — Azari Trade AI\n\n${messages.preSignal(emoji, phrase)}`);
  res.status(result.ok ? 200 : 400).json({
    ok: result.ok,
    description: result.description,
    message: result.ok ? 'پیش‌سیگنال آزمایشی ارسال شد (بدون سیگنال واقعی).' : result.description || 'ارسال ناموفق بود.',
  });
});

/**
 * تست واقعی هشدار کهنگی داده (پیام واقعی به چت شخصی، بدون دادهٔ ساختگی).
 *
 * phase=stale : آستانه را برای یک تیک روی ۳۰ ثانیه می‌گذارد تا همان کد واقعی هشدار بفرستد.
 * phase=recover : با آستانهٔ واقعی همان تیک را تکرار می‌کند؛ چون قبلاً هشدار رفته، پیام «داده تازه شد» می‌رود.
 */
testsRouter.post('/test/candle-health', limiter, async (req, res) => {
  const phase = String(req.body?.phase || 'recover');
  if (!['stale', 'recover'].includes(phase)) {
    res.status(400).json({ ok: false, error: 'phase باید stale یا recover باشد.' });
    return;
  }
  if (!telegram.hasAdminChat()) {
    res.status(400).json({ ok: false, error: 'چت شخصی مالک تنظیم نشده است؛ هشدار جایی برای رفتن ندارد.' });
    return;
  }

  if (phase === 'stale') {
    const original = config.engine.candleStaleAfterMs;
    config.engine.candleStaleAfterMs = 30_000;
    try {
      await candleHealth.checkOnce();
    } finally {
      config.engine.candleStaleAfterMs = original;
    }
  } else {
    await candleHealth.checkOnce();
  }

  const status = candleHealth.status();
  const sent = phase === 'stale' ? Boolean(status.lastAlertAt) : Boolean(status.lastRecoveredAt);
  res.json({
    ok: sent,
    phase,
    status,
    message: sent
      ? phase === 'stale'
        ? 'هشدار کهنگی داده واقعاً به چت شخصی ارسال شد.'
        : 'پیام «داده دوباره تازه شد» واقعاً ارسال شد.'
      : phase === 'stale'
      ? 'هشدار ارسال نشد — بازار بسته است یا داده هنوز کهنه نیست (status را ببینید).'
      : 'پیام بازگشت ارسال نشد — اول phase=stale را اجرا کنید تا وضعیت هشدار ثبت شود.',
  });
});

testsRouter.post('/test-alert', limiter, async (req, res) => {
  const symbol = normalizeSymbol(String(req.body?.symbol || 'XAUUSD'));
  if (!symbol) {
    res.status(400).json({ ok: false, error: 'نماد نامعتبر است.' });
    return;
  }
  const alert = await createTestAlert(symbol);
  res.json({ ok: true, alert });
});
