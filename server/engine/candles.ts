import type { SymbolCode } from '../config';
import { closedBarsOnly, type Bar } from '../lib/indicators';
import { log } from '../lib/logger';
import * as repo from '../db/repo';
import { metaapiSource } from '../sources/metaapi';
import { twelvedataSource } from '../sources/twelvedata';
import { biquoteSource } from '../sources/biquote';

/**
 * Candle store with source failover + short TTL cache.
 * Only CONFIRMED (closed) bars are ever handed to the signal engine.
 */

// باید کمتر از چرخه اسکن باشد تا کندل تازه‌بسته در همان اسکن بعدی دیده شود
// (با SCAN_INTERVAL_SECONDS=15 و TTL=5s، هر اسکن داده تازه می‌گیرد).
const TTL_MS = 5_000;
const cache = new Map<string, { at: number; bars: Bar[] }>();

const OHLC_SOURCES = [metaapiSource, biquoteSource, twelvedataSource];

export async function fetchOhlc(symbol: SymbolCode, interval: string, limit: number): Promise<Bar[] | null> {
  const key = `${symbol}:${interval}:${limit}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.bars;

  for (const source of OHLC_SOURCES) {
    if (!source.isConfigured()) continue;
    const bars = await source.fetchOhlc(symbol, interval, limit);
    if (bars && bars.length > 0) {
      cache.set(key, { at: Date.now(), bars });
      // Persist for audit/history (best effort)
      void repo
        .upsertCandles(
          symbol,
          interval,
          bars.map((b) => ({
            openTime: b.openTime,
            open: b.open,
            high: b.high,
            low: b.low,
            close: b.close,
            volume: b.volume ?? null,
            isOpen: b.isOpen === true,
          })),
          source.label
        )
        .catch(() => undefined);
      return bars;
    }
  }
  log('warn', 'Candles', `هیچ منبعی کندل ${symbol} ${interval} را برنگرداند.`);
  return null;
}

/** Confirmed bars only — the forming (open) bar is excluded by time-window + isOpen flag. */
export async function fetchConfirmedBars(symbol: SymbolCode, interval: string, limit: number): Promise<Bar[]> {
  const bars = await fetchOhlc(symbol, interval, limit);
  if (!bars) return [];
  const now = Date.now();
  return closedBarsOnly(bars, now, interval);
}

export function clearCandleCache(): void {
  cache.clear();
}
