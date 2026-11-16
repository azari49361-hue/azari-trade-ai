import { Router } from 'express';
import { normalizeSymbol } from '../config';
import * as candles from '../engine/candles';

export const ohlcRouter = Router();

/**
 * OHLC passthrough for the dashboard chart (any timeframe the sources support).
 * On failure an explicit Persian error is returned — never fabricated bars.
 */
ohlcRouter.get('/ohlc', async (req, res) => {
  const symbol = normalizeSymbol((req.query.symbol as string) || 'XAUUSD');
  if (!symbol) {
    res.status(400).json({ ok: false, error: 'نماد نامعتبر است.' });
    return;
  }
  const interval = (req.query.interval as string) || '15m';
  const limit = Math.min(parseInt((req.query.limit as string) || '100', 10) || 100, 500);

  const bars = await candles.fetchOhlc(symbol, interval, limit);
  if (!bars) {
    res.status(502).json({
      ok: false,
      error: 'اتصال برقرار نیست: داده کندل از هیچ منبعی دریافت نشد.',
    });
    return;
  }
  res.json({ symbol, interval, bars, source: 'aggregated' });
});
