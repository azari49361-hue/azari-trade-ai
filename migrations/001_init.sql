-- AZARI TRADE AI — Migration 001: initial schema
-- All timestamps stored in UTC (TIMESTAMPTZ). Persian date/time strings cached per row for display.

CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Single-row application settings (baselines live in their own table)
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reserved for future multi-user support (owner role now)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Telegram settings: exactly one row; bot token stored as plain text
CREATE TABLE IF NOT EXISTS telegram_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  bot_token TEXT NOT NULL DEFAULT '',
  bot_username TEXT NOT NULL DEFAULT '',
  bot_name TEXT NOT NULL DEFAULT '',
  channel_chat_id TEXT NOT NULL DEFAULT '',
  group_chat_id TEXT NOT NULL DEFAULT '',
  -- چت شخصی مالک برای هشدارهای فنی (کهنگی داده)؛ خالی = غیرفعال
  admin_chat_id TEXT NOT NULL DEFAULT '',
  is_connected BOOLEAN NOT NULL DEFAULT false,
  last_verified_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Latest quote per symbol (4 core symbols)
CREATE TABLE IF NOT EXISTS market_quotes (
  symbol TEXT PRIMARY KEY,
  name_fa TEXT NOT NULL,
  bid DOUBLE PRECISION,
  ask DOUBLE PRECISION,
  mid DOUBLE PRECISION,
  spread DOUBLE PRECISION,
  high DOUBLE PRECISION,
  low DOUBLE PRECISION,
  direction TEXT NOT NULL DEFAULT 'UP',
  day_diff_percent DOUBLE PRECISION,
  quoted_at TIMESTAMPTZ,
  source TEXT NOT NULL,
  exchange TEXT NOT NULL DEFAULT '',
  market_state TEXT NOT NULL DEFAULT 'unknown',
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Confirmed (closed) candles cache per symbol+timeframe
CREATE TABLE IF NOT EXISTS market_candles (
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  open_time TIMESTAMPTZ NOT NULL,
  open DOUBLE PRECISION NOT NULL,
  high DOUBLE PRECISION NOT NULL,
  low DOUBLE PRECISION NOT NULL,
  close DOUBLE PRECISION NOT NULL,
  volume DOUBLE PRECISION,
  is_open BOOLEAN NOT NULL DEFAULT false,
  source TEXT NOT NULL DEFAULT '',
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, timeframe, open_time)
);

CREATE INDEX IF NOT EXISTS idx_market_candles_lookup
  ON market_candles (symbol, timeframe, open_time DESC);

-- Trading signals — full lifecycle:
-- PENDING (awaiting scheduled channel dispatch) → ACTIVE → TP1_HIT → TP2_HIT → TP3_HIT (terminal)
-- SL_HIT (terminal), REVERSED (protection close), CLOSED (manual/other close).
-- Terminal hit statuses are NEVER overwritten (bug fixed vs old version).
CREATE TABLE IF NOT EXISTS trading_signals (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  name_fa TEXT NOT NULL,
  timeframe TEXT NOT NULL DEFAULT 'M5',
  type TEXT NOT NULL CHECK (type IN ('BUY', 'SELL')),
  entry DOUBLE PRECISION NOT NULL,
  sl DOUBLE PRECISION NOT NULL,
  tp1 DOUBLE PRECISION NOT NULL,
  tp2 DOUBLE PRECISION NOT NULL,
  tp3 DOUBLE PRECISION NOT NULL,
  rr_ratio DOUBLE PRECISION NOT NULL,
  rr_label TEXT NOT NULL,
  confidence INT NOT NULL DEFAULT 60,
  reason TEXT NOT NULL DEFAULT '',
  analysis JSONB NOT NULL DEFAULT '{}'::jsonb,
  indicators JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','ACTIVE','TP1_HIT','TP2_HIT','TP3_HIT','SL_HIT','REVERSED','CLOSED')),
  jalali_date TEXT NOT NULL DEFAULT '',
  tehran_time TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT 'Asia/Tehran',
  source TEXT NOT NULL DEFAULT '',
  candle_open_time TIMESTAMPTZ,
  dispatch_at TIMESTAMPTZ,
  pre_signal_sent_at TIMESTAMPTZ,
  channel_sent_at TIMESTAMPTZ,
  tp1_hit_at TIMESTAMPTZ,
  tp2_hit_at TIMESTAMPTZ,
  tp3_hit_at TIMESTAMPTZ,
  sl_hit_at TIMESTAMPTZ,
  warning_yellow_at TIMESTAMPTZ,
  warning_red_at TIMESTAMPTZ,
  reversed_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hard dedupe: one decision per (symbol, timeframe, closed candle). Survives restarts.
CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_candle
  ON trading_signals (symbol, timeframe, candle_open_time)
  WHERE candle_open_time IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_signals_created ON trading_signals (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_symbol ON trading_signals (symbol, created_at DESC);

-- Immutable event journal per signal (issuance, dispatch, hits, warnings, closes)
CREATE TABLE IF NOT EXISTS signal_events (
  id BIGSERIAL PRIMARY KEY,
  signal_id TEXT NOT NULL REFERENCES trading_signals(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  price DOUBLE PRECISION,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signal_events_signal ON signal_events (signal_id, created_at);

-- Price alerts feed (step alerts + trade protection warnings)
CREATE TABLE IF NOT EXISTS price_alerts (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  name_fa TEXT NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  change_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  direction TEXT NOT NULL DEFAULT 'UP',
  alert_type TEXT NOT NULL DEFAULT 'PRICE_SPIKE'
    CHECK (alert_type IN ('PRICE_SPIKE','REVERSAL_YELLOW','REVERSAL_RED')),
  active_trade_entry DOUBLE PRECISION,
  active_trade_direction TEXT,
  details_fa TEXT,
  telegram_sent BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_alerts_created ON price_alerts (created_at DESC);

-- Alert baselines (one row per symbol)
CREATE TABLE IF NOT EXISTS alert_baselines (
  symbol TEXT PRIMARY KEY,
  baseline DOUBLE PRECISION NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- System log persistence (errors retained; token redaction happens before insert)
CREATE TABLE IF NOT EXISTS system_logs (
  id BIGSERIAL PRIMARY KEY,
  level TEXT NOT NULL DEFAULT 'info',
  scope TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_logs_created ON system_logs (created_at DESC);

-- Worker heartbeat: the ONLY source of truth for "24/7 active" claims in the UI
CREATE TABLE IF NOT EXISTS worker_status (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_heartbeat TIMESTAMPTZ,
  last_quote_at TIMESTAMPTZ,
  last_scan_at TIMESTAMPTZ,
  last_tracking_at TIMESTAMPTZ,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO worker_status (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
INSERT INTO telegram_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
