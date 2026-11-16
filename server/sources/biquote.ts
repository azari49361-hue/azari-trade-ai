import type { SymbolCode } from '../config';
import type { Bar } from '../lib/indicators';
import type { QuoteSource, SourceBatch, SourceQuote } from './types';
import { toNum } from './types';
import { config } from '../config';

/**
 * biquote.io — free public relay of broker (MT5) quotes.
 * Verified working: returns bid/ask/mid/spread/high/low, marketState and staleness flags.
 * Used as the last fallback so the dashboard keeps working without any API key.
 */

const BASE = 'https://biquote.io/api';

/** یک قیمت خام برای هر نماد دلخواه (گزارش دوره‌ای از این استفاده می‌کند). */
export interface AnyQuote {
  mid: number;
  spread: number | null;
  source: string;
  marketState: string;
  timestamp: string | null;
  stale: boolean;
  dayDiffPercent: number | null;
}

/**
 * همان اندپوینت latest، ولی برای هر لیستی از نمادها (نه فقط چهار نماد موتور).
 * گزارش دوره‌ای ۱۰ ارز مهم را از همین فید MT5 می‌خواند.
 */
export async function fetchAnyLatest(
  symbols: readonly string[]
): Promise<{ quotes: Record<string, AnyQuote>; errors: string[] }> {
  const errors: string[] = [];
  const quotes: Record<string, AnyQuote> = {};
  const params = symbols.map((s) => `symbols=${encodeURIComponent(s)}`).join('&');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${BASE}/latest?${params}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'AzariTradeAI/2.0' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as Record<string, any>;

    for (const sym of symbols) {
      const item = data[sym];
      if (!item) continue;
      const bid = toNum(item.bid);
      const ask = toNum(item.ask);
      const mid = toNum(item.mid) ?? (bid !== null && ask !== null ? (bid + ask) / 2 : bid ?? ask ?? 0);
      if (!mid) continue;
      quotes[sym] = {
        mid,
        spread: toNum(item.spread) ?? (bid !== null && ask !== null ? ask - bid : null),
        source: typeof item.source === 'string' && item.source ? item.source : 'biquote.io',
        marketState: typeof item.marketState === 'string' ? item.marketState : 'unknown',
        timestamp: item.timestamp || item.lastQuoteAt || null,
        stale: item.stale === true,
        dayDiffPercent: toNum(item.dayDiffPercent),
      };
    }
  } catch (err: any) {
    errors.push(`biquote latest: ${err?.message || err}`);
  } finally {
    clearTimeout(timeout);
  }
  return { quotes, errors };
}

export const biquoteSource: QuoteSource = {
  id: 'biquote',
  label: 'biquote.io (MT5 Relay)',

  isConfigured(): boolean {
    return config.biquote.enabled;
  },

  async fetchLatest(symbols: readonly SymbolCode[]): Promise<SourceBatch> {
    const errors: string[] = [];
    const quotes: Partial<Record<SymbolCode, SourceQuote>> = {};

    const params = symbols.map((s) => `symbols=${s}`).join('&');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(`${BASE}/latest?${params}`, {
        signal: controller.signal,
        headers: { 'User-Agent': 'AzariTradeAI/2.0' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Record<string, any>;

      for (const sym of symbols) {
        const item = data[sym];
        if (!item) continue;
        const bid = toNum(item.bid);
        const ask = toNum(item.ask);
        if (bid === null && ask === null) continue;
        const mid = toNum(item.mid) ?? (bid !== null && ask !== null ? (bid + ask) / 2 : bid ?? ask ?? 0);
        if (!mid) continue;
        const spread = toNum(item.spread) ?? (bid !== null && ask !== null ? ask - bid : null);
        quotes[sym] = {
          bid: bid ?? mid,
          ask: ask ?? mid,
          mid,
          spread,
          high: toNum(item.high),
          low: toNum(item.low),
          direction: item.direction === 'DOWN' ? 'DOWN' : item.direction === 'UP' ? 'UP' : null,
          dayDiffPercent: toNum(item.dayDiffPercent),
          timestamp: item.timestamp || item.lastQuoteAt || null,
          marketState: typeof item.marketState === 'string' ? item.marketState : 'unknown',
          stale: item.stale === true,
          exchange: item.exchange || '',
          // biquote reports the upstream broker it relays (e.g. "MetaTrader 5 (Broker 1)").
          // Prefix with "biquote ·" so nobody mistakes it for their OWN MetaApi connection.
          sourceLabel:
            typeof item.source === 'string' && item.source ? `biquote · ${item.source}` : 'biquote.io',
        };
      }
    } catch (err: any) {
      errors.push(`biquote latest: ${err?.message || err}`);
    } finally {
      clearTimeout(timeout);
    }
    return { sourceId: 'biquote', sourceLabel: 'biquote.io', quotes, errors };
  },

  async fetchOhlc(symbol: SymbolCode, interval: string, limit: number): Promise<Bar[] | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(`${BASE}/${symbol}/ohlc?interval=${interval}&limit=${limit}`, {
        signal: controller.signal,
        headers: { 'User-Agent': 'AzariTradeAI/2.0' },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { bars?: any[] };
      if (!Array.isArray(data.bars)) return null;
      return data.bars
        .map((b) => ({
          openTime: b.openTime,
          open: toNum(b.open) ?? 0,
          high: toNum(b.high) ?? 0,
          low: toNum(b.low) ?? 0,
          close: toNum(b.close) ?? 0,
          volume: toNum(b.volume ?? b.tickVolume),
          isOpen: b.isOpen === true,
        }))
        .filter((b) => b.openTime && b.close > 0);
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  },
};
