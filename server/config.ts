import 'dotenv/config';

/**
 * Central configuration.
 * FAIL-FAST policy: missing required values abort startup with a clear message.
 * No secret has a hardcoded fallback — by design.
 */

function required(name: string): string {
  const v = (process.env[name] || '').trim();
  if (!v) {
    console.error(
      `\n[FATAL] متغیر محیطی ${name} تنظیم نشده است.\n` +
        `این مقدار اجباری است و هیچ مقدار پیش‌فرضی در کد وجود ندارد (الزام امنیتی).\n` +
        `فایل .env را از روی .env.example بسازید و مقدار بگذارید. جزئیات: docs/SETUP.md\n`
    );
    process.exit(1);
  }
  return v;
}

function optional(name: string, fallback = ''): string {
  return (process.env[name] || '').trim() || fallback;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function nonNegativeIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function floatEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? parseFloat(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const config = {
  port: intEnv('PORT', 3000),
  isProduction: process.env.NODE_ENV === 'production',

  /**
   * آدرس عمومی سایت برای پیش‌نمایش لینک (Open Graph).
   * اگر خالی باشد از هدرهای همان درخواست ساخته می‌شود؛ پشت پراکسی معکوس بهتر است صریح تنظیم شود.
   */
  publicBaseUrl: optional('PUBLIC_BASE_URL'),

  /**
   * اگر صفحهٔ داشبورد روی دامنهٔ دیگری (مثلاً میزبان استاتیک) و بک‌اند جای دیگری است،
   * دامنهٔ صفحه را اینجا بگذارید (چندتا را با کاما جدا کنید). خالی = فقط همان origin (پیش‌فرض امن).
   * نمونه: CORS_ORIGIN=https://my-site.netlify.app
   */
  corsOrigins: optional('CORS_ORIGIN')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean),


  /** Database */
  databaseUrl: required('DATABASE_URL'),

  /** Data sources (priority order) */
  metaapi: {
    token: optional('METAAPI_TOKEN'),
    accountId: optional('METAAPI_ACCOUNT_ID'),
    restHost: optional('METAAPI_REST_HOST', 'https://mt-client-api-v1.new-york.agiliumtrade.ai'),
    get configured(): boolean {
      return Boolean(this.token && this.accountId);
    },
  },
  twelvedata: {
    apiKey: optional('TWELVEDATA_API_KEY'),
    /**
     * حداقل فاصله بین دو درخواست TwelveData. پلن رایگان ۸ درخواست در دقیقه دارد؛ با پولینگ ۵ ثانیه‌ای
     * برای ۴ نماد، بدون این محدودیت کلید فوراً ۴۲۹ می‌گیرد. ۰ = بدون محدودیت (پلن پولی).
     */
    minIntervalMs: nonNegativeIntEnv('TWELVEDATA_MIN_INTERVAL_SECONDS', 60) * 1000,
    get configured(): boolean {
      return Boolean(this.apiKey);
    },
  },
  biquote: {
    enabled: optional('BIQUOTE_ENABLED', 'true').toLowerCase() !== 'false',
  },

  /** جستجوی وب Exa (اختیاری) — برای غنی‌سازی تحلیل با اخبار و منابع بیرونی */
  exa: {
    apiKey: optional('EXA_API_KEY'),
    get configured(): boolean {
      return Boolean(this.apiKey);
    },
  },

  /** Telegram (token may also be set from dashboard; env is the initial bootstrap) */
  telegram: {
    botToken: optional('TELEGRAM_BOT_TOKEN'),
    channelId: optional('TELEGRAM_CHANNEL_ID'),
    /** چت شخصی مالک — هشدارهای فنی (مثل کهنه شدن داده کندل) فقط به این چت می‌رود. */
    adminChatId: optional('TELEGRAM_ADMIN_CHAT_ID'),
  },

  /** گزارش دوره‌ای کانال (بدون سیگنال) */
  report: {
    enabled: optional('REPORT_ENABLED', 'true').toLowerCase() !== 'false',
    /** فاصله ارسال گزارش به کانال (ساعت) — پیش‌فرض ۳ */
    intervalHours: intEnv('REPORT_INTERVAL_HOURS', 3),
    /** نرخ دستی دلار به تومان؛ ۰ = خط تومان در گزارش نمایش داده نمی‌شود */
    usdTomanRate: nonNegativeIntEnv('USD_TOMAN_RATE', 0),
  },

  /** خلاصهٔ روزانهٔ خبرهای بازار برای کانال */
  newsDigest: {
    enabled: optional('NEWS_DIGEST_ENABLED', 'true').toLowerCase() !== 'false',
    /** ساعت ارسال به وقت تهران */
    hourTehran: Math.min(23, intEnv('NEWS_DIGEST_HOUR', 8)),
    /** لینک کانال که پای هر پیام خبری می‌آید */
    channelUrl: optional('TELEGRAM_CHANNEL_URL', 'https://t.me/Azari_Trade_AI_Channel'),
  },

  /** Engine behavior */
  engine: {
    // Sized for the M5 primary timeframe: cooldown prevents clustered low-quality re-entries.
    goldCooldownMs: intEnv('GOLD_COOLDOWN_SECONDS', 600) * 1000,
    symbolCooldownMs: intEnv('SYMBOL_COOLDOWN_SECONDS', 600) * 1000,
    quoteMaxAgeMs: intEnv('QUOTE_MAX_AGE_SECONDS', 300) * 1000,
    /** حداکثر نسبت اسپرد به ATR کندل پنج‌دقیقه برای صدور سیگنال (پیش‌فرض سخت‌گیرانه‌تر برای کیفیت ورود) */
    maxSpreadAtrRatio: floatEnv('MAX_SPREAD_ATR_RATIO', 0.13),
    /** چرخه اسکن خودکار — متناسب با M5، پیش‌فرض ۱۵ ثانیه */
    scanIntervalMs: intEnv('SCAN_INTERVAL_SECONDS', 15) * 1000,
    /** فاصله پیش‌سیگنال تا ارسال سیگنال اصلی (متناسب با M5، پیش‌فرض ۱۵ ثانیه) */
    preSignalDelayMs: intEnv('PRE_SIGNAL_DELAY_SECONDS', 15) * 1000,
    /** اگر کندل بسته‌ی M5 بیشتر از این مدت کهنه باشد، هشدار فنی به تلگرام مالک می‌رود (پیش‌فرض ۱۰ دقیقه) */
    candleStaleAfterMs: intEnv('CANDLE_STALE_ALERT_SECONDS', 600) * 1000,
    /** اگر بیشتر از این مدت هیچ اسکنی کامل نشود، هشدار «اسکن متوقف» به مالک می‌رود (پیش‌فرض ۳ دقیقه) */
    scanStallAlertMs: intEnv('SCAN_STALL_ALERT_SECONDS', 180) * 1000,
    /** سقف زمان یک اسکن؛ بعد از آن قفل اجرای اسکن آزاد و اسکن بعدی شروع می‌شود (پیش‌فرض ۹۰ ثانیه) */
    scanTimeoutMs: intEnv('SCAN_TIMEOUT_SECONDS', 90) * 1000,
  },
};

export const SYMBOLS = ['XAUUSD', 'XAGUSD', 'USOIL', 'DXY'] as const;
export type SymbolCode = (typeof SYMBOLS)[number];

export const SYMBOL_NAMES_FA: Record<SymbolCode, string> = {
  XAUUSD: 'طلا (XAU/USD)',
  XAGUSD: 'نقره (XAG/USD)',
  USOIL: 'نفت WTI (USOIL)',
  DXY: 'شاخص دلار (DXY)',
};

/** Decimal digits per symbol — single source of truth for the whole app (UI + engine). */
export const SYMBOL_DIGITS: Record<SymbolCode, number> = {
  XAUUSD: 2,
  XAGUSD: 3,
  USOIL: 3,
  DXY: 3,
};

/** Alert step per symbol (price move that triggers a dashboard/telegram price alert). */
export const ALERT_STEPS: Record<SymbolCode, number> = {
  XAUUSD: 10.0,
  XAGUSD: 0.5,
  USOIL: 1.0,
  DXY: 0.1,
};

export function normalizeSymbol(sym: string): SymbolCode | null {
  if (!sym) return null;
  const clean = sym.trim().toUpperCase();
  if (clean === 'GOLD' || clean.startsWith('XAU')) return 'XAUUSD';
  if (clean === 'SILVER' || clean.startsWith('XAG')) return 'XAGUSD';
  if (clean === 'OIL' || clean === 'WTI' || clean.startsWith('USOIL') || clean.startsWith('CL')) return 'USOIL';
  if (clean === 'USD' || clean.startsWith('DXY') || clean.startsWith('DX')) return 'DXY';
  return (SYMBOLS as readonly string[]).includes(clean) ? (clean as SymbolCode) : null;
}
