import { ALERT_STEPS, SYMBOL_NAMES_FA, type SymbolCode } from '../config';
import type { PriceAlert, QuoteData } from '../domain/types';
import { authoritativeNow, formatPersianDateTime } from '../lib/time';
import { log } from '../lib/logger';
import * as repo from '../db/repo';

/**
 * Step price alerts (gold ±$10, silver ±$0.5, oil ±$1, DXY ±0.1).
 * Dashboard alerts only — no telegram spam. Baselines persist in DB.
 */

const pendingBaselines = new Map<SymbolCode, number>();

export async function onQuotes(quotes: QuoteData[]): Promise<void> {
  for (const q of quotes) {
    if (q.quoteState !== 'LIVE' || q.mid === null) continue;
    try {
      await checkStep(q.symbol, q.mid);
    } catch (err: any) {
      log('error', 'Alerts', `خطا در بررسی هشدار قیمت ${q.symbol}: ${err?.message}`);
    }
  }
}

export async function checkStep(symbol: SymbolCode, price: number): Promise<PriceAlert | null> {
  const step = ALERT_STEPS[symbol];
  if (!step || !price || price <= 0) return null;

  let baseline = pendingBaselines.get(symbol);
  if (baseline === undefined) {
    baseline = await repo.getBaseline(symbol);
    pendingBaselines.set(symbol, baseline);
  }

  if (baseline === 0) {
    pendingBaselines.set(symbol, price);
    await repo.setBaseline(symbol, price);
    return null;
  }

  const diff = price - baseline;
  if (Math.abs(diff) < step) return null;

  pendingBaselines.set(symbol, price);
  await repo.setBaseline(symbol, price);

  const now = authoritativeNow();
  const fmt = formatPersianDateTime(now, 'Asia/Tehran');
  const alert: PriceAlert = {
    id: `alt_${now.getTime()}_${Math.random().toString(36).slice(2, 6)}`,
    symbol,
    nameFa: SYMBOL_NAMES_FA[symbol],
    price,
    change: parseFloat(diff.toFixed(3)),
    direction: diff > 0 ? 'UP' : 'DOWN',
    alertType: 'PRICE_SPIKE',
    telegramSent: false,
    createdAt: now.toISOString(),
  };
  await repo.addAlert(alert);
  log('info', 'Alerts', `هشدار قیمت ${symbol}: ${diff > 0 ? '+' : ''}${diff.toFixed(2)} (${fmt.time24})`);
  return alert;
}

/** Test helper: inject a clearly-labelled test alert into the feed. */
export async function createTestAlert(symbol: SymbolCode): Promise<PriceAlert> {
  const now = authoritativeNow();
  const alert: PriceAlert = {
    id: `alt_test_${now.getTime()}`,
    symbol,
    nameFa: `${SYMBOL_NAMES_FA[symbol]} (تستی)`,
    price: 0,
    change: ALERT_STEPS[symbol] || 0,
    direction: 'UP',
    alertType: 'PRICE_SPIKE',
    detailsFa: 'هشدار آزمایشی — توسط ادمین داشبورد ایجاد شد.',
    telegramSent: false,
    createdAt: now.toISOString(),
  };
  await repo.addAlert(alert);
  return alert;
}
