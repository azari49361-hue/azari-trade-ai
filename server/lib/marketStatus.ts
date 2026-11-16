import { getNextMondayOpenTehranString, getNewYorkParts, formatPersianDateTime, authoritativeNow } from './time';

/**
 * Authoritative forex market status.
 * A day-name check alone is NOT enough (requirement), so this also considers:
 *  - Friday 17:00 New York weekly close (DST aware),
 *  - freshness of the actual price feed (stale feed = connection considered lost),
 *  - broker-reported market state (symbol-level close).
 */

export interface MarketStatus {
  isOpen: boolean;
  isWeekend: boolean;
  isSaturdayOrSunday: boolean;
  isDataFresh: boolean;
  reasonFa: string;
  dayFa: string;
  currentDayName: string;
  nyTimeStr: string;
  tehranTimeStr: string;
  nextOpenFa: string;
}

export interface MarketStatusInput {
  /** Age of the last successful quote fetch in ms; Infinity if never fetched. */
  dataAgeMs: number;
  /** Broker (e.g. MetaApi/biquote) reported the symbol as closed. */
  brokerClosed: boolean;
}

const DAY_FA: Record<string, string> = {
  Sat: 'شنبه (تعطیل رسمی فارکس)',
  Sun: 'یکشنبه (تعطیل رسمی فارکس)',
  Mon: 'دوشنبه (روز معاملاتی)',
  Tue: 'سه‌شنبه (روز معاملاتی)',
  Wed: 'چهارشنبه (روز معاملاتی)',
  Thu: 'پنج‌شنبه (روز معاملاتی)',
};

export function getMarketStatus(date: Date, input: MarketStatusInput, maxAgeMs: number): MarketStatus {
  const ny = getNewYorkParts(date);
  const tehran = formatPersianDateTime(date, 'Asia/Tehran');

  const isSat = ny.weekday === 'Sat';
  const isSun = ny.weekday === 'Sun';
  const isFriClosed = ny.weekday === 'Fri' && ny.hour >= 17;
  const isWeekend = isSat || isSun || isFriClosed;
  const isDataFresh = input.dataAgeMs < maxAgeMs;

  const nyTimeStr = `${ny.weekday} ${String(ny.hour).padStart(2, '0')}:${String(ny.minute).padStart(2, '0')} ${ny.tzName}`;
  const tehranTimeStr = `${tehran.jalaliDate} ${tehran.time24} (تهران)`;
  const nextOpenFa = getNextMondayOpenTehranString(date);

  const dayFa =
    ny.weekday === 'Fri'
      ? isFriClosed
        ? 'جمعه شب (بسته شدن هفتگی بازار)'
        : 'جمعه (روز معاملاتی تا ۱۷:۰۰ نیویورک)'
      : DAY_FA[ny.weekday] || ny.weekday;

  const base = {
    isWeekend,
    isSaturdayOrSunday: isSat || isSun,
    isDataFresh,
    dayFa,
    currentDayName: ny.weekday,
    nyTimeStr,
    tehranTimeStr,
    nextOpenFa,
  };

  if (isSat) {
    return {
      ...base,
      isOpen: false,
      reasonFa:
        'بازار فارکس در تمام ساعات روز شنبه کاملاً تعطیل است. صدور و ارسال هرگونه سیگنال جدید به تلگرام متوقف می‌باشد.',
    };
  }
  if (isSun) {
    return {
      ...base,
      isOpen: false,
      reasonFa: 'بازار فارکس در تمام ساعات روز یکشنبه تعطیل است. شروع مجدد تحلیل و ارسال سیگنال از بامداد دوشنبه.',
    };
  }
  if (isFriClosed) {
    return {
      ...base,
      isOpen: false,
      reasonFa: 'بازار فارکس در ساعت ۱۷:۰۰ روز جمعه به وقت نیویورک بسته شد و تا بازگشایی روز دوشنبه تعطیل است.',
    };
  }
  if (!isDataFresh) {
    return {
      ...base,
      isOpen: false,
      isWeekend: false,
      isSaturdayOrSunday: false,
      isDataFresh: false,
      reasonFa: 'اتصال به منبع قیمت برقرار نیست — نرخ تازه‌ای دریافت نشده است. صدور سیگنال جدید تا اتصال مجدد متوقف است.',
      nextOpenFa: 'به محض دریافت داده جدید از سرور قیمت فعال می‌شود',
    };
  }
  if (input.brokerClosed) {
    return {
      ...base,
      isOpen: false,
      isWeekend: false,
      isSaturdayOrSunday: false,
      reasonFa: 'بروکر/منبع قیمت وضعیت بازار را تعطیل اعلام کرده است.',
      nextOpenFa: 'پس از بازگشایی نماد توسط بروکر',
    };
  }
  return {
    ...base,
    isOpen: true,
    isDataFresh: true,
    reasonFa: 'بازار فارکس باز و داده‌های قیمت تازه هستند.',
    nextOpenFa: 'بازار هم‌اکنون فعال است',
  };
}

/** Convenience wrapper using live inputs. */
export function computeMarketStatus(dataAgeMs: number, brokerClosed: boolean, maxAgeMs: number): MarketStatus {
  return getMarketStatus(authoritativeNow(), { dataAgeMs, brokerClosed }, maxAgeMs);
}
