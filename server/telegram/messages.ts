import type { TradeSignal } from '../domain/types';

/**
 * Telegram message templates.
 * Brand wording preserved from the original product.
 * Channel receives ONLY: connection notice, pre-signal and NEW XAUUSD signals.
 * Group receives ONLY: TP1/TP2/TP3/SL hit announcements.
 * Warnings (yellow/red) go to the channel as trade-management alerts.
 */

const TARGET_EMOJIS = ['🎯', '🚀', '🔥', '🏆', '💎', '🥳', '⭐', '👑'];
const PRE_SIGNAL_EMOJIS = ['⚡', '🚀', '🔥', '💎', '🏆', '🎯', '🌟', '⚔️', '🧨', '💥', '⭐', '🎖️', '💪', '🚨'];
const PRE_SIGNAL_PHRASES = [
  'آماده باش!',
  'سیگنال خفن داریم!',
  'فرصت جدید معاملاتی!',
  'چشمت به بازار باشه!',
  'آماده ورود به معامله باشید!',
  'شکار موقعیت طلایی در راه است!',
];

export function randomEmoji(): string {
  return TARGET_EMOJIS[Math.floor(Math.random() * TARGET_EMOJIS.length)];
}

export function randomPreSignal(): { emoji: string; phrase: string } {
  return {
    emoji: PRE_SIGNAL_EMOJIS[Math.floor(Math.random() * PRE_SIGNAL_EMOJIS.length)],
    phrase: PRE_SIGNAL_PHRASES[Math.floor(Math.random() * PRE_SIGNAL_PHRASES.length)],
  };
}

export function channelSignal(sig: TradeSignal): string {
  const icon = sig.type === 'BUY' ? '📈' : '📉';
  // فاصلهٔ حد ضرر تا ورود، هم برحسب واحد قیمت (دلار برای طلا) و هم ضریب ATR —
  // تا قبل از ورود معلوم باشد استاپ چقدر پهن باز شده است.
  const stopDistance = Math.abs(sig.entry - sig.sl);
  const atr = Number(sig.indicators?.atr ?? sig.analysis?.timeframes?.M5?.atr ?? 0);
  const unit = sig.symbol === 'XAUUSD' ? '$' : '';
  const stopDistanceLine =
    `📏 فاصله حد ضرر: ${stopDistance.toFixed(2)}${unit}` +
    (Number.isFinite(atr) && atr > 0 ? ` · ${(stopDistance / atr).toFixed(2)}×ATR` : '') +
    `\n`;
  return (
    `🥇 AZARI TRADE AI\n\n` +
    `📊 نماد: ${sig.symbol}\n` +
    `${icon} نوع معامله: ${sig.type}\n` +
    `🎯 نقطه ورود: ${sig.entry.toFixed(2)}\n` +
    `🛑 حد ضرر: ${Number.isInteger(sig.sl) ? sig.sl.toFixed(0) : sig.sl.toFixed(2)}\n` +
    stopDistanceLine +
    `🥇 TP1: ${sig.tp1.toFixed(2)}\n` +
    `🥈 TP2: ${sig.tp2.toFixed(2)}\n` +
    `🥉 TP3: ${sig.tp3.toFixed(2)}\n` +
    `⚖️ نسبت سود/ضرر: ${sig.rrLabel}\n\n` +
    `⏱ تایم‌فریم: ${sig.timeframe}\n` +
    `📊 تحلیل: ${sig.reason}\n` +
    `🧮 اطمینان الگوریتم: ${sig.confidence}%\n\n` +
    `⏰ تاریخ صدور: ${sig.jalaliDate}\n` +
    `🕒 ساعت صدور: ${sig.tehranTime} (به وقت تهران)`
  );
}

export function preSignal(emoji: string, phrase: string): string {
  return (
    `${emoji} سیگنال جدید در راه است!\n\n` +
    `🎯 نماد: XAU/USD (Gold)\n` +
    `⏳ ۱ دقیقه دیگر سیگنال ارسال می‌شود\n` +
    `${phrase}\n\n` +
    `برای دیدن سیگنال، پین شدن خودکار پیام‌ها را روشن کنید!`
  );
}

/** عدد دلاری با جداکنندهٔ هزارگان؛ فقط برای خط سود/ضرر. */
const usd = (n: number): string => Math.round(Math.abs(n)).toLocaleString('en-US');

/**
 * سود/ضرر دلاری سیگنال بر پایهٔ قرارداد استاندارد (۱ لات = ۱۰۰ اونس).
 * برای BUY حرکت مثبت قیمت و برای SELL حرکت منفی سود است.
 */
export function signalPnlUsd(sig: Pick<TradeSignal, 'type' | 'entry'>, price: number, ozPerLot = 100): number {
  const move = sig.type === 'BUY' ? price - sig.entry : sig.entry - price;
  return move * ozPerLot;
}

