export const DEFAULT_TIMEZONE = 'Asia/Tehran';

export interface FormattedPersianDateTime {
  jalaliDate: string; // e.g. "۱۴۰۵/۰۸/۰۹"
  time24: string; // e.g. "۲۳:۴۵:۱۲"
  fullDisplay: string; // e.g. "۱۴۰۵/۰۸/۰۹ — ۲۳:۴۵:۱۲"
}

/**
 * Formats any Date / ISO timestamp into official Jalali Solar date & 24-hour time
 * in Asia/Tehran timezone using native standard Intl API.
 */
export function formatPersianDateTime(
  isoStringOrDate: string | number | Date | undefined,
  timeZone: string = DEFAULT_TIMEZONE
): FormattedPersianDateTime {
  if (!isoStringOrDate) {
    return { jalaliDate: '', time24: '', fullDisplay: '' };
  }

  const d = new Date(isoStringOrDate);
  if (isNaN(d.getTime())) {
    return { jalaliDate: '', time24: '', fullDisplay: '' };
  }

  try {
    const jalaliDate = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);

    const time24 = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(d);

    return {
      jalaliDate,
      time24,
      fullDisplay: `${jalaliDate} — ${time24}`,
    };
  } catch {
    return {
      jalaliDate: d.toLocaleDateString('fa-IR'),
      time24: d.toLocaleTimeString('fa-IR', { hour12: false }),
      fullDisplay: d.toLocaleString('fa-IR'),
    };
  }
}
