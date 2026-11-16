/**
 * Authoritative time + Jalali (Solar Hijri) formatting in Asia/Tehran.
 * Native Intl API — no external date libraries.
 */

export const DEFAULT_TIMEZONE = 'Asia/Tehran';

export interface FormattedDateTime {
  jalaliDate: string; // e.g. "۱۴۰۵/۰۸/۰۹"
  time24: string; // e.g. "۲۳:۴۵:۱۲"
  fullDisplay: string;
}

export function formatPersianDateTime(
  isoStringOrDate: string | number | Date | undefined,
  timeZone: string = DEFAULT_TIMEZONE
): FormattedDateTime {
  if (!isoStringOrDate) return { jalaliDate: '', time24: '', fullDisplay: '' };
  const d = new Date(isoStringOrDate);
  if (isNaN(d.getTime())) return { jalaliDate: '', time24: '', fullDisplay: '' };

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
    return { jalaliDate, time24, fullDisplay: `${jalaliDate} — ${time24}` };
  } catch {
    return {
      jalaliDate: d.toLocaleDateString('fa-IR'),
      time24: d.toLocaleTimeString('fa-IR', { hour12: false }),
      fullDisplay: d.toLocaleString('fa-IR'),
    };
  }
}

/**
 * Clock-drift tracker against network time.
 * Used only for *display/creation timestamps*; intervals use monotonic Date.now().
 */
let networkTimeOffsetMs = 0;
let lastTimeSync = 0;

export async function syncAuthoritativeTime(): Promise<void> {
  try {
    const start = Date.now();
    const res = await fetch('https://timeapi.io/api/time/current/zone?timeZone=UTC', {
      signal: AbortSignal.timeout(3500),
    });
    if (res.ok) {
      const data = (await res.json()) as { dateTime: string };
      const networkUtcMs = new Date(data.dateTime + 'Z').getTime();
      const roundTrip = (Date.now() - start) / 2;
      networkTimeOffsetMs = networkUtcMs + roundTrip - Date.now();
      lastTimeSync = Date.now();
      console.log(`[TimeSync] UTC synchronized. Drift offset: ${networkTimeOffsetMs.toFixed(1)}ms`);
      return;
    }
  } catch {
    /* fall through to HTTP Date header */
  }
  try {
    const headRes = await fetch('https://www.google.com', { method: 'HEAD', signal: AbortSignal.timeout(2500) });
    const dateHeader = headRes.headers.get('date');
    if (dateHeader) {
      networkTimeOffsetMs = new Date(dateHeader).getTime() - Date.now();
      lastTimeSync = Date.now();
      console.log(`[TimeSync] Synchronized via HTTP Date header. Drift: ${networkTimeOffsetMs.toFixed(1)}ms`);
    }
  } catch {
    /* local RTC assumed sane; retried every 30 minutes */
  }
}

export function startPeriodicTimeSync(): void {
  void syncAuthoritativeTime();
  setInterval(() => void syncAuthoritativeTime(), 30 * 60 * 1000);
}

/** Authoritative UTC date at this instant (falls back to local clock if sync is stale). */
export function authoritativeNow(): Date {
  if (Date.now() - lastTimeSync < 60 * 60 * 1000 && lastTimeSync > 0) {
    return new Date(Date.now() + networkTimeOffsetMs);
  }
  return new Date();
}

export interface NewYorkParts {
  weekday: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  tzName: string;
}

export function getNewYorkParts(date: Date): NewYorkParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  });
  const map: Record<string, string> = {};
  for (const p of formatter.formatToParts(date)) map[p.type] = p.value;
  return {
    weekday: (map.weekday || 'Mon') as NewYorkParts['weekday'],
    year: parseInt(map.year, 10),
    month: parseInt(map.month, 10),
    day: parseInt(map.day, 10),
    hour: parseInt(map.hour, 10),
    minute: parseInt(map.minute, 10),
    second: parseInt(map.second, 10),
    tzName: map.timeZoneName || 'ET',
  };
}

/**
 * Next weekly forex reopen: Monday 17:00 New York (DST-aware).
 * Returns the Tehran-time string for that moment, e.g. "دوشنبه ۰۲:۳۰ بامداد" (EST) or "۰۱:۳۰" (EDT).
 */
export function getNextMondayOpenTehranString(from: Date = authoritativeNow()): string {
  const ny = getNewYorkParts(from);
  const dayIndex: Record<NewYorkParts['weekday'], number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };
  const todayIdx = dayIndex[ny.weekday];
  const daysUntilMonday = ((1 - todayIdx) + 7) % 7; // 0 when today is Monday
  const base = Date.UTC(ny.year, ny.month - 1, ny.day + daysUntilMonday, 22, 0, 0); // 17:00 NY ≈ 21/22:00 UTC
  // Refine for DST: format candidate in NY tz and correct by the hour difference.
  let candidate = new Date(base);
  for (let i = 0; i < 2; i++) {
    const parts = getNewYorkParts(candidate);
    const diff = 17 - parts.hour;
    if (diff === 0) break;
    candidate = new Date(candidate.getTime() + diff * 3600_000);
  }
  const f = new Intl.DateTimeFormat('fa-IR', {
    timeZone: 'Asia/Tehran',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(candidate);
  return `${f} (به وقت تهران، با دریافت داده تازه)`;
}
