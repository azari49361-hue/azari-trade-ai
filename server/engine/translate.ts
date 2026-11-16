import { log } from '../lib/logger';

/**
 * ترجمهٔ انگلیسی → فارسی با نقطهٔ پایانی عمومی Google Translate (بدون کلید).
 *
 * چرا بدون کلید: حجم ترجمه روزانه چند تیتر کوتاه است (~۱ هزار کاراکتر) و سیاست
 * پروژه این است که هیچ secret هاردکد یا پیش‌فرضی نداشته باشد. اگر روزی کیفیت
 * تضمینی لازم شد، فقط همین ماژول با DeepL/LLM عوض می‌شود؛ بقیهٔ کد دست نمی‌خورد.
 *
 * قرارداد مهم: این ماژول هرگز خطا پرتاب نمی‌کند. اگر ترجمه نیامد، متن انگلیسی
 * می‌ماند تا پیام به‌خاطر یک سرویس بیرونی از دست نرود.
 */

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
const TIMEOUT_MS = 8_000;
/** سقف کش درون‌حافظه — پیش‌نمایش‌های پیاپی یک تیتر را دوباره ترجمه نمی‌کنند. */
const CACHE_LIMIT = 500;

const cache = new Map<string, string>();

/** پاسخ گوگل آرایه‌ای تو در توست: [[["ترجمه", "متن اصلی", ...], ...], ...] */
export function parseTranslation(payload: unknown): string | null {
  if (!Array.isArray(payload) || !Array.isArray(payload[0])) return null;
  const parts: string[] = [];
  for (const chunk of payload[0]) {
    if (Array.isArray(chunk) && typeof chunk[0] === 'string') parts.push(chunk[0]);
  }
  const text = parts.join('').trim();
  return text || null;
}

async function translateOne(text: string): Promise<string | null> {
  const cached = cache.get(text);
  if (cached) return cached;

  try {
    const url = `${ENDPOINT}?client=gtx&sl=en&tl=fa&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AzariTradeAI/2.0)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const fa = parseTranslation(await res.json());
    if (!fa) return null;

    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(text, fa);
    return fa;
  } catch (err: any) {
    log('warn', 'Translate', `ترجمه ناموفق بود: ${err?.message || err}`);
    return null;
  }
}

/**
 * ترجمهٔ گروهی؛ کلید = متن انگلیسی، مقدار = فارسی.
 * متن‌هایی که ترجمه نشدند در خروجی نیستند و فراخواننده به انگلیسی برمی‌گردد.
 */
export async function translateToPersian(texts: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(texts.map((t) => t.trim()).filter(Boolean))];
  const translated = await Promise.all(unique.map(async (en) => [en, await translateOne(en)] as const));

  const out = new Map<string, string>();
  for (const [en, fa] of translated) if (fa) out.set(en, fa);
  return out;
}
