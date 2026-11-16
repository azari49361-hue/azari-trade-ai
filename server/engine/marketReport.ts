import { config } from '../config';
import { log } from '../lib/logger';
import { formatPersianDateTime } from '../lib/time';
import { fetchAnyLatest, type AnyQuote } from '../sources/biquote';
import { fetchGlobalRates, type GlobalRates } from '../lib/globalRates';
import { fetchTomanRate, type TomanRate } from '../lib/tomanRate';
import * as telegram from '../telegram/client';

/**
 * گزارش دوره‌ای بازار برای کانال تلگرام (بدون سیگنال).
 *
 * دو بخش دارد:
 *  ۱) قیمت طبق فید متاتریدر ۵ (بروکر) — ۱۰ نماد مهم، لحظه‌ای
 *  ۲) نرخ مرجع بازار جهانی (ECB) — برابری‌های روزانه، برای مقایسه
 *
 * هیچ عددی ساخته نمی‌شود: هر نمادی که منبع برایش قیمت نداد با «—» می‌آید.
 */

export interface ReportInstrument {
  symbol: string;
  nameFa: string;
  emoji: string;
  digits: number;
}

/** ۱۰ نماد مهمی که فید بروکر برایشان قیمت می‌دهد. */
export const REPORT_INSTRUMENTS: readonly ReportInstrument[] = [
  { symbol: 'XAUUSD', nameFa: 'طلا (اونس)', emoji: '🥇', digits: 2 },
  { symbol: 'XAGUSD', nameFa: 'نقره (اونس)', emoji: '🥈', digits: 3 },
  { symbol: 'USOIL', nameFa: 'نفت WTI', emoji: '🛢', digits: 3 },
  { symbol: 'DXY', nameFa: 'شاخص دلار', emoji: '📉', digits: 3 },
  { symbol: 'EURUSD', nameFa: 'یورو / دلار', emoji: '💶', digits: 5 },
  { symbol: 'GBPUSD', nameFa: 'پوند / دلار', emoji: '💷', digits: 5 },
  { symbol: 'USDJPY', nameFa: 'دلار / ین', emoji: '💴', digits: 3 },
  { symbol: 'USDCHF', nameFa: 'دلار / فرانک', emoji: '🇨🇭', digits: 5 },
  { symbol: 'AUDUSD', nameFa: 'دلار استرالیا / دلار', emoji: '🇦🇺', digits: 5 },
  { symbol: 'USDCAD', nameFa: 'دلار کانادا / دلار', emoji: '🇨🇦', digits: 5 },
];

/**
 * ۱۰ برابری بخش ۲ — همه از نرخ‌های مرجع USD محاسبه می‌شوند (بدون دادهٔ ساختگی).
 * فرمول: value = (invert ? 1/r[code] : r[code]) * (times ? r[times] : 1) / (divBy ? r[divBy] : 1)
 */
export interface GlobalPair {
  symbol: string;
  nameFa: string;
  emoji: string;
  digits: number;
  code: string;
  invert?: boolean;
  times?: string;
  divBy?: string;
}

export const GLOBAL_PAIRS: readonly GlobalPair[] = [
  { symbol: 'EURUSD', nameFa: 'یورو / دلار', emoji: '💶', digits: 5, code: 'EUR', invert: true },
  { symbol: 'GBPUSD', nameFa: 'پوند / دلار', emoji: '💷', digits: 5, code: 'GBP', invert: true },
  { symbol: 'USDJPY', nameFa: 'دلار / ین', emoji: '💴', digits: 3, code: 'JPY' },
  { symbol: 'USDCHF', nameFa: 'دلار / فرانک', emoji: '🇨🇭', digits: 5, code: 'CHF' },
  { symbol: 'AUDUSD', nameFa: 'دلار استرالیا / دلار', emoji: '🇦🇺', digits: 5, code: 'AUD', invert: true },
  { symbol: 'USDCAD', nameFa: 'دلار کانادا / دلار', emoji: '🇨🇦', digits: 5, code: 'CAD' },
  { symbol: 'EURJPY', nameFa: 'یورو / ین', emoji: '🇪🇺', digits: 3, code: 'EUR', invert: true, times: 'JPY' },
  { symbol: 'GBPJPY', nameFa: 'پوند / ین', emoji: '🇬🇧', digits: 3, code: 'GBP', invert: true, times: 'JPY' },
  { symbol: 'EURGBP', nameFa: 'یورو / پوند', emoji: '⚖️', digits: 5, code: 'GBP', divBy: 'EUR' },
  { symbol: 'AUDJPY', nameFa: 'دلار استرالیا / ین', emoji: '🇦🇺', digits: 3, code: 'AUD', invert: true, times: 'JPY' },
];

