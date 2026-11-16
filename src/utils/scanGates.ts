/**
 * برچسب‌های فارسی دروازه‌های اسکن — مشترک بین پنل تاریخچه و مسیر هر سیگنال.
 * کدها همان مقادیری هستند که موتور در ستون gate ذخیره می‌کند.
 */

export const GATE_LABELS: Record<string, string> = {
  no_cross: 'بدون تقاطع EMA 9/21',
  cooldown: 'کول‌داون سیگنال',
  no_quote: 'قیمت در دسترس نیست',
  stale_quote: 'قیمت کهنه',
  wide_spread: 'اسپرد وسیع',
  stale_candle: 'کندل تصمیم کهنه',
  candle_body: 'بدنهٔ کندل کم',
  candle_direction: 'جهت کندل مخالف',
  ema_slope: 'شیب EMA21 مخالف',
  ema_strength: 'قدرت EMA کم',
  rsi: 'RSI در ناحیهٔ مجاز نیست',
  spread_atr: 'اسپرد نسبت به ATR',
  h4_unconfirmed: 'روند H4 تأیید نشد',
  h4_misaligned: 'خلاف روند H4',
  m15_data: 'دادهٔ M15 کافی نیست',
  m15_misaligned: 'خلاف ساختار M15',
  h1_data: 'دادهٔ H1 کافی نیست',
  h1_misaligned: 'خلاف ساختار H1',
  confidence: 'امتیاز کیفیت کم',
  dedupe: 'سیگنال تکراری',
  error: 'خطای داخلی',
  market_closed: 'بازار بسته',
};

export const gateLabel = (gate: string | null | undefined): string =>
  gate ? GATE_LABELS[gate] || gate : '—';

export const OUTCOME_VIEW: Record<string, { label: string; cls: string }> = {
  signal: { label: 'سیگنال صادر شد', cls: 'bg-[#238636]/20 text-[#3fb950] border-[#238636]/40' },
  skipped: { label: 'رد شد', cls: 'bg-[#d29922]/15 text-[#e3b341] border-[#d29922]/35' },
  deduped: { label: 'تکراری', cls: 'bg-[#21262d] text-[#8b949e] border-[#30363d]' },
  blocked: { label: 'متوقف', cls: 'bg-[#21262d] text-[#8b949e] border-[#30363d]' },
  error: { label: 'خطا', cls: 'bg-[#da3633]/20 text-[#f85149] border-[#da3633]/40' },
};
