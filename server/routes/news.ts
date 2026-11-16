import { Router } from 'express';
import { rateLimit } from '../lib/rateLimit';
import * as newsCalendar from '../engine/newsCalendar';
import * as newsDigest from '../engine/newsDigest';
import * as repo from '../db/repo';
import { config } from '../config';

export const newsRouter = Router();

const limiter = rateLimit({ windowMs: 60_000, max: 20, keyPrefix: 'news' });

/**
 * composeDigest چهار فید RSS می‌گیرد و تیترها را ترجمه می‌کند؛ داشبورد همین را در
 * هر بارگذاری و هر «بازخوانی» کارت می‌خواهد. نتیجه کوتاه‌مدت کش می‌شود (مثل خلاصهٔ
 * بک‌تست) تا فیدها و سرویس ترجمه با هر رفرش دوباره صدا زده نشوند.
 * ارسال دستی از این کش نمی‌خواند و همیشه تازه می‌سازد.
 */
const DIGEST_CACHE_TTL_MS = 10 * 60_000;
/** فقط متن و شمارنده‌ها کش می‌شوند؛ sentToday/nextSendAt همیشه زنده محاسبه می‌شوند. */
interface DigestSnapshot {
  text: string;
  eventCount: number;
  headlineCount: number;
}
let digestCache: { at: number; value: DigestSnapshot } | null = null;
let digestInFlight: Promise<DigestSnapshot> | null = null;
/**
 * نسخهٔ کش: ارسال دستی آن را جلو می‌برد، تا composeای که قبل از ارسال شروع شده
 * نتواند نتیجهٔ قدیمی را روی خلاصهٔ ارسال‌شده بنویسد.
 */
let digestVersion = 0;

/** کش با اشتراک درخواست‌های هم‌زمان: دو تب باز هم یک بار fetch می‌بینند. */
function cachedDigest(): Promise<DigestSnapshot> {
  if (digestCache && Date.now() - digestCache.at < DIGEST_CACHE_TTL_MS) {
    return Promise.resolve(digestCache.value);
  }
  if (digestInFlight) return digestInFlight;
  const version = digestVersion;
  digestInFlight = newsDigest
    .composeDigest()
    .then((value) => {
      const snap: DigestSnapshot = {
        text: value.text,
        eventCount: value.events.length,
        headlineCount: value.headlines.length,
      };
      // فقط اگر در این فاصله ارسال دستی کش را جلو نبرده باشد.
      if (version === digestVersion) digestCache = { at: Date.now(), value: snap };
      return snap;
    })
    .finally(() => {
      digestInFlight = null;
    });
  return digestInFlight;
}

/** وضعیت تقویم خبری + وضعیت تگل. */
newsRouter.get('/news-blackout', async (_req, res) => {
  try {
    const st = await newsCalendar.status();
    res.json({ ok: true, ...st });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'خطا' });
  }
});

/** فعال/غیرفعال کردن سکوت خبری. */
newsRouter.post('/news-blackout', limiter, async (req, res) => {
  const enabled = Boolean(req.body?.enabled);
  try {
    await newsCalendar.setEnabled(enabled);
    const st = await newsCalendar.status();
    res.json({ ok: true, ...st });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'خطا' });
  }
});

/** وضعیت خبر روزانه: پیش‌نمایش متن + زمان ارسال بعدی + آخرین ارسال. */
newsRouter.get('/news-digest/status', async (_req, res) => {
  try {
    const digest = await cachedDigest();
    const lastSent = await repo.getAppSetting(newsDigest.NEWS_DIGEST_LAST_SENT_KEY).catch(() => '');
    const today = newsDigest.tehranDayKey(Date.now());
    const hour = config.newsDigest.hourTehran;
    const nextSendInMs = newsDigest.msUntilNextHour(Date.now(), hour);
    res.json({
      ok: true,
      enabled: config.newsDigest.enabled,
      text: digest.text,
      eventCount: digest.eventCount,
      headlineCount: digest.headlineCount,
      lastSentDay: lastSent || null,
      sentToday: lastSent === today,
      hourTehran: hour,
      nextSendInMs,
      nextSendAt: Date.now() + nextSendInMs,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'خطا' });
  }
});

/** پیش‌نمایش متن خلاصهٔ خبر روزانه، بدون ارسال. */
newsRouter.get('/news-digest/preview', async (_req, res) => {
  try {
    const { text, events, headlines } = await newsDigest.composeDigest();
    res.json({ ok: true, text, eventCount: events.length, headlineCount: headlines.length });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'خطا' });
  }
});

/** ارسال دستی خلاصهٔ خبر به کانال. */
newsRouter.post('/news-digest/send', limiter, async (_req, res) => {
  try {
    const result = await newsDigest.sendNewsDigest();
    if (result.ok) {
      digestVersion += 1;
      digestCache = {
        at: Date.now(),
        value: { text: result.text, eventCount: result.eventCount, headlineCount: result.headlineCount },
      };
    }
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'خطا' });
  }
});

/** واکشی دستی تقویم (برای داشبورد). */
newsRouter.post('/news-blackout/refresh', limiter, async (_req, res) => {
  try {
    await newsCalendar.refresh();
    const st = await newsCalendar.status();
    res.json({ ok: true, ...st });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'خطا' });
  }
});
