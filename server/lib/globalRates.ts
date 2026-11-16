/**
 * نرخ مرجع بازار جهانی (بدون کلید).
 *
 * منبع: Frankfurter — نرخ‌های مرجع روزانهٔ بانک مرکزی اروپا (ECB).
 * این نرخ‌ها روزانه به‌روز می‌شوند و برای «مقایسه با بازار جهانی» در گزارش
 * دوره‌ای استفاده می‌شوند؛ نه برای سیگنال (سیگنال فقط از فید بروکر می‌آید).
 */

export interface GlobalRates {
  base: string;
  date: string;
  rates: Record<string, number>;
}

const CACHE_MS = 30 * 60_000;
let cache: { at: number; data: GlobalRates | null } = { at: 0, data: null };

const FRANKFURTER_URL =
  'https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR,GBP,JPY,CHF,AUD,CAD';

export async function fetchGlobalRates(): Promise<GlobalRates | null> {
  if (cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;
  try {
    const res = await fetch(FRANKFURTER_URL, {
      signal: AbortSignal.timeout(6000),
      headers: { 'User-Agent': 'AzariTradeAI/2.0' },
    });
    if (!res.ok) return cache.data;
    const data = (await res.json()) as { base?: string; date?: string; rates?: Record<string, unknown> };
    const rates: Record<string, number> = {};
    for (const [k, v] of Object.entries(data.rates || {})) {
      const n = typeof v === 'number' ? v : parseFloat(String(v));
      if (Number.isFinite(n) && n > 0) rates[k] = n;
    }
    if (Object.keys(rates).length === 0) return cache.data;
    const parsed: GlobalRates = { base: data.base || 'USD', date: data.date || '', rates };
    cache = { at: Date.now(), data: parsed };
    return parsed;
  } catch {
    // شبکه قطع است: آخرین دادهٔ موفق را نگه می‌داریم (با تاریخ خودش) — داده جعلی ساخته نمی‌شود.
    return cache.data;
  }
}

/** فقط برای تست. */
export function resetGlobalRatesCache(): void {
  cache = { at: 0, data: null };
}
