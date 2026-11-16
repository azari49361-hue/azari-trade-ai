import { SYMBOLS, SYMBOL_NAMES_FA, config, type SymbolCode } from '../config';
import type { QuoteData, QuoteState } from '../domain/types';
import { authoritativeNow } from '../lib/time';
import { log } from '../lib/logger';
import * as repo from '../db/repo';
import { metaapiSource } from '../sources/metaapi';
import { twelvedataSource } from '../sources/twelvedata';
import { biquoteSource } from '../sources/biquote';
import type { QuoteSource } from '../sources/types';

/**
 * Quote orchestrator.
 * Priority: MetaApi (real MT5) → Twelve Data (keyed) → biquote (free relay).
 * First source that answers per symbol wins; gaps are filled by the next source.
 * In-memory state powers /api/live without touching the DB on every request.
 */

const SOURCES: QuoteSource[] = [metaapiSource, twelvedataSource, biquoteSource];

const memoryQuotes = new Map<SymbolCode, QuoteData>();
let lastSuccessfulFetchAt: number | null = null;
let activeSourceLabel = 'هیچ منبعی هنوز پاسخ نداده';
let lastPollErrors: string[] = [];

export function computeQuoteState(q: QuoteData, now: number, maxAgeMs: number): QuoteState {
  if (q.mid === null || q.mid === 0) return 'NONE';
  const age = now - new Date(q.receivedAt).getTime();
  if (age > maxAgeMs) return 'STALE';
  if (q.marketState === 'closed') return 'STALE';
  return 'LIVE';
}

function decorate(q: QuoteData): QuoteData {
  const now = Date.now();
  const ageMs = now - new Date(q.receivedAt).getTime();
  return {
    ...q,
    quoteState: computeQuoteState(q, now, config.engine.quoteMaxAgeMs),
    ageSeconds: Math.round(ageMs / 1000),
  };
}

export function getQuotes(): QuoteData[] {
  const now = Date.now();
  return SYMBOLS.map((s) => memoryQuotes.get(s)).filter(Boolean).map((q) => decorate(q!));
}

export function getQuote(sym: SymbolCode): QuoteData | null {
  const q = memoryQuotes.get(sym);
  return q ? decorate(q) : null;
}

export function getActiveSourceLabel(): string {
  return activeSourceLabel;
}

export function getDataAgeMs(): number {
  return lastSuccessfulFetchAt === null ? Infinity : Date.now() - lastSuccessfulFetchAt;
}

export function getLastSuccessfulFetchAt(): number | null {
  return lastSuccessfulFetchAt;
}

/** Broker closed: XAUUSD (primary symbol) explicitly reported closed/stale by its source. */
export function isBrokerClosed(): boolean {
  const gold = memoryQuotes.get('XAUUSD');
  if (!gold) return false;
  return gold.marketState === 'closed';
}

export function sourcesStatus() {
  return {
    metaapi: metaapiSource.isConfigured(),
    twelvedata: twelvedataSource.isConfigured(),
    biquote: biquoteSource.isConfigured(),
    activeSource: activeSourceLabel,
    lastSuccessfulFetchAt: lastSuccessfulFetchAt,
  };
}

let polling = false;

export async function pollOnce(): Promise<void> {
  if (polling) return;
  polling = true;
  const errors: string[] = [];
  try {
    const configured = SOURCES.filter((s) => s.isConfigured());
    if (configured.length === 0) {
      log('error', 'Quotes', 'هیچ منبع قیمتی پیکربندی نشده است (MetaApi/TwelveData/biquote). قیمتی دریافت نمی‌شود.');
      return;
    }

    const covered = new Set<SymbolCode>();
    let anyNewData = false;

    for (const source of configured) {
      const remaining = SYMBOLS.filter((s) => !covered.has(s));
      if (remaining.length === 0) break;
      const batch = await source.fetchLatest(remaining);
      errors.push(...batch.errors);

      for (const sym of remaining) {
        const raw = batch.quotes[sym];
        if (!raw) continue;
        const q: QuoteData = {
          symbol: sym,
          nameFa: SYMBOL_NAMES_FA[sym],
          bid: raw.bid,
          ask: raw.ask,
          mid: raw.mid,
          spread: raw.spread,
          high: raw.high,
          low: raw.low,
          direction: raw.direction ?? (raw.dayDiffPercent !== null && raw.dayDiffPercent >= 0 ? 'UP' : 'DOWN'),
          dayDiffPercent: raw.dayDiffPercent,
          timestamp: raw.timestamp,
          receivedAt: authoritativeNow().toISOString(),
          source: raw.sourceLabel,
          exchange: raw.exchange || '',
          marketState: raw.marketState,
          quoteState: 'LIVE',
          ageSeconds: 0,
        };
        // A source-flagged stale quote is stored (so the UI can show real values) but will
        // compute to STALE state — never presented as live.
        memoryQuotes.set(sym, q);
        covered.add(sym);
        anyNewData = true;
        activeSourceLabel = raw.sourceLabel;
        void repo.upsertQuote(q).catch((e) => log('error', 'Quotes', `DB upsert failed: ${e?.message}`));
      }
    }

    if (anyNewData) {
      lastSuccessfulFetchAt = Date.now();
      await repo.heartbeat({ lastHeartbeat: new Date(), lastQuoteAt: new Date() });
    }
    if (errors.length > 0) {
      lastPollErrors = errors.slice(0, 5);
      // Primary-source failure must be visible, not silent.
      log('warn', 'Quotes', `برخی منابع پاسخ ندادند: ${errors.join(' | ')}`);
    } else {
      lastPollErrors = [];
    }
  } finally {
    polling = false;
  }
}

export function getLastPollErrors(): string[] {
  return [...lastPollErrors];
}

export function startQuotePolling(onBatch?: () => void): void {
  const loop = async () => {
    try {
      await pollOnce();
      onBatch?.();
    } catch (err: any) {
      log('error', 'Quotes', `چرخه پولینگ قیمت شکست خورد: ${err?.message}`);
    }
  };
  void loop();
  setInterval(loop, 5000);
}
