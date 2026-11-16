// ---------------------------------------------------------------
// Client-side domain types — mirror of the server contract.
// ---------------------------------------------------------------

export type QuoteState = 'LIVE' | 'STALE' | 'NONE';

/** یک ردیف تاریخچهٔ تصمیم اسکن (خودکار یا دستی). */
export interface ScanDecisionRow {
  id: number;
  scannedAt: string;
  symbol: string;
  outcome: 'skipped' | 'deduped' | 'error' | 'blocked' | 'signal' | string;
  gate: string | null;
  reason: string;
  candleOpenTime: string | null;
}

/** تجمیع تعداد ردها به تفکیک دروازه در بازهٔ انتخابی. */
export interface ScanGateStat {
  gate: string | null;
  outcome: string;
  count: number;
  lastAt: string;
  lastReason: string;
}

export interface ScanHistoryResponse {
  ok: boolean;
  hours: number;
  limit: number;
  byGate: ScanGateStat[];
  recent: ScanDecisionRow[];
}

export interface QuoteData {
  symbol: string;
  nameFa: string;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  spread: number | null;
  high: number | null;
  low: number | null;
  direction: 'UP' | 'DOWN';
  dayDiffPercent: number | null;
  timestamp: string | null;
  receivedAt: string;
  source: string;
  exchange: string;
  marketState: string;
  /** LIVE = fresh & tradable · STALE = old/closed feed · NONE = no data at all */
  quoteState: QuoteState;
  ageSeconds: number | null;
}

export type SignalStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'TP1_HIT'
  | 'TP2_HIT'
  | 'TP3_HIT'
  | 'SL_HIT'
  | 'REVERSED'
  | 'CLOSED';

export interface TimeframeAnalysis {
  ema9: number | null;
  ema21: number | null;
  rsi: number | null;
  atr: number | null;
  closedBars: number;
}

export interface SignalAnalysis {
  primaryTimeframe: string;
  timeframes: Record<string, TimeframeAnalysis>;
  h4Trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  h4TrendConfirmed: boolean;
  crossOnClosedCandle: boolean;
  candleOpenTime: string;
  spreadAtEntry: number | null;
  dataAgeSeconds: number;
}

export interface TradeSignal {
  id: string;
  symbol: string;
  nameFa: string;
  timeframe: string;
  type: 'BUY' | 'SELL';
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  rrRatio: number;
  rrLabel: string;
  confidence: number;
  reason?: string;
  analysis?: SignalAnalysis;
  indicators?: Record<string, unknown> & {
    ema9?: number;
    ema21?: number;
    rsi?: number;
    atr?: number;
    h4Trend?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  };
  status: SignalStatus;
  jalaliDate?: string;
  tehranTime?: string;
  timezone?: string;
  source?: string;
  candleOpenTime?: string | null;
  createdAt: string;
  dispatchAt?: string | null;
  preSignalSentAt?: string | null;
  channelSentAt?: string | null;
  tp1HitAt?: string | null;
  tp2HitAt?: string | null;
  tp3HitAt?: string | null;
  slHitAt?: string | null;
  warningYellowAt?: string | null;
  warningRedAt?: string | null;
  reversedAt?: string | null;
  closedAt?: string | null;
}

export interface PriceAlert {
  id: string;
  symbol: string;
  nameFa: string;
  price: number;
  change: number;
  direction: 'UP' | 'DOWN';
  alertType?: 'PRICE_SPIKE' | 'REVERSAL_YELLOW' | 'REVERSAL_RED';
  activeTradeEntry?: number | null;
  activeTradeDirection?: 'BUY' | 'SELL' | null;
  detailsFa?: string | null;
  telegramSent: boolean;
  createdAt: string;
}

export interface PreSignalStatus {
  active: boolean;
  symbol: string;
  targetTime: number;
  remainingSeconds: number;
  emoji: string;
  phrase: string;
  direction?: 'BUY' | 'SELL';
  entry?: number;
}

export interface TelegramConfigState {
  isConnected: boolean;
  botUsername?: string;
  botName?: string;
  channelChatId?: string;
  /** چت شخصی مالک برای هشدارهای فنی (کهنگی داده) */
  adminChatId?: string;
  hasToken: boolean;
  lastVerifiedAt?: string | null;
}

