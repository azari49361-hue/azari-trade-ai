-- Audit trail for scan decisions: every automatic/manual scan stores the first
-- rejection gate (or the generated signal) so the history is queryable without
-- instrumenting the process by hand.

CREATE TABLE IF NOT EXISTS scan_decisions (
  id BIGSERIAL PRIMARY KEY,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  symbol TEXT NOT NULL,
  outcome TEXT NOT NULL, -- 'signal' | 'skipped' | 'deduped' | 'blocked' | 'error'
  gate TEXT,             -- short code of the first rejection gate, e.g. no_cross, wide_spread
  reason TEXT NOT NULL,
  candle_open_time TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_scan_decisions_scanned ON scan_decisions (scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_scan_decisions_gate ON scan_decisions (gate, scanned_at DESC);
