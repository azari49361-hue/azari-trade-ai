import { Router } from 'express';
import { rateLimit } from '../lib/rateLimit';
import { config } from '../config';
import { buildMarketReport, nextSlotDelayMs, sendMarketReport } from '../engine/marketReport';

export const reportRouter = Router();

const limiter = rateLimit({ windowMs: 60_000, max: 6, keyPrefix: 'report' });

/** پیش‌نمایش متن گزارش — هیچ پیامی به کانال نمی‌فرستد. */
reportRouter.get('/report/preview', limiter, async (_req, res) => {
  try {
    const text = await buildMarketReport();
    res.json({
      ok: true,
      text,
      intervalHours: config.report.intervalHours,
      nextSendInMs: nextSlotDelayMs(Date.now(), config.report.intervalHours),
      enabled: config.report.enabled,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'ساخت گزارش ناموفق بود.' });
  }
});

/** ارسال فوری همان گزارش به کانال (برای تست یا وقتی خودتان می‌خواهید). */
reportRouter.post('/report/send', limiter, async (_req, res) => {
  const result = await sendMarketReport();
  res.status(result.ok ? 200 : 400).json({
    ok: result.ok,
    description: result.description,
    message: result.ok ? 'گزارش بازار به کانال ارسال شد.' : result.description || 'ارسال ناموفق بود.',
    text: result.text,
  });
});
