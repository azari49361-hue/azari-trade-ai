/**
 * سیاست خالص پولینگ تطبیقی — بدون DOM و بدون React، تا در تست‌های Node هم قابل import باشد.
 * قلاب React در `adaptivePolling.ts` از همین توابع استفاده می‌کند.
 */

export const MAX_DELAY_MS = 60_000;

export interface TargetDelayOptions {
  /** فاصله وقتی بازار باز و تب دیده می‌شود */
  activeMs: number;
  /** فاصله وقتی بازار بسته است (پیش‌فرض: ۶ برابر activeMs) */
  idleMs?: number;
  /** فاصله روی صفحهٔ کوچک (اگر نباشد، activeMs) */
  mobileMs?: number;
  active: boolean;
  mobile: boolean;
}

/** فاصلهٔ پایهٔ تیک بعدی، بر اساس وضعیت بازار و اندازهٔ صفحه */
export function pickTargetMs(options: TargetDelayOptions): number {
  const { activeMs, idleMs, mobileMs, active, mobile } = options;
  const base = mobile && mobileMs ? mobileMs : activeMs;
  if (active) return base;
  return idleMs ?? base * 6;
}

/**
 * تأخیر واقعی تیک بعدی: ضریب شبکهٔ کند + عقب‌نشینی نمایی روی خطاهای پیاپی.
 * `failures` تعداد خطاهای پیاپی است (۰ = آخرین درخواست موفق بود).
 */
export function nextDelayMs(baseMs: number, failures: number, slowNetwork: boolean): number {
  const networkFactor = slowNetwork ? 4 : 1;
  const backoff = failures > 0 ? 2 ** Math.min(failures, 3) : 1;
  return Math.min(MAX_DELAY_MS, Math.round(baseMs * networkFactor * backoff));
}
