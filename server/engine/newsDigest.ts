import { config } from '../config';
import { log } from '../lib/logger';
import { formatPersianDateTime } from '../lib/time';
import * as repo from '../db/repo';
import * as telegram from '../telegram/client';
import { refresh, getEvents, type NewsEvent } from './newsCalendar';
import { translateToPersian } from './translate';
import { TEHRAN_OFFSET_MIN } from './marketReport';

/**
 * خلاصهٔ روزانهٔ خبرهای مهم بازار برای کانال تلگرام.
 *
 * دو بخش دارد:
 *  ۱) رویدادهای تقویم اقتصادی امروز (high-impact همهٔ ارزها + medium دلار)
 *  ۲) تیترهای خبری منابع مالی که به طلا/دلار/نرخ بهره مربوط‌اند
 *
 * هیچ خبری ساخته نمی‌شود: هر آیتم مستقیماً از فید منبع می‌آید و منبعش کنارش نوشته می‌شود.
 */

export interface NewsHeadline {
  title: string;
  link: string;
  source: string;
  /** میلی‌ثانیه؛ null اگر فید تاریخ نداشت. */
  publishedAt: number | null;
}

export interface NewsFeed {
  name: string;
  url: string;
}

/** فیدهای بدون کلید که مستقیم به بازار/اقتصاد اختصاص دارند. */
export const NEWS_FEEDS: readonly NewsFeed[] = [
  { name: 'Investing — Forex', url: 'https://www.investing.com/rss/news_1.rss' },
  { name: 'CNBC — Economy', url: 'https://www.cnbc.com/id/10000664/device/rss/rss.html' },
  { name: 'WSJ — Markets', url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml' },
  { name: 'BBC — Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml' },
];

const FETCH_TIMEOUT_MS = 12_000;
/** سقف تیتر در هر پیام — بیشتر از این، کسی نمی‌خواند. */
export const MAX_HEADLINES = 8;

/** کلید app_settings برای جلوگیری از ارسال دوباره در یک روز. */
export const NEWS_DIGEST_LAST_SENT_KEY = 'news_digest_last_sent';

/** کلید app_settings برای فهرست تیترهای ارسال‌شدهٔ اخیر (JSON). */
export const NEWS_DIGEST_SENT_TITLES_KEY = 'news_digest_sent_titles';

/** چند روز تیترهای ارسال‌شده از دوباره‌فرستادن کنار گذاشته می‌شوند. */
export const NEWS_DIGEST_DEDUP_DAYS = 7;

/** کلماتی که یک تیتر را «مربوط به ترید» می‌کنند. */
export const TRADING_KEYWORDS: readonly string[] = [
  'gold', 'silver', 'bullion', 'dollar', 'euro', 'yen', 'pound', 'yuan', 'currency', 'forex',
  'fed', 'federal reserve', 'ecb', 'boj', 'central bank', 'powell', 'lagarde',
  'rate hike', 'rate cut', 'interest rate', 'inflation', 'cpi', 'ppi', 'deflation',
  'jobs', 'payroll', 'unemployment', 'gdp', 'recession', 'growth', 'economy',
  'treasury', 'yield', 'bond', 'debt', 'deficit', 'stimulus',
  'tariff', 'sanction', 'trade war', 'trade deal', 'opec', 'oil', 'energy',
  'stocks', 's&p', 'nasdaq', 'dow', 'equities', 'selloff', 'rally', 'volatility',
  'election', 'congress', 'senate', 'white house', 'shutdown', 'policy',
  'war', 'conflict', 'attack', 'missile', 'invasion', 'ceasefire', 'geopolit',
  'safe haven', 'risk', 'china', 'middle east', 'ukraine', 'israel', 'iran',
];

const decodeEntities = (s: string): string =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** استخراج آیتم‌ها از یک فید RSS. */
export function parseRssItems(xml: string, source: string): NewsHeadline[] {
  const items = xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) ?? [];
  const out: NewsHeadline[] = [];
  for (const raw of items) {
    const title = decodeEntities(/<title>([\s\S]*?)<\/title>/i.exec(raw)?.[1] ?? '');
    if (!title) continue;
    const link = decodeEntities(/<link>([\s\S]*?)<\/link>/i.exec(raw)?.[1] ?? '');
    const publishedRaw = /<pubDate>([\s\S]*?)<\/pubDate>/i.exec(raw)?.[1] ?? '';
    const published = Date.parse(publishedRaw.trim());
    out.push({ title, link, source, publishedAt: Number.isFinite(published) ? published : null });
  }
  return out;
}

/**
 * کلمات کلیدی با مرز واژه سنجیده می‌شوند؛ وگرنه «war» داخل «award» هم می‌گیرد.
 */