/** مقدار یک برابری از نرخ‌های مرجع؛ هر جزء ناموجود → null. */
export function pairValue(pair: GlobalPair, rates: Record<string, number>): number | null {
  const base = rates[pair.code];
  if (!base || !Number.isFinite(base) || base <= 0) return null;
  let value = pair.invert ? 1 / base : base;
  if (pair.times) {
    const t = rates[pair.times];
    if (!t || !Number.isFinite(t)) return null;
    value *= t;
  }
  if (pair.divBy) {
    const d = rates[pair.divBy];
    if (!d || !Number.isFinite(d) || d <= 0) return null;
    value /= d;
  }
  return value;
}

export function formatPrice(value: number | null | undefined, digits: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/** یک اونس تروی = ۳۱.۱۰۳۴۷۶۸ گرم */
export const OUNCE_GRAMS = 31.1034768;
/** عیار استاندارد بازار ایران */
export const KARAT_18_FACTOR = 0.75;

/** معادل تومانی یک اونس کامل طلا (انس جهانی × نرخ دلار). */
export function ounceToToman(ounceUsd: number | null | undefined, tomanRate: number): number | null {
  if (!ounceUsd || !Number.isFinite(ounceUsd) || ounceUsd <= 0) return null;
  if (!Number.isFinite(tomanRate) || tomanRate <= 0) return null;
  return Math.round(ounceUsd * tomanRate);
}

/**
 * معادل تومانی گرم طلای ۱۸ عیار:
 * انس دلاری × نرخ دلار ÷ ۳۱.۱۰۳۵ × ۰.۷۵ (عیار ۱۸ از ۲۴)
 * این عدد «محاسبه‌شده» است، نه نرخ بازار محلی؛ اجرت/مالیات/حباب در آن نیست.
 */
export function gram18ToToman(ounceUsd: number | null | undefined, tomanRate: number): number | null {
  const ounce = ounceToToman(ounceUsd, tomanRate);
  if (ounce === null) return null;
  return Math.round((ounce / OUNCE_GRAMS) * KARAT_18_FACTOR);
}

/** مقدار هر برابری از نرخ مرجع (USD → X). */
export function globalValue(rate: number | undefined, invert: boolean): number | null {
  if (!rate || !Number.isFinite(rate) || rate <= 0) return null;
  return invert ? 1 / rate : rate;
}

export interface ReportTextInput {
  now: Date;
  feed: Record<string, AnyQuote>;
  rates: GlobalRates | null;
  /** نرخ دستی دلار/تومان (فقط پشتیبان وقتی منبع خودکار پاسخ نمی‌دهد) */
  tomanRate?: number;
  /** نرخ خودکار دلار/تومان از منابع بازار */
  toman?: TomanRate | null;
  intervalHours?: number;
}

const SEP = '━━━━━━━━━━━━━━━━━━';

export function buildReportText(input: ReportTextInput): string {
  const { now, feed, rates } = input;
  const fmt = formatPersianDateTime(now, 'Asia/Tehran');
  const interval = input.intervalHours ?? config.report.intervalHours;
  const intervalFa = interval.toLocaleString('fa-IR');
  const lines: string[] = [];

  lines.push(`📊 گزارش ${intervalFa} ساعته بازار`);
  lines.push(`🗓 ${fmt.jalaliDate} — ساعت ${fmt.time24} (تهران)`);
  lines.push('');

  // ---------- بخش ۱ : فید MT5 بروکر ----------
  const firstSource = REPORT_INSTRUMENTS.map((i) => feed[i.symbol]?.source).find(Boolean);
  lines.push(SEP);
  lines.push('🏦 بخش ۱ — قیمت طبق فید متاتریدر ۵');
  lines.push(firstSource ? `منبع: ${firstSource}` : 'منبع: در این لحظه پاسخی نداد');
  lines.push(SEP);
  for (const inst of REPORT_INSTRUMENTS) {
    const q = feed[inst.symbol];
    const price = formatPrice(q?.mid, inst.digits);
    const suffix = q?.stale || q?.marketState === 'closed' ? ' ⏸' : '';
    lines.push(`${inst.emoji} ${inst.nameFa} (${inst.symbol}): ${price}${suffix}`);
  }
  lines.push('');

  // ---------- بخش ۲ : نرخ مرجع جهانی ----------
  lines.push(SEP);
  lines.push('🌍 بخش ۲ — نرخ مرجع بازار جهانی (ECB)');
  if (rates) {
    lines.push(`تاریخ نرخ‌ها: ${rates.date || 'نامشخص'} — برابری‌های محاسبه‌شده از USD`);
    lines.push(SEP);
    for (const pair of GLOBAL_PAIRS) {
      const value = pairValue(pair, rates.rates);
      lines.push(`${pair.emoji} ${pair.nameFa} (${pair.symbol}): ${formatPrice(value, pair.digits)}`);
    }
    lines.push('');
    lines.push('ℹ️ نرخ بخش ۲ روزانه است و طبیعتاً چند پیپ با فید لحظه‌ای بروکر اختلاف دارد.');
  } else {
    lines.push('⚠️ در این لحظه نرخ مرجع جهانی در دسترس نیست (اتصال به ECB برقرار نشد).');
  }

  // ---------- تومان: نرخ خودکار بازار، وگرنه نرخ دستی پشتیبان ----------
  const auto = input.toman ?? null;
  const manual = input.tomanRate ?? config.report.usdTomanRate;
  lines.push('');
  if (auto) {
    const label = auto.kind === 'usd' ? 'دلار بازار آزاد' : 'تتر (جایگزین دلار) — منبع اصلی نرخ نبود';
    lines.push(`💵 ${label}: ${new Intl.NumberFormat('en-US').format(auto.rate)} تومان`);
    const t = formatPersianDateTime(auto.at, 'Asia/Tehran');
    lines.push(`   منبع: ${auto.source}${t.time24 ? ` · ${t.time24} (تهران)` : ''}`);
  } else if (manual > 0) {
    lines.push(`💵 دلار آمریکا: ${new Intl.NumberFormat('en-US').format(manual)} تومان (نرخ دستی — منبع خودکار در دسترس نبود)`);
  } else {
    lines.push('⚠️ نرخ دلار/تومان در دسترس نیست (هیچ منبع نرخی پاسخ نداد).');
  }

  // ---------- معادل تومانی طلا (انس و گرم ۱۸ عیار) ----------
  const effectiveRate = auto ? auto.rate : manual > 0 ? manual : 0;
  const goldUsd = feed['XAUUSD']?.mid ?? null;
  if (effectiveRate > 0 && goldUsd) {
    const ounceToman = ounceToToman(goldUsd, effectiveRate);
    const gram18 = gram18ToToman(goldUsd, effectiveRate);
    const fmtToman = (n: number) => new Intl.NumberFormat('en-US').format(n);
    if (ounceToman !== null) lines.push(`🥇 انس جهانی طلا: ${fmtToman(ounceToman)} تومان`);
    if (gram18 !== null) lines.push(`🥇 گرم طلای ۱۸ عیار: ${fmtToman(gram18)} تومان`);
    lines.push('   ℹ️ محاسبه از انس جهانی × نرخ دلار ÷ ۳۱.۱۰۳۵ گرم × عیار ۱۸ — بدون اجرت، مالیات و حباب بازار محلی.');
  } else if (!goldUsd) {
    lines.push('⚠️ معادل تومانی طلا محاسبه نشد (قیمت انس از منبع نیامد).');
  }

  lines.push('');
  lines.push(`⏰ گزارش بعدی هر ${intervalFa} ساعت، به وقت تهران`);
  return lines.join('\n');
}

/** ساخت متن گزارش با دادهٔ واقعی منابع. */
export async function buildMarketReport(now: Date = new Date()): Promise<string> {
  const [feed, rates, toman] = await Promise.all([
    fetchAnyLatest(REPORT_INSTRUMENTS.map((i) => i.symbol)),
    fetchGlobalRates(),
    fetchTomanRate(),
  ]);
  if (feed.errors.length > 0) {
    log('warn', 'MarketReport', `برخی قیمت‌ها نیامد: ${feed.errors.join(' | ')}`);
  }
  if (!toman) log('warn', 'MarketReport', 'نرخ دلار/تومان از هیچ منبعی نیامد.');
  return buildReportText({ now, feed: feed.quotes, rates, toman });
}

export interface ReportSendResult {
  ok: boolean;
  description?: string;
  text: string;
}

export async function sendMarketReport(now: Date = new Date()): Promise<ReportSendResult> {
  const text = await buildMarketReport(now);
  if (!telegram.isConnected()) {
    return { ok: false, description: 'تلگرام تنظیم نشده است.', text };
  }
  const res = await telegram.sendRawToChannel(text);
  if (res.ok) log('info', 'MarketReport', 'گزارش دوره‌ای بازار به کانال ارسال شد.');
  else log('error', 'MarketReport', `ارسال گزارش به کانال ناموفق: ${res.description}`);
  return { ok: res.ok, description: res.description, text };
}

/**
 * فاصله تا اسلات بعدی (ساعت‌های ۰/۳/۶/۹/۱۲/۱۵/۱۸/۲۱ به وقت تهران).
 * تهران UTC+3:30 است (بدون تغییر ساعت تابستانی).
 */
export const TEHRAN_OFFSET_MIN = 210;

export function nextSlotDelayMs(nowMs: number, slotHours: number, offsetMin = TEHRAN_OFFSET_MIN): number {
  const slotMs = Math.max(1, slotHours) * 3_600_000;
  const local = nowMs + offsetMin * 60_000;
  const next = Math.floor(local / slotMs) * slotMs + slotMs;
  return next - local;
}

let timer: NodeJS.Timeout | null = null;

export function startMarketReport(): void {
  if (!config.report.enabled) {
    log('info', 'MarketReport', 'گزارش دوره‌ای غیرفعال است (REPORT_ENABLED=false).');
    return;
  }
  const interval = config.report.intervalHours;

  const schedule = () => {
    const delay = nextSlotDelayMs(Date.now(), interval);
    log(
      'info',
      'MarketReport',
      `گزارش بعدی ${Math.round(delay / 60_000)} دقیقه دیگر (هر ${interval} ساعت، ساعت‌های ۰/${interval}/${interval * 2}… تهران)`
    );
    timer = setTimeout(async () => {
      try {
        await sendMarketReport();
      } catch (e: any) {
        log('error', 'MarketReport', `ارسال گزارش شکست خورد: ${e?.message}`);
      } finally {
        schedule();
      }
    }, delay);
    timer.unref?.();
  };

  schedule();
}

/** فقط برای تست/خاموشی. */
export function stopMarketReport(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}
