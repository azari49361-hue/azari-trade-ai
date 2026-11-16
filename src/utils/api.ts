/**
 * Helpers for talking to the backend.
 *
 * By default the dashboard and the API live on the same origin, so paths stay relative ("/api/...").
 * If the frontend is hosted separately (e.g. static hosting) set VITE_API_BASE at BUILD time to the
 * backend origin, e.g. VITE_API_BASE=https://azari-trade-ai.onrender.com
 *
 * The dashboard has no login: mutations are sent straight to the server.
 * (If you expose the app publicly, protect it at the network layer — a firewall or an allow/deny rule in nginx.)
 */

const RAW_BASE = ((import.meta as any).env?.VITE_API_BASE as string | undefined) ?? '';
export const API_BASE = RAW_BASE.trim().replace(/\/+$/, '');

/** "/api/state" → "<API_BASE>/api/state" (یا همان مسیر نسبی وقتی API_BASE خالی است) */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

function send(path: string, body?: unknown): Promise<Response> {
  return fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function postJson<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await send(path, body);
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok && data.error) throw new Error(data.error);
  return data;
}

/**
 * پاسخ واقعاً JSON است؟ میزبان‌های استاتیک برای /api/* معمولاً index.html (۲۰۰) یا ۴۰۴ برمی‌گردانند.
 */
export function isJsonResponse(res: Response): boolean {
  return (res.headers.get('content-type') || '').toLowerCase().includes('application/json');
}
