import type { SymbolCode } from '../config';
import type { Bar } from '../lib/indicators';
import type { QuoteSource, SourceBatch, SourceQuote } from './types';
import { toNum } from './types';
import { config } from '../config';

/**
 * MetaApi (cloud.metaapi.io) — real MT4/MT5 broker connection. Highest-priority source.
 * REST endpoints (header: auth-token):
 *   GET {host}/users/current/accounts/{accountId}/symbols/{symbol}/current-price
 *   GET {host}/users/current/accounts/{accountId}/symbols/{symbol}/candles/{timeframe}?limit=N
 * Different brokers name symbols differently, so each symbol has candidate names tried in order.
 */

const SYMBOL_CANDIDATES: Record<SymbolCode, string[]> = {
  XAUUSD: ['XAUUSD', 'GOLD', 'XAU/USD'],
  XAGUSD: ['XAGUSD', 'SILVER', 'XAG/USD'],
  USOIL: ['USOIL', 'WTI', 'CL', 'USOIL.cfd', 'XTIUSD'],
  DXY: ['DXY', 'USDX', 'DX-Y.NYB', 'DOLLAR'],
};

async function metaapiGet<T>(path: string): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`${config.metaapi.restHost}${path}`, {
      headers: { 'auth-token': config.metaapi.token },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

interface MetaPrice {
  symbol: string;
  bid: number;
  ask: number;
  time: string;
}

interface MetaCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume?: number;
  volume?: number;
  closed?: boolean;
}

export const metaapiSource: QuoteSource = {
  id: 'metaapi',
  label: 'MetaApi (MT5 Live)',

  isConfigured(): boolean {
    return config.metaapi.configured;
  },

  async fetchLatest(symbols: readonly SymbolCode[]): Promise<SourceBatch> {
    const errors: string[] = [];
    const quotes: Partial<Record<SymbolCode, SourceQuote>> = {};
    if (!config.metaapi.configured) return { sourceId: 'metaapi', sourceLabel: 'MetaApi', quotes, errors };

    for (const sym of symbols) {
      for (const candidate of SYMBOL_CANDIDATES[sym]) {
        const price = await metaapiGet<MetaPrice>(
          `/users/current/accounts/${config.metaapi.accountId}/symbols/${encodeURIComponent(candidate)}/current-price?keepSubscription=true`
        );
        if (price && (toNum(price.bid) !== null || toNum(price.ask) !== null)) {
          const bid = toNum(price.bid);
          const ask = toNum(price.ask);
          const mid = bid !== null && ask !== null ? (bid + ask) / 2 : bid ?? ask ?? 0;
          quotes[sym] = {
            bid: bid ?? mid,
            ask: ask ?? mid,
            mid,
            spread: bid !== null && ask !== null ? ask - bid : null,
            high: null, // not provided by this endpoint — stays null instead of fabricated
            low: null,
            direction: null,
            dayDiffPercent: null,
            timestamp: price.time || null,
            marketState: 'unknown',
            exchange: 'MT5',
            sourceLabel: `MetaApi · ${candidate}`,
          };
          break;
        }
      }
      if (!quotes[sym]) errors.push(`MetaApi: no price for ${sym} (symbol not found on broker or subscription failed)`);
    }
    return { sourceId: 'metaapi', sourceLabel: 'MetaApi', quotes, errors };
  },

  async fetchOhlc(symbol: SymbolCode, interval: string, limit: number): Promise<Bar[] | null> {
    if (!config.metaapi.configured) return null;
    for (const candidate of SYMBOL_CANDIDATES[symbol]) {
      const candles = await metaapiGet<MetaCandle[]>(
        `/users/current/accounts/${config.metaapi.accountId}/symbols/${encodeURIComponent(candidate)}/candles/${interval}?limit=${limit}`
      );
      if (Array.isArray(candles) && candles.length > 0) {
        return candles
          .map((c) => ({
            openTime: c.time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume ?? c.tickVolume ?? null,
            // MetaApi marks forming candles with closed=false
            isOpen: c.closed === false,
          }))
          .filter((b) => b.openTime && b.close > 0);
      }
    }
    return null;
  },
};
