/**
 * Single source of truth for per-symbol decimal digits (client side).
 * Mirrors server/config.ts SYMBOL_DIGITS — keeps UI numbers consistent everywhere.
 */
export const SYMBOL_DIGITS: Record<string, number> = {
  XAUUSD: 2,
  XAGUSD: 3,
  USOIL: 3,
  DXY: 3,
};

export function digitsFor(symbol: string): number {
  return SYMBOL_DIGITS[symbol] ?? 2;
}
