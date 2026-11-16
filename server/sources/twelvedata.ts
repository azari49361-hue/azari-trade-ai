import type { SymbolCode } from '../config';
import type { Bar } from '../lib/indicators';
import type { QuoteSource, SourceBatch, SourceQuote } from './types';
import { toNum } from './types';
import { config } from '../config';

/**
 * Twelve Data — paid/keyed fallback source.
 * NOTE: the /price endpoint returns a single price only. We expose it as mid with
 * spread/high/low = null (UNKNOWN, not fabricated).
 * The /time_series endpoint is used for OHLC bars.
 */

const TD_SYMBOLS: Record<SymbolCode, string> = {
  XAUUSD: 'XAU/USD',
  XAGUSD: 'XAG/USD',
  USOIL: 'WTI/USD',
  DXY: 'DXY',
};

let lastCallAt = 0;

/**
 * با timezone=UTC، TwelveData زمان را بدون پسوند می‌دهد ("2026-11-16 04:00:00")؛
 * به ISO با Z تبدیل می‌شود تا روی هر سروری یک معنا داشته باشد.
 */
function tdTimestamp(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00Z`;
  return s.includes('T') ? s : `${s.replace(' ', 'T')}Z`;
}

/**
 * کلید قابل‌تنطیم از داشبورد (در جدول app_settings). بر مقدار .env اولویت دارد
 * تا تغییر کلید نیاز به ویرایش فایل و ری‌استارت نداشته باشد.
 */
let dashboardKey = '';
export const TWELVEDATA_KEY_SETTING = 'twelvedata_api_key';

export function setTwelveDataKey(key: string): void {
  dashboardKey = key.trim();
}

export function getTwelveDataKey(): string {
  return dashboardKey || config.twelvedata.apiKey;
}

/** اعتبارسنجی کلید قبل از ذخیره: یک درخواست واقعی قیمت طلا. */
export async function verifyTwelveDataKey(
  key: string
): Promise<{ ok: boolean; error?: string; sample?: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(
      `https://api.twelvedata.com/price?symbol=${encodeURIComponent('XAU/USD')}&apikey=${encodeURIComponent(key)}`,
      { signal: controller.signal }
    );
    const data = (await res.json().catch(() => ({}))) as { price?: string; status?: string; message?: string; code?: number };
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    if (data.status === 'error' || data.price === undefined) {
      return { ok: false, error: data.message || 'کلید رد شد (پاسخ بدون قیمت).' };
    }
    const price = toNum(data.price);
    if (price === null) return { ok: false, error: data.message || 'پاسخ بدون قیمت معتبر.' };
    return { ok: true, sample: price };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'خطای شبکه در تماس با TwelveData' };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Free Twelve Data keys allow ~8 requests/minute. With a 4-symbol poll every 5s that limit is
 * blown instantly, so quotes are only requested once per `minIntervalMs`; between calls the
 * source returns nothing and the next source (biquote/MetaApi) covers the symbol. No cached price
 * is ever re-labelled as fresh — that would fake data freshness.
 */
export function shouldQueryTwelveData(now: number, lastAt: number, minIntervalMs: number): boolean {
  if (minIntervalMs <= 0) return true;
  if (lastAt === 0) return true;
  return now - lastAt >= minIntervalMs;
}

export const twelvedataSource: QuoteSource = {
  id: 'twelvedata',
  label: 'Twelve Data',

  isConfigured(): boolean {
    return Boolean(getTwelveDataKey());
  },

  async fetchLatest(symbols: readonly SymbolCode[]): Promise<SourceBatch> {
    const errors: string[] = [];
    const quotes: Partial<Record<SymbolCode, SourceQuote>> = {};
    if (!getTwelveDataKey()) return { sourceId: 'twelvedata', sourceLabel: 'Twelve Data', quotes, errors };

    // Credit guard (free plan): skip this round quietly, the next source fills the gaps.
    if (!shouldQueryTwelveData(Date.now(), lastCallAt, config.twelvedata.minIntervalMs)) {
      return { sourceId: 'twelvedata', sourceLabel: 'Twelve Data', quotes, errors };
    }
    lastCallAt = Date.now();

    for (const sym of symbols) {
      const tdSymbol = TD_SYMBOLS[sym];
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(
          `https://api.twelvedata.com/price?symbol=${encodeURIComponent(tdSymbol)}&apikey=${getTwelveDataKey()}`,
          { signal: controller.signal }
        );
        if (!res.ok) {
          errors.push(`TwelveData ${sym}: HTTP ${res.status}`);
          continue;
        }
        const data = (await res.json()) as { price?: string; status?: string; message?: string };
        const price = toNum(data.price);
        if (price === null) {
          errors.push(`TwelveData ${sym}: ${data.message || 'no price'}`);
          continue;
        }
        quotes[sym] = {
          bid: price,
          ask: price,
          mid: price,
          spread: null, // unknown — never fabricated
          high: null,
          low: null,
          direction: null,
          dayDiffPercent: null,
          timestamp: new Date().toISOString(),
          marketState: 'unknown',
          exchange: tdSymbol,
          sourceLabel: `Twelve Data · ${tdSymbol}`,
        };
      } catch (err: any) {
        errors.push(`TwelveData ${sym}: ${err?.message || err}`);
      } finally {
        clearTimeout(timeout);
      }
    }
    return { sourceId: 'twelvedata', sourceLabel: 'Twelve Data', quotes, errors };
  },

  /**
   * `endDate` (اختیاری) آخرین کندل صفحه است — برای پیمایش به عقب در تاریخچه.
   * زمان‌ها با timezone=UTC درخواست می‌شوند تا با بقیهٔ منابع هم‌مبدأ باشند.
   */
  async fetchOhlc(symbol: SymbolCode, interval: string, limit: number, endDate?: string): Promise<Bar[] | null> {
    if (!getTwelveDataKey()) return null;
    // Twelve Data interval format: 15min, 60min, 4h, 1day
    const map: Record<string, string> = { '1m': '1min', '5m': '5min', '15m': '15min', '1h': '60min', '4h': '4h', '1d': '1day' };
    const tdInterval = map[interval] || interval;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    try {
      const res = await fetch(
        `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(TD_SYMBOLS[symbol])}` +
          `&interval=${tdInterval}&outputsize=${limit}&timezone=UTC` +
          (endDate ? `&end_date=${encodeURIComponent(endDate)}` : '') +
          `&apikey=${getTwelveDataKey()}`,
        { signal: controller.signal }
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { values?: any[]; status?: string; message?: string };
      if (!Array.isArray(data.values)) return null;
      // Twelve Data returns newest-first; convert to chronological
      return data.values
        .map((v) => ({
          openTime: tdTimestamp(v.datetime),
          open: toNum(v.open) ?? 0,
          high: toNum(v.high) ?? 0,
          low: toNum(v.low) ?? 0,
          close: toNum(v.close) ?? 0,
          volume: toNum(v.volume),
          isOpen: false, // TD does not mark forming bars; the closed-bar filter uses time windows
        }))
        .filter((b) => b.openTime && b.close > 0)
        .reverse();
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  },
};
