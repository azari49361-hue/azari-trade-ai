/**
 * تزریق آدرس مطلق در متاهای Open Graph.
 *
 * چرا لازم است: تلگرام/توییتر/فیسبوک آدرس نسبی (`/og-image.png`) را برای
 * og:image قبول نمی‌کنند و بدون دامنهٔ کامل، پیش‌نمایش لینک بدون عکس می‌آید.
 * در `index.html` جای آدرس با `__OG_BASE__` گذاشته شده و همین‌جا پر می‌شود.
 */
export const OG_BASE_TOKEN = '__OG_BASE__';

/** آدرس پایه را نرمال می‌کند (بدون اسلش انتهایی) و توکن را جای‌گذاری می‌کند. */
export function renderIndexHtml(template: string, baseUrl: string): string {
  const base = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!base) return template.split(OG_BASE_TOKEN).join('');
  return template.split(OG_BASE_TOKEN).join(base);
}
