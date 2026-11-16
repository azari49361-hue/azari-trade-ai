import { Router } from 'express';
import { rateLimit } from '../lib/rateLimit';
import { log } from '../lib/logger';
import { isWebSearchConfigured, searchWeb } from '../lib/webSearch';

export const searchRouter = Router();

const limiter = rateLimit({ windowMs: 60_000, max: 6, keyPrefix: 'search' });

/**
 * جستجوی وب با Exa. کلید از EXA_API_KEY خوانده می‌شود و هرگز در پاسخ نمی‌آید.
 * نمونه: GET /api/web-search?q=gold+price+outlook&limit=5
 */
searchRouter.get('/web-search', limiter, async (req, res) => {
  if (!isWebSearchConfigured()) {
    res.status(503).json({
      ok: false,
      error: 'EXA_API_KEY تنظیم نشده است. کلید را در .env بگذارید یا از متغیر محیطی سرور بدهید.',
    });
    return;
  }

  const query = String(req.query.q || '').trim();
  if (!query) {
    res.status(400).json({ ok: false, error: 'پارامتر q (عبارت جستجو) الزامی است.' });
    return;
  }
  if (query.length > 400) {
    res.status(400).json({ ok: false, error: 'عبارت جستجو بیش از حد طولانی است (حداکثر ۴۰۰ نویسه).' });
    return;
  }

  const rawLimit = parseInt(String(req.query.limit ?? ''), 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(10, Math.max(1, rawLimit)) : 5;

  try {
    const results = await searchWeb(query, { limit });
    res.json({ ok: true, query, count: results.length, results });
  } catch (err: any) {
    log('warn', 'WebSearch', `جستجوی Exa ناموفق بود: ${err?.message || err}`);
    res.status(502).json({ ok: false, error: err?.message || 'جستجوی وب ناموفق بود.' });
  }
});
