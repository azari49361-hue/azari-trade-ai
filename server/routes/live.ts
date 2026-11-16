import { Router } from 'express';
import * as quotesEngine from '../engine/quotes';

export const liveRouter = Router();

/** High-frequency quote stream from in-memory state (no DB round trip). */
liveRouter.get('/live', (_req, res) => {
  const quotes = quotesEngine.getQuotes();
  res.json({
    quotes: Object.fromEntries(quotes.map((q) => [q.symbol, q])),
    source: quotesEngine.getActiveSourceLabel(),
    timestamp: Date.now(),
  });
});
