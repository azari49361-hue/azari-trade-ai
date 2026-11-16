/**
 * نرخ دلار به تومان — خودکار، بدون کلید.
 *
 * سه منبع واقعی به ترتیب اولویت؛ اولین جواب معتبر برنده است:
 *   ۱) priceto.day  — دلار بازار آزاد تهران (مبنای tgju)، قیمت به ریال
 *   ۲) nerkhsanj    — دلار بازار آزاد + تتر (قیمت به تومان)
 *   ۳) Nobitex      — تتر/ریال (قیمت به ریال) — فقط پشتیبان، با برچسب «تتر»
 *
 * قاعده‌ها:
 *  - هیچ عددی حدس زده نمی‌شود: اگر هیچ منبعی پاسخ ندهد null برمی‌گردد.
 *  - محدودهٔ پذیرش: ۱۰ هزار تا ۵۰۰ میلیون تومان (عدد بیرون از این بازه = داده خراب).
 *  - آخرین نرخ موفق تا ۵ دقیقه کش می‌شود و در قطعی شبکه همان برگردانده می‌شود.
 */

export type TomanKind = 'usd' | 'usdt';

export interface TomanRate {
  /** تومان به ازای ۱ دلار */
  rate: number;
  /** برچسب فنی منبع (ASCII) */
  source: string;
  kind: TomanKind;
  /** زمان اعلام نرخ (ISO) */
  at: string;
}

const MIN_TOMAN = 10_000;
const MAX_TOMAN = 500_000_000;
const CACHE_MS = 5 * 60_000;

function sane(rate: number): boolean {
  return Number.isFinite(rate) && rate >= MIN_TOMAN && rate <= MAX_TOMAN;
}

/** ریال → تومان */
export function rialToToman(rial: number): number {
  return Math.round(rial / 10);
}

export function parsePricetoDay(data: any, now: Date = new Date()): TomanRate | null {
  if (!data || data.success !== true || typeof data.price !== 'number') return null;
  const rate = rialToToman(data.price);
  if (!sane(rate)) return null;
  const at = typeof data.time === 'string' && !Number.isNaN(Date.parse(data.time)) ? data.time : now.toISOString();
  return { rate, source: 'priceto.day (tgju)', kind: 'usd', at };
}

export function parseNerkhsanj(data: any, now: Date = new Date()): TomanRate | null {
  const dollar = Number(data?.rates?.dollar ?? data?.rates?.tether);
  if (!sane(dollar)) return null;
  const kind: TomanKind = data?.rates?.dollar ? 'usd' : 'usdt';
  return {
    rate: Math.round(dollar),
    source: kind === 'usd' ? 'nerkhsanj (بازار آزاد)' : 'nerkhsanj (تتر)',
    kind,
    at: now.toISOString(),
  };
}

export function parseNobitex(data: any, now: Date = new Date()): TomanRate | null {
  const latest = Number(data?.stats?.['usdt-rls']?.latest);
  if (!Number.isFinite(latest)) return null;
  const rate = rialToToman(latest);
  if (!sane(rate)) return null;
  return { rate, source: 'Nobitex (تتر/ریال)', kind: 'usdt', at: now.toISOString() };
}

const SOURCES: { url: string; parse: (j: any, now?: Date) => TomanRate | null }[] = [
  { url: 'https://api.priceto.day/v1/latest/irr/usd', parse: parsePricetoDay },
  { url: 'https://nerkh.jahankhahan.shop/data/live.json', parse: parseNerkhsanj },
  { url: 'https://apiv2.nobitex.ir/market/stats?srcCurrency=usdt&dstCurrency=rls', parse: parseNobitex },
];

let cache: { at: number; data: TomanRate | null } = { at: 0, data: null };

export async function fetchTomanRate(): Promise<TomanRate | null> {
  if (cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;

  for (const src of SOURCES) {
    try {
      const res = await fetch(src.url, {
        signal: AbortSignal.timeout(6000),
        headers: { 'User-Agent': 'AzariTradeAI/2.0' },
      });
      if (!res.ok) continue;
      const parsed = src.parse(await res.json());
      if (parsed) {
        cache = { at: Date.now(), data: parsed };
        return parsed;
      }
    } catch {
      // منبع بعدی را امتحان کن؛ خطا در گزارش نمایش داده نمی‌شود، فقط نرخ نمی‌آید.
    }
  }
  // شبکه قطع است: آخرین نرخ موفق را با همان زمانش برمی‌گردانیم (داده ساختگی نمی‌سازیم).
  return cache.data;
}

/** فقط برای تست. */
export function resetTomanRateCache(): void {
  cache = { at: 0, data: null };
}
