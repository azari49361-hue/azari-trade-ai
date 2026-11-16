-- 005: ستون app_settings.value باید TEXT باشد.
-- دلیل: 001 جدول را با value JSONB ساخت و 003 (که TEXT می‌خواست) چون
-- CREATE TABLE IF NOT EXISTS بود، بی‌اثر ماند. نتیجه: ذخیرهٔ کلید از داشبورد
-- با خطای 22P02 (invalid input syntax for type json) شکست می‌خورد و کلید
-- هیچ‌وقت در دیتابیس نمی‌ماند. این مایگریشن نوع ستون را اصلاح می‌کند.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'app_settings'
       AND column_name = 'value'
       AND data_type = 'jsonb'
  ) THEN
    ALTER TABLE app_settings
      ALTER COLUMN value TYPE TEXT
      USING (
        CASE
          WHEN jsonb_typeof(value) = 'string' THEN value #>> '{}'
          ELSE value::text
        END
      );
  END IF;
END $$;

-- مقدار پیش‌فرض برای درج‌های بعدی (ستون‌های قدیمی بدون default بودند)
ALTER TABLE app_settings ALTER COLUMN value SET DEFAULT '';
