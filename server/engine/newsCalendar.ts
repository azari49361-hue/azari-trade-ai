import { log } from '../lib/logger';
import * as repo from '../db/repo';

/** URL فید عمومی ForexFactory (هفتگی). */
const FEED_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const REFRESH_MS = 60 * 60 * 1000; // هر ساعت
const FETCH_TIMEOUT_MS = 10_000;

export interface NewsEvent {
  title: string;
  country: string;
  /** ISO string with offset (از فید). */
  date: string;
  impact: 'High' | 'Medium' | 'Low' | string;
}

/** کلید app_settings برای تگل داشبورد. */
export const NEWS_BLACKOUT_SETTING = 'news_blackout_enabled';

/** دقیقهٔ سکوت قبل/بعد از رویداد. */
export const NEWS_BLACKOUT_MINUTES = 30;

/** ارزهای مؤثر بر طلا (طلا به دلار قیمت‌گذاری می‌شود). */
export const GOLD_RELEVANT_CURRENCIES = ['USD'];

let cachedEvents: NewsEvent[] = [];
let lastFetchAt = 0;
let lastFetchError: string | null = null;

/** تبدیل پاسخ فید به NewsEvent[]. */
export function parseNewsEvents(raw: unknown): NewsEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: NewsEvent[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    const title = String(e.title || '').trim();
    const country = String(e.country || '').trim().toUpperCase();
    const date = String(e.date || '').trim();
    const impact = String(e.impact || '').trim();
    if (!title || !date) continue;
    out.push({ title, country, date, impact });
  }
  return out;
}

/** فیلتر رویدادهای با اهمیت بالا برای ارزهای مرتبط با طلا. */
export function filterHighImpactEvents(
  events: NewsEvent[],
  currencies: string[] = GOLD_RELEVANT_CURRENCIES,
): NewsEvent[] {
  const set = new Set(currencies.map((c) => c.toUpperCase()));
  return events.filter((e) => e.impact === 'High' && set.has(e.country));
}

/**
 * آیا الان در پنجرهٔ سکوت خبری هستیم؟
 * blackoutMinutes دقیقه قبل و بعد از هر رویداد high-impact.
 */
export function isInNewsBlackout(
  nowMs: number,
  events: NewsEvent[],
  blackoutMinutes: number = NEWS_BLACKOUT_MINUTES,
  currencies: string[] = GOLD_RELEVANT_CURRENCIES,
): { blocked: boolean; event: NewsEvent | null } {
  const relevant = filterHighImpactEvents(events, currencies);
  const windowMs = blackoutMinutes * 60 * 1000;
  for (const e of relevant) {
    const t = Date.parse(e.date);
    if (!Number.isFinite(t)) continue;
    if (Math.abs(nowMs - t) <= windowMs) {
      return { blocked: true, event: e };
    }
  }
  return { blocked: false, event: null };
}

/** رویداد high-impact بعدی (برای نمایش در داشبورد). */
export function nextHighImpactEvent(
  nowMs: number,
  events: NewsEvent[],
  currencies: string[] = GOLD_RELEVANT_CURRENCIES,
): NewsEvent | null {
  const relevant = filterHighImpactEvents(events, currencies);
  let best: NewsEvent | null = null;
  let bestTime = Infinity;
  for (const e of relevant) {
    const t = Date.parse(e.date);
    if (!Number.isFinite(t)) continue;
    if (t >= nowMs && t < bestTime) {
      bestTime = t;
      best = e;
    }
  }
  return best;
}

/** واکشی و کش کردن رویدادها. */
export async function refresh(): Promise<void> {
  const now = Date.now();
  if (now - lastFetchAt < REFRESH_MS && cachedEvents.length > 0) return;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(FEED_URL, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    cachedEvents = parseNewsEvents(raw);
    lastFetchAt = now;
    lastFetchError = null;
    log('info', 'NewsCalendar', `${cachedEvents.length} رویداد خبری بارگذاری شد (${filterHighImpactEvents(cachedEvents).length} high-impact USD).`);
  } catch (err: any) {
    lastFetchError = err?.message || 'خطای نامشخص';
    log('warn', 'NewsCalendar', `بارگذاری تقویم خبری ناموفق: ${lastFetchError}`);
  }
}

export function getEvents(): NewsEvent[] {
  return cachedEvents;
}

export function getLastFetchError(): string | null {
  return lastFetchError;
}

export function getLastFetchAt(): number {
  return lastFetchAt;
}

export interface NewsCalendarStatus {
  enabled: boolean;
  inBlackout: boolean;
  currentEvent: { title: string; date: string } | null;
  nextEvent: { title: string; date: string } | null;
  lastFetchAt: number | null;
  lastFetchError: string | null;
  eventCount: number;
  highImpactCount: number;
}

export async function isEnabled(): Promise<boolean> {
  try {
    const val = await repo.getAppSetting(NEWS_BLACKOUT_SETTING);
    // پیش‌فرض: فعال (اگر ردیفی وجود نداشته باشد)
    if (val === '') return true;
    return val === 'true' || val === '1' || val === 'yes';
  } catch {
    return true;
  }
}

export async function setEnabled(enabled: boolean): Promise<void> {
  await repo.setAppSetting(NEWS_BLACKOUT_SETTING, enabled ? 'true' : 'false');
}

export async function status(): Promise<NewsCalendarStatus> {
  const enabled = await isEnabled();
  const now = Date.now();
  const { blocked, event } = enabled
    ? isInNewsBlackout(now, cachedEvents)
    : { blocked: false, event: null };
  const next = nextHighImpactEvent(now, cachedEvents);
  return {
    enabled,
    inBlackout: blocked,
    currentEvent: event ? { title: event.title, date: event.date } : null,
    nextEvent: next ? { title: next.title, date: next.date } : null,
    lastFetchAt: lastFetchAt || null,
    lastFetchError,
    eventCount: cachedEvents.length,
    highImpactCount: filterHighImpactEvents(cachedEvents).length,
  };
}

/** شروع واکشی دوره‌ای. */
export function startNewsCalendar(): void {
  void refresh();
  setInterval(() => void refresh(), REFRESH_MS);
}
