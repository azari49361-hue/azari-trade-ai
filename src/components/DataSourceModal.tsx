import React, { useState } from 'react';
import { X, Database, Key, CheckCircle2, AlertTriangle, Save, Trash2, Info } from 'lucide-react';
import { SourceDetails, SourcesStatus } from '../types';
import { postJson, apiUrl } from '../utils/api';

interface DataSourceModalProps {
  isOpen: boolean;
  onClose: () => void;
  sources: SourcesStatus;
  details?: SourceDetails | null;
  onSuccess: () => void;
  onNotify: (msg: string) => void;
}

/**
 * تنظیم منبع داده از داخل داشبورد (بدون ویرایش .env).
 * کلید به سرور می‌رود، با یک درخواست واقعی به TwelveData تأیید می‌شود و در DB ذخیره می‌گردد.
 */
export const DataSourceModal: React.FC<DataSourceModalProps> = ({ isOpen, onClose, sources, details, onSuccess, onNotify }) => {
  const [apiKey, setApiKey] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [removing, setRemoving] = useState<boolean>(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const key = apiKey.trim();
    if (!key) {
      setMessage({ ok: false, text: 'کلید API را وارد کنید.' });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const data = await postJson<any>('/api/sources/twelvedata', { apiKey: key });
      const sample = data?.samplePrice ? ` — قیمت آزمایشی XAU/USD: ${data.samplePrice}` : '';
      setMessage({ ok: true, text: `کلید ذخیره و تأیید شد${sample}` });
      setApiKey('');
      onNotify('✅ TwelveData وصل شد');
      onSuccess();
    } catch (err: any) {
      setMessage({ ok: false, text: err?.message || 'ذخیره کلید ناموفق بود.' });
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    setMessage(null);
    try {
      const res = await fetch(apiUrl('/api/sources/twelvedata'), { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'حذف ناموفق بود.');
      setMessage({ ok: true, text: 'کلید حذف شد؛ منبع غیرفعال است.' });
      onNotify('کلید TwelveData حذف شد');
      onSuccess();
    } catch (err: any) {
      setMessage({ ok: false, text: err?.message || 'حذف ناموفق بود.' });
    } finally {
      setRemoving(false);
    }
  };

  const statusRow = (label: string, active: boolean, hint: string) => (
    <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-[#040b18]/90 border border-[#0f3a55]/50">
      <div>
        <div className="text-xs text-white">{label}</div>
        <div className="text-[11px] text-[#8b949e] mt-0.5">{hint}</div>
      </div>
      <span
        className={`shrink-0 text-[11px] px-2 py-0.5 rounded-md border font-mono ${
          active
            ? 'bg-[#238636]/20 text-[#3fb950] border-[#238636]/40'
            : 'bg-[#d29922]/15 text-[#e3b341] border-[#d29922]/40'
        }`}
      >
        {active ? 'فعال' : 'تنظیم‌نشده'}
      </span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
      <div className="mystic-frame mystic-modal rounded-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="mystic-modal-header px-5 py-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#1f6feb]/20 text-[#58a6ff] flex items-center justify-center">
              <Database className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">منابع داده قیمت</h3>
              <p className="text-[11px] text-[#8b949e]">کلید را وارد کن؛ بدون ویرایش فایل و ری‌استارت</p>
            </div>
          </div>
          <button onClick={onClose} className="mystic-btn p-1.5 rounded-md text-[#b9d8ee] hover:text-white transition">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="space-y-2">
            {statusRow('MetaApi (MT5 بروکر)', sources.metaapi, 'بدون حساب MT5 قابل استفاده نیست — با .env تنظیم می‌شود')}
            {statusRow(
              'Twelve Data',
              sources.twelvedata,
              sources.twelvedata
                ? `${details?.twelvedataKeySource === 'dashboard' ? 'کلید از داشبورد' : 'کلید از .env'} · فاصله درخواست: ${
                    details?.twelvedataMinIntervalSeconds ?? 60
                  } ثانیه`
                : 'کلید API لازم است (پلن رایگان: ۸ درخواست در دقیقه)'
            )}
            {statusRow('biquote (رله عمومی)', sources.biquote, 'منبع همیشه‌کارکرد فعلی داشبورد')}
          </div>

          <div className="mystic-form-container">
            <form onSubmit={handleSave} className="mystic-form">
              <div className="mystic-form-group">
                <label htmlFor="twelvedata-key" className="flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-[#38e8ff]" />
                  کلید API Twelve Data
                </label>
                <input
                  id="twelvedata-key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="کلید را اینجا پیست کن"
                  autoComplete="off"
                  dir="ltr"
                />
                <p className="text-[11px] text-[#8b949e] flex items-start gap-1.5 mt-1">
                  <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  کلید قبل از ذخیره با یک درخواست واقعی قیمت طلا آزمایش می‌شود؛ هیچ‌جا چاپ نمی‌شود. کلید در دیتابیس (PostgreSQL) این
                  سرور ذخیره می‌شود، نه در مرورگر.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button type="submit" disabled={loading} className="mystic-form-submit-btn">
                  {loading ? (
                    <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  <span>{loading ? 'در حال تست کلید…' : 'ذخیره و تست'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleRemove}
                  disabled={removing || !sources.twelvedata}
                  className="mystic-btn flex items-center gap-1.5 px-3 py-2.5 rounded-lg border text-xs disabled:opacity-40"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>حذف کلید</span>
                </button>
              </div>
            </form>
          </div>

          {message && (
            <div
              className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs border ${
                message.ok
                  ? 'bg-[#238636]/15 border-[#238636]/40 text-[#3fb950]'
                  : 'bg-[#da3633]/15 border-[#da3633]/40 text-[#f85149]'
              }`}
            >
              {message.ok ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0" />
              )}
              <span className="break-words">{message.text}</span>
            </div>
          )}

          {(details?.pollErrors?.length || 0) > 0 && (
            <div className="px-3 py-2 rounded-lg bg-[#d29922]/10 border border-[#d29922]/30 text-[11px] text-[#e3b341]
              space-y-0.5">
              <div className="font-semibold">آخرین خطای منابع:</div>
              {details!.pollErrors.slice(0, 3).map((e, i) => (
                <div key={i} className="break-words font-mono">
                  {e}
                </div>
              ))}
            </div>
          )}

          <p className="text-[11px] text-[#8b949e] leading-relaxed">
            نکته: منبع با اولویت MetaApi → TwelveData → biquote خوانده می‌شود؛ اگر TwelveData در محدودیت کردیت باشد، قیمت همان نماد
            از biquote می‌آید و هیچ قیمت کهنه‌ای به‌عنوان تازه نمایش داده نمی‌شود.
          </p>
        </div>
      </div>
    </div>
  );
};
