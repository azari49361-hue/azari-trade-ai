import Exa from 'exa-js';
import { config } from '../config';

/**
 * جستجوی وب با Exa — برای پیدا کردن اخبار و منابع مرتبط با بازار.
 * کلید فقط از EXA_API_KEY خوانده می‌شود؛ هیچ کلیدی در کد ذخیره نمی‌شود.
 * highlights به‌جای متن کامل صفحه، فقط مهم‌ترین بخش‌های مرتبط با پرسش را برمی‌گرداند.
 */

let client: Exa | null = null;

function getClient(): Exa {
  if (!config.exa.apiKey) {
    throw new Error('EXA_API_KEY تنظیم نشده است — جستجوی وب غیرفعال است.');
  }
  if (!client) client = new Exa(config.exa.apiKey);
  return client;
}

export function isWebSearchConfigured(): boolean {
  return Boolean(config.exa.apiKey);
}

export interface WebSearchResult {
  title: string | null;
  url: string;
  publishedDate: string | null;
  highlights: string[];
}

export interface WebSearchOptions {
  /** تعداد نتایج (۱ تا ۱۰؛ پیش‌فرض ۵) */
  limit?: number;
  /** مهلت کل درخواست به میلی‌ثانیه (پیش‌فرض ۱۵ ثانیه) */
  timeoutMs?: number;
}

export async function searchWeb(query: string, options: WebSearchOptions = {}): Promise<WebSearchResult[]> {
  const q = query.trim();
  if (!q) throw new Error('عبارت جستجو خالی است.');

  const limit = Math.min(10, Math.max(1, Math.trunc(options.limit ?? 5)));
  const response = await getClient().search(
    q,
    {
      type: 'auto',
      numResults: limit,
      contents: { highlights: true },
    },
    { timeout: options.timeoutMs ?? 15_000 }
  );

  return response.results.map((r) => ({
    title: r.title ?? null,
    url: r.url,
    publishedDate: r.publishedDate ?? null,
    highlights: r.highlights ?? [],
  }));
}
