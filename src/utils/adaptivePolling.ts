import { useEffect, useRef, useState } from 'react';
import { nextDelayMs, pickTargetMs, type TargetDelayOptions } from './pollingPolicy';

export { MAX_DELAY_MS, nextDelayMs, pickTargetMs } from './pollingPolicy';

/**
 * پولینگ تطبیقی برای داشبورد موبایل — کاهش مصرف باتری و دادهٔ همراه.
 *
 * قواعد:
 *  - تب پنهان → هیچ درخواستی زده نمی‌شود (با برگشت به تب، فوراً یک‌بار تازه‌سازی).
 *  - بازار بسته → فاصله‌ها چند برابر می‌شوند (قیمت تازه هم نمی‌آید).
 *  - گوشی (عرض ≤ 640) → فاصلهٔ پایهٔ بلندتر برای درخواست‌های پرتکرار.
 *  - Save-Data یا شبکهٔ 2G → همهٔ فاصله‌ها ۴ برابر.
 *  - خطای پیاپی → عقب‌نشینی نمایی تا سقف ۶۰ ثانیه، بعد از موفقیت ریست می‌شود.
 *  - هیچ درخواست هم‌پوشانی ندارد: تا پاسخ قبلی نرسیده، تیک بعدی زمان‌بندی نمی‌شود.
 */

/** Save-Data یا شبکهٔ 2G (کند) → حالت کم‌مصرف */
export function isSlowNetwork(): boolean {
  if (typeof navigator === 'undefined') return false;
  const conn = (navigator as unknown as {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  if (!conn) return false;
  if (conn.saveData === true) return true;
  return typeof conn.effectiveType === 'string' && /(^|-)2g$/.test(conn.effectiveType);
}

export function isSmallScreen(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(max-width: 640px)').matches;
}

export interface AdaptivePollingOptions extends Omit<TargetDelayOptions, 'mobile'> {
  enabled?: boolean;
}

/**
 * تابع `task` باید `false` برگرداند وقتی درخواست شکست خورده تا عقب‌نشینی فعال شود.
 * مقدار `undefined` یا `true` یعنی موفق.
 */
export function useAdaptivePolling(
  task: () => Promise<boolean | void> | boolean | void,
  { enabled = true, ...options }: AdaptivePollingOptions
): void {
  const { activeMs, idleMs, mobileMs, active } = options;

  const taskRef = useRef(task);
  taskRef.current = task;

  const [visible, setVisible] = useState<boolean>(() =>
    typeof document === 'undefined' ? true : !document.hidden
  );
  const [mobile, setMobile] = useState<boolean>(() => isSmallScreen());
  const [slow, setSlow] = useState<boolean>(() => isSlowNetwork());

  useEffect(() => {
    const onVisibility = () => setVisible(!document.hidden);
    const onEnvironmentChange = () => {
      setMobile(isSmallScreen());
      setSlow(isSlowNetwork());
    };

    document.addEventListener('visibilitychange', onVisibility);
    const conn = (navigator as unknown as {
      connection?: {
        addEventListener?: (type: string, cb: () => void) => void;
        removeEventListener?: (type: string, cb: () => void) => void;
      };
    }).connection;
    conn?.addEventListener?.('change', onEnvironmentChange);
    window.addEventListener('resize', onEnvironmentChange);
    window.addEventListener('online', onEnvironmentChange);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      conn?.removeEventListener?.('change', onEnvironmentChange);
      window.removeEventListener('resize', onEnvironmentChange);
      window.removeEventListener('online', onEnvironmentChange);
    };
  }, []);

  const target = pickTargetMs({ activeMs, idleMs, mobileMs, active, mobile });

  useEffect(() => {
    if (!enabled || !visible) return;

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;

    const tick = async () => {
      let ok = true;
      try {
        ok = (await taskRef.current()) !== false;
      } catch {
        ok = false;
      }
      failures = ok ? 0 : Math.min(failures + 1, 4);
      if (stopped) return;
      timer = setTimeout(() => void tick(), nextDelayMs(target, failures, slow));
    };

    void tick(); // تازه‌سازی فوری وقتی تب دوباره دیده می‌شود یا وضعیت بازار عوض می‌شود

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, visible, target, slow]);
}
