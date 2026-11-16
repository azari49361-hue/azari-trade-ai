-- Personal (owner) Telegram chat for technical health alerts (stale candle data, feed problems).
-- Optional: empty means health alerts are skipped. Existing installs get the column added here.
ALTER TABLE telegram_settings ADD COLUMN IF NOT EXISTS admin_chat_id TEXT NOT NULL DEFAULT '';
