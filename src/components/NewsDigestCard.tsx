import React, { useCallback, useEffect, useState } from 'react';
import { Newspaper, Send, RefreshCw, AlertTriangle, Clock, CheckCircle2 } from 'lucide-react';
import { postJson, apiUrl } from '../utils/api';

interface DigestStatus {
  ok: boolean;
  enabled: boolean;
  text: string;
  eventCount: number;
  headlineCount: number;
  lastSentDay: string | null;
  sentToday: boolean;
  hourTehran: number;
  nextSendAt: number;
  error?: string;
}

const faNum = (n: number, digits = 0): string =>
  Number.isFinite(n) ? n.toLocaleString('fa-IR', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';

const faTime = (ms: number): string => {
  if (!ms) return '—';
  try {
    return new Intl.DateTimeFormat('fa-IR', {
      timeZone: 'Asia/Tehran',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(ms));
  } catch {
    return '—';
  }
};

const formatDelay = (ms: number): string => {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${faNum(minutes)} دقیقه`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${faNum(h)} ساعت و ${faNum(m)} دقیقه` : `${faNum(h)} ساعت`;
};

export const NewsDigestCard: React.FC = () => {
  const [status, setStatus] = useState<DigestStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [sending, setSending] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  // شمارش معکوس سمت کلاینت: هر دقیقه یک بار، تا زمان ارسال سررسد.
  const [now, setNow] = useState<number>(() => Date.now());
  const remainingMs = (status?.nextSendAt ?? 0) - now;

  useEffect(() => {
    const target = status?.nextSendAt ?? 0;
    if (!target) return;
    setNow(Date.now());
    if (target <= Date.now()) return;
    const id = window.setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= target) window.clearInterval(id);
    }, 60_000);
    return () => window.clearInterval(id);
  }, [status?.nextSendAt]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl('/api/news-digest/status'));
      const data = (await res.json()) as DigestStatus;
      setStatus(data);
    } catch (err: any) {
      setStatus({ ok: false, enabled: false, text: '', eventCount: 0, headlineCount: 0, lastSentDay: null, sentToday: false, hourTehran: 0, nextSendAt: 0, error: err?.message || 'خطا در دریافت خبر' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSend = async () => {
    setSending(true);
    setFeedback(null);
    try {
      const res = await postJson<{ ok: boolean; description?: string; headlineCount?: number; eventCount?: number }>('/api/news-digest/send');
      if (res.ok) {
        setFeedback({ ok: true, text: `ارسال شد — ${faNum(res.headlineCount ?? 0)} تیتر، ${faNum(res.eventCount ?? 0)} رویداد` });
      } else {
        setFeedback({ ok: false, text: res.description || 'ارسال ناموفق بود.' });
      }
      await load();
    } catch (err: any) {
      setFeedback({ ok: false, text: err?.message || 'خطا در ارسال' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mystic-frame rounded-xl border border-[#0f3a55]/60 bg-[#071522]/75 backdrop-blur-sm h-full flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 border-b border-[#0f3a55]/50">
        <div className="flex items-center gap-2 min-w-0">
          <Newspaper className="w-4 h-4 text-[#58a6ff]" />
          <span className="text-xs font-bold text-white">خبر روزانهٔ کانال</span>
          <span className="text-[10px] text-[#8b949e]">تلگرام</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => void load()}
            disabled={loading || sending}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold bg-[#21262d] text-[#c9d1d9] border border-[#30363d] hover:border-[#58a6ff]/50 transition disabled:opacity-50 cursor-pointer"
            title="بازخوانی پیش‌نمایش"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            <span>بازخوانی</span>
          </button>
          <button
            onClick={() => void handleSend()}
            disabled={sending || loading || !status?.enabled}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold bg-[#238636]/20 text-[#3fb950] border border-[#238636]/40 hover:border-[#3fb950] transition disabled:opacity-50 cursor-pointer"
            title="ارسال دستی به کانال"
          >
            <Send className={`w-3 h-3 ${sending ? 'animate-pulse' : ''}`} />
            <span>{sending ? 'در حال ارسال…' : 'ارسال دستی'}</span>
          </button>
        </div>
      </div>

      <div className="px-3.5 py-2.5 flex-1 min-h-0 flex flex-col gap-2">
        {loading && !status ? (
          <div className="flex items-center gap-1.5 text-[11px] text-[#8b949e] py-4">
            <Clock className="w-3.5 h-3.5 animate-pulse" />
            در حال دریافت…
          </div>
        ) : status?.error ? (
          <div className="flex items-start gap-1.5 text-[10px] text-[#e3b341] bg-[#d29922]/10 border border-[#d29922]/30 rounded-lg px-2 py-1.5 leading-relaxed">
            <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
            <span>{status.error}</span>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-[#8b949e]">
              <span>
                {status?.sentToday ? (
                  <span className="text-[#3fb950] inline-flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> امروز ارسال شد
                  </span>
                ) : (
                  <span className="text-[#e3b341]">امروز ارسال نشده</span>
                )}
              </span>
              <span>
                ارسال بعدی: ساعت {faNum(status?.hourTehran ?? 0)}:۰۰ ·{' '}
                {remainingMs > 0 ? `${formatDelay(remainingMs)} دیگر` : '—'}
              </span>
              {status?.lastSentDay && <span>آخرین ارسال: {status.lastSentDay}</span>}
            </div>

            {feedback && (
              <div
                className={`text-[10px] leading-relaxed rounded-lg px-2 py-1.5 border ${
                  feedback.ok
                    ? 'text-[#3fb950] bg-[#238636]/10 border-[#238636]/30'
                    : 'text-[#f85149] bg-[#da3633]/10 border-[#da3633]/30'
                }`}
              >
                {feedback.text}
              </div>
            )}

            <pre className="flex-1 min-h-0 max-h-[220px] overflow-y-auto whitespace-pre-wrap break-words text-[10px] leading-relaxed text-[#c9d1d9] bg-[#0d1117]/60 border border-[#0f3a55]/40 rounded-lg px-2.5 py-2 font-mono">
              {status?.text || 'خبری برای نمایش نیست.'}
            </pre>

            <div className="text-[9px] text-[#8b949e]">
              {faNum(status?.headlineCount ?? 0)} تیتر · {faNum(status?.eventCount ?? 0)} رویداد · کانال{' '}
              <span dir="ltr" className="font-mono">
                https://t.me/Azari_Trade_AI_Channel
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
