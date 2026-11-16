import type { SymbolCode } from '../config';

/**
 * Domain models shared by engine, routes and (mirrored in) the React client.
 */

export type QuoteState = 'LIVE' | 'STALE' | 'NONE';

export interface QuoteData {
  symbol: SymbolCode;
  nameFa: string;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  spread: number | null;
  high: number | null;
  low: number | null;
  direction: 'UP' | 'DOWN';
  dayDiffPercent: number | null;
  /** ISO time of the quote as reported by the source */
  timestamp: string | null;
  /** ISO time our server received it */
  receivedAt: string;
  source: string;
  exchange: string;
  marketState: string;
  /** LIVE = fresh and market open · STALE = old/closed · NONE = no data at all */
  quoteState: QuoteState;
  ageSeconds: number | null;
}

export type SignalStatus = 'PENDING' | 'ACTIVE' | 'TP1_HIT' | 'TP2_HIT' | 'TP3_HIT' | 'SL_HIT' | 'REVERSED' | 'CLOSED';

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
  symbol: SymbolCode;
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
  reason: string;
  analysis: SignalAnalysis;
  indicators: Record<string, unknown>;
  status: SignalStatus;
  jalaliDate: string;
  tehranTime: string;
  timezone: string;
  source: string;
  candleOpenTime: string | null;
  createdAt: string;
  dispatchAt: string | null;
  preSignalSentAt: string | null;
  channelSentAt: string | null;
  tp1HitAt: string | null;
  tp2HitAt: string | null;
  tp3HitAt: string | null;
  slHitAt: string | null;
  warningYellowAt: string | null;
  warningRedAt: string | null;
  reversedAt: string | null;
  closedAt: string | null;
}

export interface PriceAlert {
  id: string;
  symbol: SymbolCode | string;
  nameFa: string;
  price: number;
  change: number;
  direction: 'UP' | 'DOWN';
  alertType: 'PRICE_SPIKE' | 'REVERSAL_YELLOW' | 'REVERSAL_RED';
  activeTradeEntry?: number | null;
  activeTradeDirection?: 'BUY' | 'SELL' | null;
  detailsFa?: string | null;
  telegramSent: boolean;
  createdAt: string;
}

export interface TelegramSettings {
  hasToken: boolean;
  botUsername: string;
  botName: string;
  channelChatId: string;
  /** چت شخصی مالک برای هشدارهای فنی؛ خالی = غیرفعال */
  adminChatId: string;
  isConnected: boolean;
  lastVerifiedAt: string | null;
}

export interface WorkerStatusView {
  isOnline: boolean;
  lastHeartbeat: string | null;
  lastQuoteAt: string | null;
  lastScanAt: string | null;
  lastError: string | null;
  activeTrackedCount: number;
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
