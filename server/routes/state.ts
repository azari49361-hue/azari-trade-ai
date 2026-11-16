import { Router } from 'express';
import { config } from '../config';
import * as quotesEngine from '../engine/quotes';
import * as dispatcher from '../engine/dispatcher';
import * as repo from '../db/repo';
import * as telegram from '../telegram/client';
import { computeMarketStatus } from '../lib/marketStatus';
import { getLastPollErrors } from '../engine/quotes';
import * as candleHealth from '../engine/candleHealth';
import * as scanLoop from '../engine/scanLoop';
import * as newsCalendar from '../engine/newsCalendar';

export const stateRouter = Router();

/** جمع سود/ضرر فقط با هر تحقق هدف عوض می‌شود — چند ثانیه کش کافی است. */
let pnlCache: { at: number; value: repo.PnlSummary } | null = null;
async function cachedPnlSummary(): Promise<repo.PnlSummary> {
  if (pnlCache && Date.now() - pnlCache.at < 15_000) return pnlCache.value;
  const value = await repo.goldPnlSummary();
  pnlCache = { at: Date.now(), value };
  return value;
}

/**
 * Full dashboard state.
 * Honesty guarantees:
 *  - workerStatus.isOnline derives from the real DB heartbeat (never hardcoded true).
 *  - marketStatus reflects day + feed freshness + broker state.
 *  - quotes carry quoteState (LIVE/STALE/NONE) and real source labels.
 */
stateRouter.get('/state', async (_req, res) => {
  try {
    const [quotes, baselines, alerts, signals, trackedGold, worker, activeTrackedCount, pnlSummary] = await Promise.all([
      quotesEngine.getQuotes(),
      repo.getAllBaselines(),
      repo.listAlerts(10),
      repo.listSignals(20),
      repo.listTrackedGold(15),
      repo.getWorkerStatus(),
      repo.countActiveTracked(),
      // خطای آمار نباید کل داشبورد را از کار بیندازد
      cachedPnlSummary().catch(() => null),
    ]);

    const dataAgeMs = quotesEngine.getDataAgeMs();
    const marketStatus = computeMarketStatus(dataAgeMs, quotesEngine.isBrokerClosed(), config.engine.quoteMaxAgeMs);

    const now = Date.now();
    const hbAge = worker?.lastHeartbeat ? now - new Date(worker.lastHeartbeat).getTime() : Infinity;

    res.json({
      quotes: Object.fromEntries(quotes.map((q) => [q.symbol, q])),
      source: quotesEngine.getActiveSourceLabel(),
      lastSuccessfulFetch: quotesEngine.getLastSuccessfulFetchAt(),
      isWeekend: marketStatus.isWeekend,
      marketStatus,
      telegramConfigured: telegram.isConnected(),
      telegram: telegram.view(),
      alertBaselines: baselines,
      alerts,
      signals,
      trackedGoldSignals: trackedGold,
      preSignalStatus: dispatcher.getPreSignalStatus(),
      workerStatus: {
        // Real heartbeat liveness — if the process stops, this turns false within 30s.
        isOnline: hbAge < 30_000,
        lastHeartbeat: worker?.lastHeartbeat || null,
        lastQuoteAt: worker?.lastQuoteAt || null,
        lastScanAt: worker?.lastScanAt || null,
        lastError: worker?.lastError || null,
        activeTrackedCount,
      },
      sources: quotesEngine.sourcesStatus(),
      candleHealth: candleHealth.status(),
      scanHealth: scanLoop.status(),
      newsBlackout: await newsCalendar.status(),
      pnlSummary,
      feedErrors: getLastPollErrors(),
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'خطای داخلی سرور' });
  }
});
