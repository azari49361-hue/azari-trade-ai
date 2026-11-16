import { Router } from 'express';
import { rateLimit } from '../lib/rateLimit';
import { log } from '../lib/logger';
import * as repo from '../db/repo';
import { sourcesStatus, getQuotes, getDataAgeMs, getLastPollErrors } from '../engine/quotes';
import { config } from '../config';
import {
  TWELVEDATA_KEY_SETTING,
  getTwelveDataKey,
  setTwelveDataKey,
  verifyTwelveDataKey,
} from '../sources/twelvedata';

export const sourcesRouter = Router();

const limiter = rateLimit({ windowMs: 60_000, max: 6, keyPrefix: 'sources' });

/**
 * وضعیت منابع داده. کلید هیچ‌وقت برگردانده نمی‌شود — فقط این‌که از کجا آمده است.
 */
sourcesRouter.get('/sources', (_req, res) => {
  const tdKey = getTwelveDataKey();
  const dataAgeMs = getDataAgeMs();
  res.json({
    ok: true,
    ...sourcesStatus(),
    twelvedataKeySource: !tdKey ? 'none' : config.twelvedata.apiKey && tdKey === config.twelvedata.apiKey ? 'env' : 'dashboard',
    twelvedataMinIntervalSeconds: Math.round(config.twelvedata.minIntervalMs / 1000),
    /** سن آخرین قیمت موفق (Infinity → null در JSON) */
    dataAgeSeconds: Number.isFinite(dataAgeMs) ? Math.round(dataAgeMs / 1000) : null,
    pollErrors: getLastPollErrors(),
    /** هر نماد با منبعی که همان لحظه پاسخ داده — نه ادعای کلی */
    symbols: getQuotes().map((q) => ({
      symbol: q.symbol,
      nameFa: q.nameFa,
      mid: q.mid,
      spread: q.spread,
      source: q.source,
      exchange: q.exchange,
      ageSeconds: q.ageSeconds,
      quoteState: q.quoteState,
      marketState: q.marketState,
      timestamp: q.timestamp,
    })),
  });
});

/**
 * ثبت کلید TwelveData از داشبورد. کلید قبل از ذخیره با یک درخواست واقعی قیمت
 * اعتبارسنجی می‌شود؛ مقدار هرگز در پاسخ یا لاگ چاپ نمی‌شود.
 */
sourcesRouter.post('/sources/twelvedata', limiter, async (req, res) => {
  const apiKey = String(req.body?.apiKey || '').trim();
  if (!apiKey) {
    res.status(400).json({ ok: false, error: 'کلید API را وارد کنید.' });
    return;
  }
  if (apiKey.length < 10 || apiKey.length > 128) {
    res.status(400).json({ ok: false, error: 'طول کلید معتبر نیست.' });
    return;
  }

  const check = await verifyTwelveDataKey(apiKey);
  if (!check.ok) {
    log('warn', 'Sources', `کلید TwelveData رد شد: ${check.error || 'دلیل نامشخص'}`);
    res.status(400).json({ ok: false, error: `TwelveData کلید را نپذیرفت: ${check.error || 'دلیل نامشخص'}` });
    return;
  }

  await repo.setAppSetting(TWELVEDATA_KEY_SETTING, apiKey);
  setTwelveDataKey(apiKey);
  log('info', 'Sources', 'کلید TwelveData از داشبورد ذخیره و فعال شد (قیمت آزمایشی XAU/USD دریافت شد).');
  res.json({ ok: true, samplePrice: check.sample ?? null, sources: sourcesStatus() });
});

sourcesRouter.delete('/sources/twelvedata', limiter, async (_req, res) => {
  await repo.setAppSetting(TWELVEDATA_KEY_SETTING, '');
  setTwelveDataKey('');
  log('info', 'Sources', 'کلید TwelveData از داشبورد حذف شد.');
  res.json({ ok: true, sources: sourcesStatus() });
});
