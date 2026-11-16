-- 003: تنظیمات قابل‌تغییر از داشبورد (مثل کلید TwelveData)
-- دلیل: کلید نباید نیاز به ویرایش .env و ری‌استارت داشته باشد.
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
