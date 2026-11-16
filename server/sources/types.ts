import type { SymbolCode } from '../config';
import type { Bar } from '../lib/indicators';

/**
 * Raw quote/bar contracts every source must honour.
 * Rules:
 *  - Never fabricate bid/ask/spread/high/low. If a value is unknown, pass null.
 *  - marketState must reflect what the source actually reported ('open' | 'closed' | 'unknown').
 */

export interface SourceQuote {
  bid: number;
  ask: number;
  mid: number;
  spread: number | null;
  high: number | null;
  low: number | null;
  direction: 'UP' | 'DOWN' | null;
  dayDiffPercent: number | null;
  /** ISO timestamp as reported by the source */
  timestamp: string | null;
  marketState: string;
  /** source explicitly flagged this quote as stale */
  stale?: boolean;
  exchange?: string;
  /** human-readable source label shown in the UI */
  sourceLabel: string;
}

export interface SourceBatch {
  sourceId: 'metaapi' | 'twelvedata' | 'biquote';
  sourceLabel: string;
  quotes: Partial<Record<SymbolCode, SourceQuote>>;
  errors: string[];
}

export interface QuoteSource {
  id: SourceBatch['sourceId'];
  label: string;
  isConfigured(): boolean;
  fetchLatest(symbols: readonly SymbolCode[]): Promise<SourceBatch>;
  fetchOhlc(symbol: SymbolCode, interval: string, limit: number): Promise<Bar[] | null>;
}

export function toNum(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : null;
}
