import type { TradeSignal } from '../types';

/** سود/ضرر زندهٔ یک معاملهٔ باز. */
export interface TradePnl {
  price: number;
  /** اختلاف قیمت با ورود، علامت‌دار بر اساس جهت معامله (BUY مثبت = سود). */
  distance: number;
  /** فاصله بر حسب ریسک معامله (۱R = فاصلهٔ ورود تا حد ضرر). */
  rMultiple: number;
  percent: number;
  inProfit: boolean;
}

export function computeTradePnl(
  sig: Pick<TradeSignal, 'type' | 'entry' | 'sl'>,
  price: number | null | undefined
): TradePnl | null {
  if (!Number.isFinite(price) || (price as number) <= 0) return null;
  if (!Number.isFinite(sig.entry) || sig.entry <= 0) return null;
  const p = price as number;
  const dir = sig.type === 'BUY' ? 1 : -1;
  const distance = (p - sig.entry) * dir;
  const risk = Math.abs(sig.entry - sig.sl);
  return {
    price: p,
    distance,
    rMultiple: risk > 0 ? distance / risk : 0,
    percent: (distance / sig.entry) * 100,
    inProfit: distance > 0,
  };
}

/** متن فشرده: «+2.40$ · +0.53R». */
export function formatPnl(pnl: TradePnl, digits: number): string {
  const sign = pnl.inProfit ? '+' : '−';
  const rSign = pnl.rMultiple >= 0 ? '+' : '−';
  return `${sign}${Math.abs(pnl.distance).toFixed(digits)} · ${rSign}${Math.abs(pnl.rMultiple).toFixed(2)}R`;
}

/** موقعیت قیمت بین حد ضرر و هدف اول (۰٪ = SL، ۱۰۰٪ = TP1). */
export interface TradeProgress {
  toTp1Pct: number;
  entryPct: number;
  toTp1: number;
  toSl: number;
}

export function tradeProgress(
  sig: Pick<TradeSignal, 'type' | 'entry' | 'sl' | 'tp1'>,
  price: number | null | undefined
): TradeProgress | null {
  if (!Number.isFinite(price) || (price as number) <= 0) return null;
  const p = price as number;
  const span = Math.abs(sig.tp1 - sig.sl);
  if (!Number.isFinite(span) || span <= 0) return null;
  const travelled = sig.type === 'BUY' ? p - sig.sl : sig.sl - p;
  const entryOffset = sig.type === 'BUY' ? sig.entry - sig.sl : sig.sl - sig.entry;
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  return {
    toTp1Pct: clamp((travelled / span) * 100),
    entryPct: clamp((entryOffset / span) * 100),
    toTp1: Math.abs(sig.tp1 - p),
    toSl: Math.abs(p - sig.sl),
  };
}

/** حجم قرارداد طلا: ۱ lot = ۱۰۰ اونس. */
const GOLD_CONTRACT_SIZE = 100;

/**
 * حجم موقعیت (lot size) بر اساس موجودی حساب و درصد ریسک.
 * lotSize = (balance × riskPct/100) / (|entry − sl| × contractSize)
 */
export interface PositionSize {
  lotSize: number;
  riskAmount: number;
  slDistance: number;
}

export function computePositionSize(
  sig: Pick<TradeSignal, 'entry' | 'sl'>,
  balance: number,
  riskPercent: number
): PositionSize | null {
  if (!Number.isFinite(balance) || balance <= 0) return null;
  if (!Number.isFinite(riskPercent) || riskPercent <= 0 || riskPercent > 100) return null;
  if (!Number.isFinite(sig.entry) || sig.entry <= 0) return null;
  const slDistance = Math.abs(sig.entry - sig.sl);
  if (!Number.isFinite(slDistance) || slDistance <= 0) return null;
  const riskAmount = balance * (riskPercent / 100);
  const lotSize = riskAmount / (slDistance * GOLD_CONTRACT_SIZE);
  return { lotSize, riskAmount, slDistance };
}

/** آیا این سیگنال الان «معاملهٔ باز» است. */
export function isOpenTrade(status: TradeSignal['status']): boolean {
  return status === 'ACTIVE' || status === 'TP1_HIT' || status === 'TP2_HIT';
}