export interface WorkerStatus {
  /** derived from the real DB heartbeat — false when the backend is down */
  isOnline: boolean;
  lastHeartbeat: string | null;
  lastQuoteAt: string | null;
  lastScanAt: string | null;
  lastError: string | null;
  activeTrackedCount: number;
}

export interface MarketStatus {
  isOpen: boolean;
  isWeekend: boolean;
  isSaturdayOrSunday: boolean;
  isDataFresh: boolean;
  reasonFa: string;
  dayFa: string;
  currentDayName: string;
  nyTimeStr: string;
  tehranTimeStr: string;
  nextOpenFa: string;
}

export interface SourcesStatus {
  metaapi: boolean;
  twelvedata: boolean;
  biquote: boolean;
  activeSource: string;
  lastSuccessfulFetchAt: number | null;
}

export interface SourceSymbolStatus {
  symbol: string;
  nameFa: string;
  mid: number | null;
  spread: number | null;
  source: string;
  exchange: string;
  ageSeconds: number;
  quoteState: 'LIVE' | 'STALE' | 'NONE';
  marketState: 'open' | 'closed' | 'unknown';
  timestamp: string;
}

export interface SourceDetails extends SourcesStatus {
  ok: boolean;
  twelvedataKeySource: 'none' | 'env' | 'dashboard';
  twelvedataMinIntervalSeconds: number;
  dataAgeSeconds: number | null;
  pollErrors: string[];
  symbols: SourceSymbolStatus[];
}

export type CandleHealthState = 'OK' | 'STALE' | 'WAITING' | 'MARKET_CLOSED' | 'DISABLED';

export interface CandleHealthStatus {
  state: CandleHealthState;
  thresholdMs: number;
  checkIntervalMs: number;
  adminChatConfigured: boolean;
  marketOpen: boolean | null;
  lastCheckAt: string | null;
  nextCheckAt: string | null;
  ageMs: number | null;
  lastAction: 'ALERT' | 'RECOVERED' | null;
  lastAlertAt: string | null;
  lastRecoveredAt: string | null;
}

export type ScanLoopState = 'OK' | 'STALLED' | 'WAITING' | 'MARKET_CLOSED';

/** وضعیت چرخهٔ اسکن خودکار + ناظر آن (توقف، خطا، بازیابی). */
export interface ScanHealthStatus {
  state: ScanLoopState;
  thresholdMs: number;
  timeoutMs: number;
  intervalMs: number;
  adminChatConfigured: boolean;
  running: boolean;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  stalledForMs: number | null;
  lastError: string | null;
  lastBlockedReason: string | null;
  timeoutRecoveries: number;
  lastAlertAt: string | null;
}

export interface AppState {
  quotes: Record<string, QuoteData>;
  source: string;
  lastSuccessfulFetch: number | null;
  isWeekend: boolean;
  marketStatus: MarketStatus;
  telegramConfigured: boolean;
  telegram: TelegramConfigState;
  alertBaselines: Record<string, number>;
  alerts: PriceAlert[];
  signals: TradeSignal[];
  trackedGoldSignals: TradeSignal[];
  workerStatus: WorkerStatus;
  preSignalStatus?: PreSignalStatus | null;
  sources: SourcesStatus;
  feedErrors: string[];
  candleHealth?: CandleHealthStatus;
  scanHealth?: ScanHealthStatus;
  newsBlackout?: NewsBlackoutStatus;
  pnlSummary?: PnlSummary | null;
}

/** جمع سود/ضرر تحقق‌یافتهٔ سیگنال‌های طلا (۱ لات = ۱۰۰ اونس). */
export interface PnlSummary {
  profitUsd: number;
  lossUsd: number;
  /** اولین تحقق هدف/حد ضرر — مبدأ بازهٔ گزارش. */
  since: string | null;
  wins: number;
  losses: number;
}

export interface NewsBlackoutStatus {
  enabled: boolean;
  inBlackout: boolean;
  currentEvent: { title: string; date: string } | null;
  nextEvent: { title: string; date: string } | null;
  lastFetchAt: number | null;
  lastFetchError: string | null;
  eventCount: number;
  highImpactCount: number;
}

export interface OHLCBar {
  openTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  isOpen?: boolean;
}
