import { Router } from 'express';
import { rateLimit } from '../lib/rateLimit';
import { computeMarketStatus } from '../lib/marketStatus';
import { config } from '../config';
import * as quotesEngine from '../engine/quotes';
import { scanAll } from '../engine/signals';
import * as repo from '../db/repo';

export const scanRouter = Router();

const limiter = rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'scan' });

let scanning = false;

/**
 * تاریخچهٔ تصمیم‌های اسکن (خودکار و دستی): هر ردیف یا سیگنال صادرشده است یا
 * اولین دروازه‌ای که رد کرده — بدون نیاز به رصد زندهٔ پروسه.
 */
scanRouter.get('/scan-history', async (req, res) => {
  const hours = Math.min(Math.max(Number(req.query.hours) || 24, 1), 24 * 14);
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
  // فیلترهای اختیاری: فقط ردهای یک دروازه یا یک نماد
  const gate = String(req.query.gate || '').trim() || undefined;
  const symbol = String(req.query.symbol || '').trim().toUpperCase() || undefined;
  try {
    const [recent, byGate] = await Promise.all([
      repo.listScanDecisions(limit, hours, { gate, symbol }),
      repo.scanDecisionStats(hours, { gate, symbol }),
    ]);
    res.json({ ok: true, hours, limit, gate: gate || null, symbol: symbol || null, byGate, recent });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'خطا در خواندن تاریخچه اسکن' });
  }
});

/**
 * مسیر تصمیم‌های یک کندل — کنار هر سیگنال در داشبورد استفاده می‌شود تا معلوم شود
 * آن سیگنال از کدام دروازه‌ها گذشته است.
 */
scanRouter.get('/scan-history/candle', async (req, res) => {
  const symbol = String(req.query.symbol || '').trim().toUpperCase();
  const candleRaw = String(req.query.candle || '').trim();
  const candle = new Date(candleRaw);
  if (!symbol || !candleRaw || Number.isNaN(candle.getTime())) {
    res.status(400).json({ ok: false, error: 'symbol و candle (ISO) لازم است' });
    return;
  }
  try {
    const rows = await repo.listScanDecisionsForCandle(symbol, candle);
    res.json({ ok: true, symbol, candle: candle.toISOString(), rows });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'خطا در خواندن مسیر اسکن' });
  }
});

/**
 * Manual scan — same rules as the automatic scanner:
 * market must be open, cooldowns apply, closed candles only, real data required.
 * There is no force/bypass path anymore (that bug produced duplicate signals before).
 */
scanRouter.post('/scan-now', limiter, async (_req, res) => {
  const status = computeMarketStatus(quotesEngine.getDataAgeMs(), quotesEngine.isBrokerClosed(), config.engine.quoteMaxAgeMs);
  if (!status.isOpen) {
    res.json({
      ok: false,
      isMarketClosed: true,
      reason: status.reasonFa,
      dayFa: status.dayFa,
      nextOpenFa: status.nextOpenFa,
      message: `${status.reasonFa} صدور سیگنال جدید پس از بازگشایی و دریافت داده تازه از سر گرفته می‌شود.`,
      generatedCount: 0,
      goldSignalsCount: 0,
    });
    return;
  }

  if (scanning) {
    res.json({ ok: true, message: 'اسکن قبلی هنوز در حال اجراست؛ لحظاتی بعد دوباره بررسی کنید.' });
    return;
  }

  scanning = true;
  try {
    const summary = await scanAll();
    const goldCount = summary.signals.filter((s) => s.symbol === 'XAUUSD').length;
    res.json({
      ok: true,
      generatedCount: summary.generated,
      goldSignalsCount: goldCount,
      dedupedCount: summary.deduped,
      skipped: summary.skipped,
      signals: summary.signals,
      message:
        summary.generated === 0
          ? `اسکن کامل شد. سیگنال جدیدی صادر نشد${summary.skipped.length ? ` (${summary.skipped[0].symbol}: ${summary.skipped[0].reason})` : ''}.`
          : goldCount > 0
          ? 'سیگنال جدید طلا صادر شد و در صف ارسال به کانال قرار گرفت.'
          : `${summary.generated} تحلیل جدید در بازار انجام شد.`,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'خطا در اسکن' });
  } finally {
    scanning = false;
  }
});
