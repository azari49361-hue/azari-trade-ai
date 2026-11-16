import { Router } from 'express';
import { getPool } from '../db/pool';
import * as quotesEngine from '../engine/quotes';

export const healthRouter = Router();

/** Liveness + readiness for Docker healthcheck / uptime monitors. */
healthRouter.get('/health', async (_req, res) => {
  let dbOk = false;
  try {
    await getPool().query('SELECT 1');
    dbOk = true;
  } catch {
    dbOk = false;
  }
  const dataAgeMs = quotesEngine.getDataAgeMs();
  const feedOk = dataAgeMs < 10 * 60 * 1000;
  res.json({
    ok: dbOk,
    db: dbOk,
    feed: feedOk ? 'ok' : 'stale',
    lastSuccessfulFetchAt: quotesEngine.getLastSuccessfulFetchAt(),
    uptimeSeconds: Math.round(process.uptime()),
  });
});