export function targetUpdate(
  target: 'TP1' | 'TP2' | 'TP3' | 'SL',
  price: number,
  jalaliDate: string,
  tehranTime: string,
  pnlUsd?: number
): string {
  const emoji = randomEmoji();
  const head: Record<string, string> = {
    TP1: `${emoji} تبریک! هدف اول محقق شد.`,
    TP2: `${emoji} هدف دوم محقق شد!`,
    TP3: `${emoji} تبریک! هدف سوم محقق شد.`,
    SL: `🔴 حد ضرر فعال شد.`,
  };
  const body: Record<string, string> = {
    TP1: '✅ هدف اول با موفقیت لمس شد.',
    TP2: '🔥 معامله به هدف دوم رسید.',
    TP3: '🎉 تمام اهداف سود این سیگنال محقق شدند!',
    SL: '⚠️ حد ضرر معامله طلا لمس شد و پوزیشن بسته شد.',
  };
  let pnlLine = '';
  if (typeof pnlUsd === 'number' && Number.isFinite(pnlUsd)) {
    if (target === 'SL') pnlLine = `📉 ضرر این سیگنال: −${usd(pnlUsd)} دلار (۱ لات)\n\n`;
    else if (target === 'TP3') pnlLine = `💰 سود نهایی این سیگنال: +${usd(pnlUsd)} دلار (۱ لات)\n\n`;
    else pnlLine = `💰 سود تا این هدف: +${usd(pnlUsd)} دلار (۱ لات)\n\n`;
  }
  return (
    `${head[target]}\n\n` +
    `🥇 XAUUSD\n\n` +
    `${target} HIT: ${price.toFixed(2)}\n\n` +
    pnlLine +
    `${body[target]}\n\n` +
    `⏰ تاریخ: ${jalaliDate}\n` +
    `🕒 ساعت: ${tehranTime} (به وقت تهران)`
  );
}

export function protectionWarning(stage: 'YELLOW' | 'RED', sig: TradeSignal, jalaliDate: string, tehranTime: string): string {
  const currDirFa = sig.type === 'BUY' ? 'خرید (Long) 🟢' : 'فروش (Short) 🔴';
  if (stage === 'RED') {
    return (
      `🛑 هشدار بستن معامله — Azari Trade AI\n\n` +
      `⏰ معامله فعلی شما در خطر تغییر جهت است!\n` +
      `نماد: XAU/USD (Gold)\n` +
      `جهت فعلی: ${currDirFa}\n` +
      `سطح ورود شما: ${sig.entry.toFixed(2)}\n` +
      `⚠️ سیگنال مخالف در حال شکل‌گیری است — معامله خود را مدیریت کنید\n` +
      `(حد ضرر یا خروج دستی را در نظر بگیرید)\n\n` +
      `⏰ زمان هشدار: ${jalaliDate} ساعت ${tehranTime} (تهران)`
    );
  }
  return (
    `🟡 هشدار اولیه مدیریت معامله — Azari Trade AI\n\n` +
    `⚠️ احتمال تغییر جهت روند در طلا!\n` +
    `نماد: XAU/USD (Gold)\n` +
    `جهت فعلی: ${currDirFa}\n` +
    `سطح ورود شما: ${sig.entry.toFixed(2)}\n` +
    `📊 وضعیت اندیکاتورها: فشرده شدن میانگین‌ها و تمایل مومنتوم به جهت مخالف (تغییر جهت در حال مشاهده)\n` +
    `💡 توصیه: حد ضرر را ریسک‌فری کرده یا سیو سود انجام دهید.\n\n` +
    `⏰ زمان هشدار: ${jalaliDate} ساعت ${tehranTime} (تهران)`
  );
}

export function connectChannel(jalaliDate: string, tehranTime: string): string {
  return (
    `✅ کانال با موفقیت به سیستم Azari Trade AI متصل شد.\n\n` +
    `📢 از این پس تمام سیگنال‌های جدید طلا (XAUUSD) در این کانال منتشر خواهند شد.\n\n` +
    `⏰ زمان اتصال: ${jalaliDate} ساعت ${tehranTime} (تهران)`
  );
}

/** اتصال چت شخصی مالک — فقط برای هشدارهای فنی/سلامت داده. */
export function connectAdmin(jalaliDate: string, tehranTime: string): string {
  return (
    `✅ چت شخصی شما به هشدارهای فنی Azari Trade AI متصل شد.\n\n` +
    `🩺 از این پس اگر داده کندل بیش از ۱۰ دقیقه کهنه شود، همین‌جا خبر می‌دهم (و بعد از برگشت داده هم اطلاع می‌دهم).\n\n` +
    `⏰ زمان اتصال: ${jalaliDate} ساعت ${tehranTime} (تهران)`
  );
}

export function testChannelSignal(jalaliDate: string, tehranTime: string): string {
  return (
    `🧪 پیام آزمایشی — Azari Trade AI\n\n` +
    `این پیام صرفاً تست ارسال به کانال است و سیگنال واقعی نیست.\n\n` +
    `⏰ ${jalaliDate} ساعت ${tehranTime} (تهران)`
  );
}

export function testTargetUpdate(target: string, jalaliDate: string, tehranTime: string): string {
  return (
    `🧪 پیام آزمایشی — Azari Trade AI\n\n` +
    `تست ارسال پیام ${target} به کانال (بدون هیچ معامله واقعی).\n\n` +
    `⏰ ${jalaliDate} ساعت ${tehranTime} (تهران)`
  );
}