const KEYWORD_RE = new RegExp(
  `\\b(?:${TRADING_KEYWORDS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
  'i'
);
const KEYWORD_RE_ALL = new RegExp(KEYWORD_RE.source, 'gi');

/** آیا این تیتر به کار معامله‌گر مربوط است؟ */
export function isTradingRelevant(title: string): boolean {
  return KEYWORD_RE.test(title);
}

/** تعداد کلمات کلیدی متمایز در تیتر — مبنای رتبه‌بندی. */
function keywordScore(title: string): number {
  return new Set((title.match(KEYWORD_RE_ALL) ?? []).map((m) => m.toLowerCase())).size;
}

const normalizeTitle = (title: string): string => title.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ').trim();

/**
 * انتخاب تیترهای نهایی: تکراری‌ها حذف، فقط موضوعات مرتبط،
 * اولویت به تیتری که کلمات کلیدی بیشتری دارد و سپس به تازه‌ترین.
 */
export function pickHeadlines(all: NewsHeadline[], limit = MAX_HEADLINES, exclude?: ReadonlySet<string>): NewsHeadline[] {
  const seen = new Set<string>();
  const scored: { headline: NewsHeadline; score: number }[] = [];

  for (const h of all) {
    if (!isTradingRelevant(h.title)) continue;
    const key = normalizeTitle(h.title);
    if (!key || seen.has(key)) continue;
    if (exclude?.has(key)) continue;
    seen.add(key);
    scored.push({ headline: h, score: keywordScore(h.title) });
  }

  scored.sort((a, b) => b.score - a.score || (b.headline.publishedAt ?? 0) - (a.headline.publishedAt ?? 0));
  return scored.slice(0, limit).map((s) => s.headline);
}

/** رویدادهای امروز (به وقت تهران): high-impact همهٔ ارزها، medium فقط دلار. */
export function eventsForDigest(events: NewsEvent[], now: Date): NewsEvent[] {
  const today = tehranDayKey(now.getTime());
  return events
    .filter((e) => {
      const t = Date.parse(e.date);
      if (!Number.isFinite(t)) return false;
      if (tehranDayKey(t) !== today) return false;
      if (e.impact === 'High') return true;
      return e.impact === 'Medium' && e.country.toUpperCase() === 'USD';
    })
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

export interface DigestInput {
  now: Date;
  events: NewsEvent[];
  headlines: NewsHeadline[];
  channelUrl: string;
  /** ترجمهٔ فارسی آمادهٔ تیترها (کلید = متن انگلیسی). نبودش یعنی فقط انگلیسی. */
  fa?: ReadonlyMap<string, string>;
}

const faDate = (d: Date): string => formatPersianDateTime(d, 'Asia/Tehran').jalaliDate || tehranDayKey(d.getTime());

const eventTime = (iso: string): string => {
  const t = formatPersianDateTime(iso, 'Asia/Tehran').time24;
  return t ? t.slice(0, 5) : '--:--';
};

/** ساخت متن پیام. رشتهٔ خالی یعنی چیزی برای فرستادن نیست. */
export function buildDigestText({ now, events, headlines, channelUrl, fa }: DigestInput): string {
  if (events.length === 0 && headlines.length === 0) return '';

  const faOf = (en: string): string | undefined => fa?.get(en);
  const lines: string[] = [];
  lines.push(`📰 خبرهای مهم بازار — ${faDate(now)}`);
  lines.push('━━━━━━━━━━━━━━━━━━━━━━');

  if (events.length > 0) {
    lines.push('📅 رویدادهای امروز (به وقت تهران)');
    for (const e of events) {
      const mark = e.impact === 'High' ? '🔴' : '🟡';
      // عنوان رویداد همان اصطلاح استاندارد تقویم (CPI، NFP) می‌ماند؛
      // ترجمهٔ ماشینی این اصطلاح‌ها را نیمه‌فارسی و گمراه‌کننده می‌کند.
      lines.push(`${mark} ${eventTime(e.date)} · ${e.country} · ${e.title}`);
    }
    lines.push('   ⚠️ در ۳۰ دقیقهٔ قبل و بعد رویدادهای 🔴 سیگنال جدید صادر نمی‌شود.');
    lines.push('');
  }

  if (headlines.length > 0) {
    lines.push('📢 تیترهای مهم');
    for (const h of headlines) {
      const persian = faOf(h.title);
      lines.push(`• ${persian ?? h.title} — ${h.source}`);
      if (persian) lines.push(`   ↳ ${h.title}`);
    }
    lines.push('');
  }

  lines.push('━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(`🔗 ${channelUrl}`);
  return lines.join('\n');
}

/** فاصله تا ساعت مشخصی از روز به وقت تهران. */
export function msUntilNextHour(nowMs: number, hourTehran: number, offsetMin = TEHRAN_OFFSET_MIN): number {
  const dayMs = 24 * 3_600_000;
  const local = nowMs + offsetMin * 60_000;
  const target = Math.floor(local / dayMs) * dayMs + Math.min(23, Math.max(0, hourTehran)) * 3_600_000;
  return target > local ? target - local : target + dayMs - local;
}

/** کلید روز به وقت تهران — برای ارسال حداکثر یک‌بار در روز. */
export function tehranDayKey(nowMs: number, offsetMin = TEHRAN_OFFSET_MIN): string {
  return new Date(nowMs + offsetMin * 60_000).toISOString().slice(0, 10);
}

/** آیا ساعت مقرر امروز (به وقت تهران) گذشته است؟ مبنای ارسال جبرانی بعد از ری‌استارت. */
export function tehranHourReached(nowMs: number, hourTehran: number, offsetMin = TEHRAN_OFFSET_MIN): boolean {
  return new Date(nowMs + offsetMin * 60_000).getUTCHours() >= Math.min(23, Math.max(0, hourTehran));
}

async function fetchFeed(feed: NewsFeed): Promise<NewsHeadline[]> {
  try {
    const res = await fetch(feed.url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AzariTradeAI/2.0)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseRssItems(await res.text(), feed.name);
  } catch (err: any) {
    log('warn', 'NewsDigest', `فید ${feed.name} نیامد: ${err?.message || err}`);
    return [];
  }
}

/** همهٔ تیترها از همهٔ فیدها (هر فید جدا شکست می‌خورد، کل خلاصه نه). */
async function fetchHeadlines(): Promise<NewsHeadline[]> {
  const results = await Promise.all(NEWS_FEEDS.map((f) => fetchFeed(f)));
  return results.flat();
}

export interface DigestSendResult {
  ok: boolean;
  description?: string;
  text: string;
  headlineCount: number;
  eventCount: number;
}

const SENT_TITLES_RETENTION_MS = NEWS_DIGEST_DEDUP_DAYS * 24 * 3_600_000;

async function readSentTitles(retentionMs = SENT_TITLES_RETENTION_MS): Promise<Record<string, number>> {
  try {
    const raw = await repo.getAppSetting(NEWS_DIGEST_SENT_TITLES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { titles?: Record<string, number> } | Record<string, number>;
    const titles =
      parsed && typeof parsed === 'object' && 'titles' in parsed && typeof (parsed as { titles?: unknown }).titles === 'object'
        ? ((parsed as { titles: Record<string, number> }).titles ?? {})
        : (parsed as Record<string, number>);
    if (!titles || typeof titles !== 'object') return {};
    const cutoff = Date.now() - retentionMs;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(titles)) {
      if (typeof v === 'number' && v >= cutoff) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

async function writeSentTitles(titles: Record<string, number>): Promise<void> {
  try {
    const cutoff = Date.now() - SENT_TITLES_RETENTION_MS;
    const pruned: Record<string, number> = {};
    for (const [k, v] of Object.entries(titles)) {
      if (typeof v === 'number' && v >= cutoff) pruned[k] = v;
    }
    await repo.setAppSetting(NEWS_DIGEST_SENT_TITLES_KEY, JSON.stringify({ titles: pruned }));
  } catch (e: any) {
    log('warn', 'NewsDigest', `ذخیرهٔ تیترهای ارسال‌شده ناموفق: ${e?.message || e}`);
  }
}

/** تیترهایی که در چند روز گذشته به کانال رفته‌اند (برای کنارگذاشتن تکرار). */
export async function getSentHeadlineKeys(retentionDays = NEWS_DIGEST_DEDUP_DAYS): Promise<Set<string>> {
  const store = await readSentTitles(retentionDays * 24 * 3_600_000);
  return new Set(Object.keys(store));
}

/** ثبت تیترهایی که همین الان ارسال شدند تا در روزهای بعد تکرار نشوند. */
export async function recordSentHeadlineKeys(titles: string[]): Promise<void> {
  if (titles.length === 0) return;
  const store = await readSentTitles();
  const now = Date.now();
  for (const t of titles) store[t] = now;
  await writeSentTitles(store);
}

/**
 * آماده‌سازی متن خلاصه (بدون ارسال): رویدادهای امروز + تیترها + ترجمهٔ فارسی.
 * پیش‌نمایش و ارسال هر دو از همین مسیر می‌گذرند تا خروجی‌شان یکی باشد.
 * تیترهایی که در چند روز گذشته ارسال شده‌اند کنار گذاشته می‌شوند؛ اگر همهٔ تیترها
 * تکراری بودند، بهترین‌های موجود فرستاده می‌شوند تا روزی خالی نماند.
 */
export async function composeDigest(
  now: Date = new Date()
): Promise<{ text: string; events: NewsEvent[]; headlines: NewsHeadline[] }> {
  await refresh();
  const events = eventsForDigest(getEvents(), now);
  const all = await fetchHeadlines();
  // readSentTitles خودش هر خطایی را می‌گیرد و {} برمی‌گرداند؛ نیازی به catch دوباره نیست.
  const sentKeys = await getSentHeadlineKeys();
  let headlines = pickHeadlines(all, MAX_HEADLINES, sentKeys);
  if (headlines.length === 0) headlines = pickHeadlines(all, MAX_HEADLINES);
  // فقط تیترهای خبری ترجمه می‌شوند؛ عنوان رویدادهای تقویم اصطلاح استاندارد است و انگلیسی می‌ماند.
  const fa = await translateToPersian(headlines.map((h) => h.title));
  const text = buildDigestText({ now, events, headlines, channelUrl: config.newsDigest.channelUrl, fa });
  return { text, events, headlines };
}

/** ساخت و ارسال خلاصهٔ خبر به کانال. */
export async function sendNewsDigest(now: Date = new Date()): Promise<DigestSendResult> {
  const { text, events, headlines } = await composeDigest(now);

  if (!text) {
    log('warn', 'NewsDigest', 'هیچ خبر مرتبطی برای ارسال پیدا نشد.');
    return { ok: false, description: 'خبر مرتبطی پیدا نشد.', text: '', headlineCount: 0, eventCount: 0 };
  }
  if (!telegram.isConnected()) {
    return { ok: false, description: 'تلگرام تنظیم نشده است.', text, headlineCount: headlines.length, eventCount: events.length };
  }

  const res = await telegram.sendRawToChannel(text);
  if (res.ok) {
    await repo.setAppSetting(NEWS_DIGEST_LAST_SENT_KEY, tehranDayKey(now.getTime())).catch(() => undefined);
    await recordSentHeadlineKeys(headlines.map((h) => normalizeTitle(h.title))).catch(() => undefined);
    log('info', 'NewsDigest', `خلاصهٔ خبر ارسال شد (${headlines.length} تیتر، ${events.length} رویداد).`);
  } else {
    log('error', 'NewsDigest', `ارسال خلاصهٔ خبر ناموفق: ${res.description}`);
  }
  return {
    ok: res.ok,
    description: res.description,
    text,
    headlineCount: headlines.length,
    eventCount: events.length,
  };
}

let timer: NodeJS.Timeout | null = null;

/** یک نوبت ارسال، با گارد «حداکثر یک‌بار در روز» از روی کلید ذخیره‌شده. */
async function runDailySend(): Promise<void> {
  try {
    const day = tehranDayKey(Date.now());
    const lastSent = await repo.getAppSetting(NEWS_DIGEST_LAST_SENT_KEY).catch(() => '');
    if (lastSent === day) {
      log('info', 'NewsDigest', 'خلاصهٔ امروز قبلاً ارسال شده؛ رد شد.');
    } else {
      await sendNewsDigest();
    }
  } catch (e: any) {
    log('error', 'NewsDigest', `ارسال خلاصهٔ خبر شکست خورد: ${e?.message}`);
  }
}

/** زمان‌بندی روزانه؛ یک‌بار در روز به وقت تهران. */
export function startNewsDigest(): void {
  if (!config.newsDigest.enabled) {
    log('info', 'NewsDigest', 'خلاصهٔ خبر روزانه غیرفعال است (NEWS_DIGEST_ENABLED=false).');
    return;
  }
  const hour = config.newsDigest.hourTehran;

  const schedule = () => {
    const delay = msUntilNextHour(Date.now(), hour);
    log('info', 'NewsDigest', `خلاصهٔ خبر بعدی ${Math.round(delay / 60_000)} دقیقه دیگر (ساعت ${hour} تهران).`);
    timer = setTimeout(async () => {
      await runDailySend();
      schedule();
    }, delay);
    timer.unref?.();
  };

  // ری‌استارتی که بعد از ساعت مقرر رخ می‌دهد نباید روز را بی‌خبر رها کند:
  // اگر امروز هنوز چیزی نرفته، همان‌جا یک‌بار ارسال جبرانی انجام می‌شود (گارد روز داخلش هست).
  void (async () => {
    if (tehranHourReached(Date.now(), hour)) {
      const day = tehranDayKey(Date.now());
      const lastSent = await repo.getAppSetting(NEWS_DIGEST_LAST_SENT_KEY).catch(() => '');
      if (lastSent !== day) {
        log('info', 'NewsDigest', 'امروز هنوز ارسال نشده؛ ارسال جبرانی همین حالا انجام می‌شود.');
        await runDailySend();
      }
    }
    schedule();
  })();
}

/** فقط برای تست/خاموشی. */
export function stopNewsDigest(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}
