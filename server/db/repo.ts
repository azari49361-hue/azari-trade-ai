import { getPool } from './pool';
import type { SymbolCode } from '../config';
import type { PriceAlert, QuoteData, TelegramSettings, TradeSignal, WorkerStatusView } from '../domain/types';

/**
 * Data access layer (PostgreSQL).
 * Every function is parameterised — no string interpolation of values (SQL-injection safe).
 */

// ---------------------------------------------------------------- app settings

export async function getAppSetting(key: string): Promise<string> {
  const { rows } = await getPool().query<{ value: string }>('SELECT value FROM app_settings WHERE key = $1', [key]);
  return rows[0]?.value ?? '';
}

export async function setAppSetting(key: string, value: string): Promise<void> {
  await getPool().query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value]
  );
}

// ---------------------------------------------------------------- worker

export async function initDefaultRows(): Promise<void> {
  const pool = getPool();
  await pool.query('INSERT INTO worker_status (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
  await pool.query('INSERT INTO telegram_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
}

export interface HeartbeatPatch {
  lastHeartbeat?: Date | null;
  lastQuoteAt?: Date | null;
  lastScanAt?: Date | null;
  lastTrackingAt?: Date | null;
  lastError?: string | null;
}

const HEARTBEAT_COLS: Record<keyof HeartbeatPatch, string> = {
  lastHeartbeat: 'last_heartbeat',
  lastQuoteAt: 'last_quote_at',
  lastScanAt: 'last_scan_at',
  lastTrackingAt: 'last_tracking_at',
  lastError: 'last_error',
};

export async function heartbeat(patch: HeartbeatPatch): Promise<void> {
  const cols: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  for (const [k, col] of Object.entries(HEARTBEAT_COLS) as [keyof HeartbeatPatch, string][]) {
    if (patch[k] !== undefined) {
      cols.push(`${col} = $${i++}`);
      vals.push(patch[k]);
    }
  }
  cols.push('updated_at = now()');
  await getPool().query(`UPDATE worker_status SET ${cols.join(', ')} WHERE id = 1`, vals);
}

export async function getWorkerStatus(): Promise<WorkerStatusView | null> {
  const { rows } = await getPool().query(
    'SELECT last_heartbeat, last_quote_at, last_scan_at, last_error FROM worker_status WHERE id = 1'
  );
  const r = rows[0];
  if (!r) return null;
  return {
    // Online decision is made by the caller from real heartbeat age — never hardcoded true.
    isOnline: false,
    lastHeartbeat: r.last_heartbeat ? new Date(r.last_heartbeat).toISOString() : null,
    lastQuoteAt: r.last_quote_at ? new Date(r.last_quote_at).toISOString() : null,
    lastScanAt: r.last_scan_at ? new Date(r.last_scan_at).toISOString() : null,
    lastError: r.last_error || null,
    activeTrackedCount: 0,
  };
}

// ---------------------------------------------------------------- quotes

export async function upsertQuote(q: QuoteData): Promise<void> {
  await getPool().query(
    `INSERT INTO market_quotes
      (symbol, name_fa, bid, ask, mid, spread, high, low, direction, day_diff_percent, quoted_at, source, exchange, market_state, received_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
     ON CONFLICT (symbol) DO UPDATE SET
       name_fa = EXCLUDED.name_fa, bid = EXCLUDED.bid, ask = EXCLUDED.ask, mid = EXCLUDED.mid,
       spread = EXCLUDED.spread, high = EXCLUDED.high, low = EXCLUDED.low, direction = EXCLUDED.direction,
       day_diff_percent = EXCLUDED.day_diff_percent, quoted_at = EXCLUDED.quoted_at, source = EXCLUDED.source,
       exchange = EXCLUDED.exchange, market_state = EXCLUDED.market_state, received_at = now()`,
    [
      q.symbol,
      q.nameFa,
      q.bid,
      q.ask,
      q.mid,
      q.spread,
      q.high,
      q.low,
      q.direction,
      q.dayDiffPercent,
      q.timestamp ? new Date(q.timestamp) : null,
      q.source,
      q.exchange,
      q.marketState,
    ]
  );
}

export async function getQuotes(): Promise<QuoteData[]> {
  const { rows } = await getPool().query('SELECT * FROM market_quotes');
  return rows.map(rowToQuote);
}

function rowToQuote(r: Record<string, any>): QuoteData {
  return {
    symbol: r.symbol,
    nameFa: r.name_fa,
    bid: r.bid ?? null,
    ask: r.ask ?? null,
    mid: r.mid ?? null,
    spread: r.spread ?? null,
    high: r.high ?? null,
    low: r.low ?? null,
    direction: r.direction === 'DOWN' ? 'DOWN' : 'UP',
    dayDiffPercent: r.day_diff_percent ?? null,
    timestamp: r.quoted_at ? new Date(r.quoted_at).toISOString() : null,
    receivedAt: r.received_at ? new Date(r.received_at).toISOString() : new Date().toISOString(),
    source: r.source || '',
    exchange: r.exchange || '',
    marketState: r.market_state || 'unknown',
    quoteState: 'NONE',
    ageSeconds: null,
  };
}

// ---------------------------------------------------------------- candles

export interface CandleRow {
  openTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  isOpen: boolean;
}

export async function upsertCandles(symbol: string, timeframe: string, bars: CandleRow[], source: string): Promise<void> {
  const pool = getPool();
  for (const b of bars) {
    await pool.query(
      `INSERT INTO market_candles (symbol, timeframe, open_time, open, high, low, close, volume, is_open, source, received_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
       ON CONFLICT (symbol, timeframe, open_time) DO UPDATE SET
         open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low, close = EXCLUDED.close,
         volume = EXCLUDED.volume, is_open = EXCLUDED.is_open, source = EXCLUDED.source, received_at = now()`,
      [symbol, timeframe, new Date(b.openTime), b.open, b.high, b.low, b.close, b.volume, b.isOpen, source]
    );
  }
}

/** قدیمی‌ترین کندل ذخیره‌شده — نقطهٔ شروع پیمایش به عقب در تاریخچه. */
export async function getOldestCandleTime(symbol: string, timeframe: string): Promise<string | null> {
  const { rows } = await getPool().query(
    `SELECT min(open_time) AS t FROM market_candles WHERE symbol = $1 AND timeframe = $2`,
    [symbol, timeframe]
  );
  const t = rows[0]?.t;
  return t ? new Date(t).toISOString() : null;
}

export async function getCandles(symbol: string, timeframe: string, limit: number): Promise<CandleRow[]> {
  const { rows } = await getPool().query(
    `SELECT open_time, open, high, low, close, volume, is_open
     FROM market_candles
     WHERE symbol = $1 AND timeframe = $2
     ORDER BY open_time DESC
     LIMIT $3`,
    [symbol, timeframe, limit]
  );
  return rows
    .map((r: any) => ({
      openTime: new Date(r.open_time).toISOString(),
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume ?? null,
      isOpen: r.is_open,
    }))
    .reverse();
}

// ---------------------------------------------------------------- telegram settings

interface TelegramRow {
  bot_token: string;
  bot_username: string;
  bot_name: string;
  channel_chat_id: string;
  group_chat_id: string;
  admin_chat_id: string;
  is_connected: boolean;
  last_verified_at: Date | null;
}

export async function getTelegramRow(): Promise<TelegramRow | null> {
  const { rows } = await getPool().query('SELECT * FROM telegram_settings WHERE id = 1');
  return rows[0] || null;
}

export async function saveTelegramRow(patch: {
  botToken?: string;
  botUsername?: string;
  botName?: string;
  channelChatId?: string;
  groupChatId?: string;
  adminChatId?: string;
  isConnected?: boolean;
  lastVerifiedAt?: Date | null;
}): Promise<void> {
  const map: Record<string, string> = {
    botToken: 'bot_token',
    botUsername: 'bot_username',
    botName: 'bot_name',
    channelChatId: 'channel_chat_id',
    groupChatId: 'group_chat_id',
    adminChatId: 'admin_chat_id',
    isConnected: 'is_connected',
    lastVerifiedAt: 'last_verified_at',
  };
  const cols: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  for (const [k, col] of Object.entries(map)) {
    if ((patch as any)[k] !== undefined) {
      cols.push(`${col} = $${i++}`);
      vals.push((patch as any)[k]);
    }
  }
  if (cols.length === 0) return;
  cols.push('updated_at = now()');
  await getPool().query(`UPDATE telegram_settings SET ${cols.join(', ')} WHERE id = 1`, vals);
}

export async function getTelegramView(): Promise<TelegramSettings> {
  const row = await getTelegramRow();
  return {
    hasToken: Boolean(row?.bot_token),
    botUsername: row?.bot_username || '',
    botName: row?.bot_name || '',
    channelChatId: row?.channel_chat_id || '',
    adminChatId: row?.admin_chat_id || '',
    isConnected: Boolean(row?.is_connected),
    lastVerifiedAt: row?.last_verified_at ? new Date(row.last_verified_at).toISOString() : null,
  };
}

// ---------------------------------------------------------------- signals

interface SignalRow {
  id: string;
  symbol: string;
  name_fa: string;
  timeframe: string;
  type: string;
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  rr_ratio: number;
  rr_label: string;
  confidence: number;
  reason: string;
  analysis: any;
  indicators: any;
  status: string;
  jalali_date: string;
  tehran_time: string;
  timezone: string;
  source: string;
  candle_open_time: Date | null;
  created_at: Date;
  dispatch_at: Date | null;
  pre_signal_sent_at: Date | null;
  channel_sent_at: Date | null;
  tp1_hit_at: Date | null;
  tp2_hit_at: Date | null;
  tp3_hit_at: Date | null;
  sl_hit_at: Date | null;
  warning_yellow_at: Date | null;
  warning_red_at: Date | null;
  reversed_at: Date | null;
  closed_at: Date | null;
}

function rowToSignal(r: SignalRow): TradeSignal {
  const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
  return {
    id: r.id,
    symbol: r.symbol as SymbolCode,
    nameFa: r.name_fa,
    timeframe: r.timeframe,
    type: r.type === 'SELL' ? 'SELL' : 'BUY',
    entry: r.entry,
    sl: r.sl,
    tp1: r.tp1,
    tp2: r.tp2,
    tp3: r.tp3,
    rrRatio: r.rr_ratio,
    rrLabel: r.rr_label,
    confidence: r.confidence,
    reason: r.reason,
    analysis: r.analysis || {},
    indicators: r.indicators || {},
    status: r.status as TradeSignal['status'],
    jalaliDate: r.jalali_date,
    tehranTime: r.tehran_time,
    timezone: r.timezone,
    source: r.source,
    candleOpenTime: iso(r.candle_open_time),
    createdAt: iso(r.created_at) as string,
    dispatchAt: iso(r.dispatch_at),
    preSignalSentAt: iso(r.pre_signal_sent_at),
    channelSentAt: iso(r.channel_sent_at),
    tp1HitAt: iso(r.tp1_hit_at),
    tp2HitAt: iso(r.tp2_hit_at),
    tp3HitAt: iso(r.tp3_hit_at),
    slHitAt: iso(r.sl_hit_at),
    warningYellowAt: iso(r.warning_yellow_at),
    warningRedAt: iso(r.warning_red_at),
    reversedAt: iso(r.reversed_at),
    closedAt: iso(r.closed_at),
  };
}

const SIGNAL_INSERT_COLS = [
  'id', 'symbol', 'name_fa', 'timeframe', 'type', 'entry', 'sl', 'tp1', 'tp2', 'tp3',
  'rr_ratio', 'rr_label', 'confidence', 'reason', 'analysis', 'indicators', 'status',
  'jalali_date', 'tehran_time', 'timezone', 'source', 'candle_open_time', 'dispatch_at',
] as const;

/** Insert a signal. Returns false when the (symbol, timeframe, candle) already exists — hard dedupe. */
export async function insertSignal(sig: TradeSignal): Promise<boolean> {
  const values: unknown[] = [
    sig.id, sig.symbol, sig.nameFa, sig.timeframe, sig.type, sig.entry, sig.sl, sig.tp1, sig.tp2, sig.tp3,
    sig.rrRatio, sig.rrLabel, sig.confidence, sig.reason, JSON.stringify(sig.analysis), JSON.stringify(sig.indicators),
    sig.status, sig.jalaliDate, sig.tehranTime, sig.timezone, sig.source,
    sig.candleOpenTime ? new Date(sig.candleOpenTime) : null,
    sig.dispatchAt ? new Date(sig.dispatchAt) : null,
  ];
  const placeholders = values.map((_, i) => `$${i + 1}`).join(',');
  try {
    await getPool().query(
      `INSERT INTO trading_signals (${SIGNAL_INSERT_COLS.join(',')}) VALUES (${placeholders})`,
      values
    );
    return true;
  } catch (err: any) {
    if (err?.code === '23505') return false; // unique violation = duplicate decision for this candle
    throw err;
  }
}

const SIGNAL_FIELD_MAP: Record<string, string> = {
  status: 'status',
  dispatchAt: 'dispatch_at',
  preSignalSentAt: 'pre_signal_sent_at',
  channelSentAt: 'channel_sent_at',
  tp1HitAt: 'tp1_hit_at',
  tp2HitAt: 'tp2_hit_at',
  tp3HitAt: 'tp3_hit_at',
  slHitAt: 'sl_hit_at',
  warningYellowAt: 'warning_yellow_at',
  warningRedAt: 'warning_red_at',
  reversedAt: 'reversed_at',
  closedAt: 'closed_at',
};

export async function updateSignal(id: string, patch: Partial<Record<keyof typeof SIGNAL_FIELD_MAP, string | Date | null>>): Promise<void> {
  const cols: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  for (const [k, col] of Object.entries(SIGNAL_FIELD_MAP)) {
    if ((patch as any)[k] !== undefined) {
      cols.push(`${col} = $${i++}`);
      const v = (patch as any)[k];
      vals.push(v instanceof Date ? v : v === null ? null : String(v));
    }
  }
  if (cols.length === 0) return;
  vals.push(id);
  await getPool().query(`UPDATE trading_signals SET ${cols.join(', ')} WHERE id = $${vals.length}`, vals);
}

export async function listSignals(limit: number): Promise<TradeSignal[]> {
  const { rows } = await getPool().query(
    'SELECT * FROM trading_signals ORDER BY created_at DESC LIMIT $1',
    [limit]
  );
  return rows.map(rowToSignal);
}

export async function listTrackedGold(limit: number): Promise<TradeSignal[]> {
  const { rows } = await getPool().query(
    `SELECT * FROM trading_signals
     WHERE symbol = 'XAUUSD' AND status <> 'PENDING'
     ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return rows.map(rowToSignal);
}

export async function listPendingGoldDispatches(): Promise<TradeSignal[]> {
  const { rows } = await getPool().query(
    `SELECT * FROM trading_signals
     WHERE symbol = 'XAUUSD' AND status = 'PENDING'
     ORDER BY created_at ASC`
  );
  return rows.map(rowToSignal);
}

export async function findActiveGoldSignals(): Promise<TradeSignal[]> {
  const { rows } = await getPool().query(
    `SELECT * FROM trading_signals
     WHERE symbol = 'XAUUSD' AND status IN ('ACTIVE','TP1_HIT','TP2_HIT')
     ORDER BY created_at DESC`
  );
  return rows.map(rowToSignal);
}

export async function lastSignalCreatedAt(symbol: string): Promise<Date | null> {
  const { rows } = await getPool().query(
    `SELECT max(created_at) AS t FROM trading_signals WHERE symbol = $1 AND status <> 'PENDING'`,
    [symbol]
  );
  return rows[0]?.t ? new Date(rows[0].t) : null;
}

export async function countActiveTracked(): Promise<number> {
  const { rows } = await getPool().query(
    `SELECT count(*)::int AS n FROM trading_signals
     WHERE symbol = 'XAUUSD' AND status IN ('ACTIVE','TP1_HIT','TP2_HIT')`
  );
  return rows[0]?.n ?? 0;
}

/** ۱ لات استاندارد طلا = ۱۰۰ اونس؛ سود/ضرر دلاری از همین محاسبه می‌شود. */
const GOLD_OZ_PER_LOT = 100;

export interface PnlSummary {
  /** جمع سود دلاری سیگنال‌هایی که دست‌کم به TP1 رسیده‌اند (۱ لات). */
  profitUsd: number;
  /** جمع ضرر دلاری سیگنال‌هایی که حد ضرر خورده‌اند (۱ لات). */
  lossUsd: number;
  /** اولین باری که سیگنالی به هدف یا حد ضرر رسید (ISO) — مبدا بازهٔ گزارش. */
  since: string | null;
  wins: number;
  losses: number;
}

/**
 * جمع سود/ضرر تحقق‌یافتهٔ سیگنال‌های طلا (۱ لات).
 * سود هر سیگنال با بالاترین هدفی که لمس کرده حساب می‌شود (نه ۱+۲+۳ برای TP3)
 * و ضرر با فاصلهٔ ورود تا حد ضرر؛ سیگنالی که TP1 خورده و بعد SL هم بسته،
 * هم در ستون سود و هم در ستون ضرر می‌آید — همان چیزی که واقعاً اتفاق افتاده است.
 */
export async function goldPnlSummary(): Promise<PnlSummary> {
  const { rows } = await getPool().query(
    `SELECT entry, sl, tp1_hit_at, tp2_hit_at, tp3_hit_at, sl_hit_at
       FROM trading_signals
      WHERE symbol = 'XAUUSD'
        AND (tp1_hit_at IS NOT NULL OR tp2_hit_at IS NOT NULL
             OR tp3_hit_at IS NOT NULL OR sl_hit_at IS NOT NULL)`
  );

  let profitUsd = 0;
  let lossUsd = 0;
  let wins = 0;
  let losses = 0;
  let since: number | null = null;

  for (const r of rows) {
    const risk = Math.abs(Number(r.entry) - Number(r.sl)) * GOLD_OZ_PER_LOT;
    if (!Number.isFinite(risk) || risk <= 0) continue;

    const reached = r.tp3_hit_at ? 3 : r.tp2_hit_at ? 2 : r.tp1_hit_at ? 1 : 0;
    if (reached > 0) {
      profitUsd += reached * risk;
      wins += 1;
    }
    if (r.sl_hit_at) {
      lossUsd += risk;
      losses += 1;
    }

    for (const t of [r.tp1_hit_at, r.tp2_hit_at, r.tp3_hit_at, r.sl_hit_at]) {
      if (!t) continue;
      const ms = new Date(t).getTime();
      if (Number.isFinite(ms) && (since === null || ms < since)) since = ms;
    }
  }

  return {
    profitUsd: Math.round(profitUsd),
    lossUsd: Math.round(lossUsd),
    since: since === null ? null : new Date(since).toISOString(),
    wins,
    losses,
  };
}

// ---------------------------------------------------------------- signal events

export async function addSignalEvent(
  signalId: string,
  event: string,
  price?: number | null,
  payload?: Record<string, unknown>
): Promise<void> {
  try {
    await getPool().query(
      'INSERT INTO signal_events (signal_id, event, price, payload) VALUES ($1,$2,$3,$4)',
      [signalId, event, price ?? null, JSON.stringify(payload || {})]
    );
  } catch {
    /* journal failure must not break trading logic; logged upstream */
  }
}

// ---------------------------------------------------------------- price alerts

export async function addAlert(a: PriceAlert): Promise<void> {
  await getPool().query(
    `INSERT INTO price_alerts (id, symbol, name_fa, price, change_amount, direction, alert_type, active_trade_entry, active_trade_direction, details_fa, telegram_sent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (id) DO NOTHING`,
    [a.id, a.symbol, a.nameFa, a.price, a.change, a.direction, a.alertType, a.activeTradeEntry ?? null, a.activeTradeDirection ?? null, a.detailsFa ?? null, a.telegramSent]
  );
}

export async function listAlerts(limit: number): Promise<PriceAlert[]> {
  const { rows } = await getPool().query('SELECT * FROM price_alerts ORDER BY created_at DESC LIMIT $1', [limit]);
  return rows.map((r: any) => ({
    id: r.id,
    symbol: r.symbol,
    nameFa: r.name_fa,
    price: r.price,
    change: r.change_amount,
    direction: r.direction === 'DOWN' ? 'DOWN' : 'UP',
    alertType: r.alert_type,
    activeTradeEntry: r.active_trade_entry,
    activeTradeDirection: r.active_trade_direction,
    detailsFa: r.details_fa,
    telegramSent: Boolean(r.telegram_sent),
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

export async function markAlertTelegramSent(id: string): Promise<void> {
  await getPool().query('UPDATE price_alerts SET telegram_sent = true WHERE id = $1', [id]);
}

// ---------------------------------------------------------------- baselines

export async function getBaseline(symbol: string): Promise<number> {
  const { rows } = await getPool().query('SELECT baseline FROM alert_baselines WHERE symbol = $1', [symbol]);
  return rows[0]?.baseline ?? 0;
}

export async function getAllBaselines(): Promise<Record<string, number>> {
  const { rows } = await getPool().query('SELECT symbol, baseline FROM alert_baselines');
  const out: Record<string, number> = {};
  for (const r of rows) out[r.symbol] = r.baseline;
  return out;
}

export async function setBaseline(symbol: string, value: number): Promise<void> {
  await getPool().query(
    `INSERT INTO alert_baselines (symbol, baseline, updated_at) VALUES ($1,$2, now())
     ON CONFLICT (symbol) DO UPDATE SET baseline = EXCLUDED.baseline, updated_at = now()`,
    [symbol, value]
  );
}

// ---------------------------------------------------------------- logs

export async function addLog(level: string, scope: string, message: string): Promise<void> {
  try {
    await getPool().query('INSERT INTO system_logs (level, scope, message) VALUES ($1,$2,$3)', [level, scope, message]);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------- scan decisions

/** یک ردیف از تصمیم اسکن: سیگنال صادر شد یا اولین دروازه‌ای که رد کرد. */
export interface ScanDecisionRow {
  symbol: string;
  outcome: 'signal' | 'skipped' | 'deduped' | 'blocked' | 'error';
  gate: string | null;
  reason: string;
  candleOpenTime?: Date | null;
}

export interface ScanDecisionView {
  id: number;
  scannedAt: string;
  symbol: string;
  outcome: string;
  gate: string | null;
  reason: string;
  candleOpenTime: string | null;
}

export async function addScanDecisions(rows: ScanDecisionRow[], scannedAt: Date): Promise<void> {
  if (rows.length === 0) return;
  const pool = getPool();
  for (const r of rows) {
    await pool.query(
      `INSERT INTO scan_decisions (scanned_at, symbol, outcome, gate, reason, candle_open_time)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [scannedAt, r.symbol, r.outcome, r.gate, r.reason, r.candleOpenTime ?? null]
    );
  }
}

/** پاک‌سازی قدیمی‌ها؛ چون هر اسکن یک ردیف می‌سازد، نگه‌داری بی‌پایان جدول را باد می‌کند. */
export async function pruneScanDecisions(keepDays: number): Promise<void> {
  await getPool().query(
    `DELETE FROM scan_decisions WHERE scanned_at < now() - ($1 || ' days')::interval`,
    [String(Math.max(1, Math.floor(keepDays)))]
  );
}

export async function listScanDecisions(
  limit: number,
  hours: number,
  filters: { gate?: string; symbol?: string } = {}
): Promise<ScanDecisionView[]> {
  const where: string[] = [`scanned_at >= now() - ($1 || ' hours')::interval`];
  const params: unknown[] = [String(Math.max(1, Math.floor(hours)))];
  if (filters.gate) {
    params.push(filters.gate);
    where.push(`gate = $${params.length}`);
  }
  if (filters.symbol) {
    params.push(filters.symbol);
    where.push(`symbol = $${params.length}`);
  }
  params.push(Math.max(1, Math.floor(limit)));
  const { rows } = await getPool().query(
    `SELECT id, scanned_at, symbol, outcome, gate, reason, candle_open_time
       FROM scan_decisions
      WHERE ${where.join(' AND ')}
      ORDER BY scanned_at DESC, id DESC
      LIMIT $${params.length}`,
    params
  );
  return rows.map((r: any) => ({
    id: Number(r.id),
    scannedAt: new Date(r.scanned_at).toISOString(),
    symbol: r.symbol,
    outcome: r.outcome,
    gate: r.gate ?? null,
    reason: r.reason,
    candleOpenTime: r.candle_open_time ? new Date(r.candle_open_time).toISOString() : null,
  }));
}

/**
 * مسیر تصمیم‌های یک کندل مشخص: ردیف‌هایی که همان کندل بسته را ارزیابی کرده‌اند
 * (پنج دقیقهٔ پس از بسته شدنش) به‌همراه ردیف سیگنالِ همان کندل.
 * برای دیدن اینکه یک سیگنال از کدام دروازه‌ها گذشته تا صادر شود.
 */
export async function listScanDecisionsForCandle(
  symbol: string,
  candleOpenTime: Date
): Promise<ScanDecisionView[]> {
  const { rows } = await getPool().query(
    `SELECT id, scanned_at, symbol, outcome, gate, reason, candle_open_time
       FROM scan_decisions
      WHERE (symbol = $1 OR symbol = '-')
        AND (
          candle_open_time = $2::timestamptz
          OR (scanned_at >= $2::timestamptz + interval '5 minutes'
              AND scanned_at <  $2::timestamptz + interval '10 minutes')
        )
      ORDER BY scanned_at ASC, id ASC
      LIMIT 500`,
    [symbol, candleOpenTime.toISOString()]
  );
  return rows.map((r: any) => ({
    id: Number(r.id),
    scannedAt: new Date(r.scanned_at).toISOString(),
    symbol: r.symbol,
    outcome: r.outcome,
    gate: r.gate ?? null,
    reason: r.reason,
    candleOpenTime: r.candle_open_time ? new Date(r.candle_open_time).toISOString() : null,
  }));
}

/** آمار دروازه‌های رد در بازه مشخص — برای دیدن اینکه معمولاً کدام فیلتر جلوی سیگنال را می‌گیرد. */
export async function scanDecisionStats(
  hours: number,
  filters: { gate?: string; symbol?: string } = {}
): Promise<{ gate: string | null; outcome: string; count: number; lastAt: string; lastReason: string }[]> {
  const where: string[] = [`scanned_at >= now() - ($1 || ' hours')::interval`];
  const params: unknown[] = [String(Math.max(1, Math.floor(hours)))];
  if (filters.gate) {
    params.push(filters.gate);
    where.push(`gate = $${params.length}`);
  }
  if (filters.symbol) {
    params.push(filters.symbol);
    where.push(`symbol = $${params.length}`);
  }
  const { rows } = await getPool().query(
    `SELECT gate,
            outcome,
            count(*)::int AS count,
            max(scanned_at) AS last_at,
            (array_agg(reason ORDER BY scanned_at DESC, id DESC))[1] AS last_reason
       FROM scan_decisions
      WHERE ${where.join(' AND ')}
      GROUP BY gate, outcome
      ORDER BY count DESC`,
    params
  );
  return rows.map((r: any) => ({
    gate: r.gate ?? null,
    outcome: r.outcome,
    count: Number(r.count),
    lastAt: new Date(r.last_at).toISOString(),
    lastReason: r.last_reason,
  }));
}
