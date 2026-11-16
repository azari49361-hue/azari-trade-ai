import React, { useState, useEffect, useRef } from 'react';
import { X, Send, Key, CheckCircle2, AlertTriangle, ShieldCheck, Radio, Lock, Edit3, Sparkles, Save, Server } from 'lucide-react';
import { TelegramConfigState, SourcesStatus } from '../types';
import { postJson } from '../utils/api';

interface TelegramBotModalProps {
  isOpen: boolean;
  onClose: () => void;
  telegramState: TelegramConfigState;
  sources: SourcesStatus;
  onSuccess: () => void;
  onNotify: (msg: string) => void;
}

export const TelegramBotModal: React.FC<TelegramBotModalProps> = ({
  isOpen,
  onClose,
  telegramState,
  sources,
  onSuccess,
  onNotify,
}) => {
  const isAlreadyConnected = Boolean(telegramState.isConnected && telegramState.hasToken);

  const [channelChatId, setChannelChatId] = useState<string>(telegramState.channelChatId || '');
  const [adminChatId, setAdminChatId] = useState<string>(telegramState.adminChatId || '');
  const [botToken, setBotToken] = useState<string>('');

  const [isEditing, setIsEditing] = useState<boolean>(!isAlreadyConnected);
  const [loading, setLoading] = useState<boolean>(false);
  const [testingTarget, setTestingTarget] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const prevIsOpenRef = useRef<boolean>(false);

  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      setChannelChatId(telegramState.channelChatId || '');
      setAdminChatId(telegramState.adminChatId || '');
      setBotToken('');
      setResultMessage(null);
      setIsEditing(!(telegramState.isConnected && telegramState.hasToken));
    }
    prevIsOpenRef.current = isOpen;
  }, [
    isOpen,
    telegramState.isConnected,
    telegramState.hasToken,
    telegramState.channelChatId,
    telegramState.adminChatId,
  ]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!botToken.trim() && !isAlreadyConnected) {
      setResultMessage({ ok: false, text: 'لطفاً «توکن ربات تلگرام» را وارد فرمایید.' });
      return;
    }
    if (!channelChatId.trim()) {
      setResultMessage({ ok: false, text: 'لطفاً فیلد «چت‌آیدی کانال تلگرام» را وارد فرمایید.' });
      return;
    }

    setLoading(true);
    setResultMessage(null);

    try {
      const data = await postJson<any>('/api/bot', {
        botToken: botToken.trim(),
        channelChatId: channelChatId.trim(),
        adminChatId: adminChatId.trim(),
      });

      if (data.ok) {
        setResultMessage({ ok: true, text: `✅ ${data.message || 'تنظیمات تلگرام ذخیره شد.'}` });
        if (data.channelChatId) setChannelChatId(data.channelChatId);
        if (data.adminChatId) setAdminChatId(data.adminChatId);
        setBotToken('');
        onSuccess();
      } else {
        setResultMessage({ ok: false, text: data.error || 'خطا در اعتبارسنجی تلگرام.' });
      }
    } catch (err: any) {
      setResultMessage({ ok: false, text: 'خطا: ' + (err?.message || 'نامشخص') });
    } finally {
      setLoading(false);
    }
  };

  const handleTestChannel = async () => {
    setTestingTarget('CHANNEL');
    setResultMessage(null);
    try {
      const data = await postJson<any>('/api/test/channel-signal');
      setResultMessage(
        data.ok
          ? { ok: true, text: '🧪 پیام آزمایشی به کانال تلگرام ارسال شد.' }
          : { ok: false, text: data.description || data.error || 'خطا در ارسال به کانال.' }
      );
    } catch (err: any) {
      setResultMessage({ ok: false, text: err?.message || 'خطا در ارسال پیام تستی به کانال.' });
    } finally {
      setTestingTarget(null);
    }
  };

  const handleTestTarget = async (target: 'TP1' | 'TP2' | 'TP3' | 'SL') => {
    setTestingTarget(target);
    setResultMessage(null);
    try {
      const data = await postJson<any>('/api/test/target', { target });
      setResultMessage(
        data.ok
          ? { ok: true, text: `🧪 پیام آزمایشی ${target} به کانال ارسال شد.` }
          : { ok: false, text: data.description || data.error || 'خطا در ارسال به کانال.' }
      );
    } catch (err: any) {
      setResultMessage({ ok: false, text: err?.message || 'خطا در ارسال پیام تستی به کانال.' });
    } finally {
      setTestingTarget(null);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('آیا مطمئن هستید که می‌خواهید اتصال تلگرام را قطع کنید؟')) return;
    try {
      await postJson<any>('/api/bot/disconnect');
      onSuccess();
      setIsEditing(true);
      setBotToken('');
      setChannelChatId('');
      setResultMessage({ ok: true, text: 'تنظیمات تلگرام با موفقیت حذف گردید.' });
    } catch (err: any) {
      setResultMessage({ ok: false, text: err?.message || 'خطا در قطع اتصال.' });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
      <div className="mystic-frame mystic-modal rounded-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="mystic-modal-header px-5 py-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#238636]/20 text-[#3fb950] flex items-center justify-center">
              <Send className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white">تنظیمات ربات تلگرام Azari Trade AI</h3>
                {isAlreadyConnected && (
                  <span className="text-[10px] bg-[#238636]/20 text-[#3fb950] border border-[#238636]/40 px-2 py-0.5 rounded font-mono font-bold">
                    اتصال فعال
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[#8b949e]">
                همه پیام‌ها به کانال: سیگنال طلا + پیگیری لحظه‌ای اهداف (TP1/TP2/TP3) و حد ضرر
              </p>
            </div>
          </div>
          <button onClick={onClose} className="mystic-btn p-1.5 rounded-lg text-[#b9d8ee] hover:text-white transition cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          {resultMessage && (
            <div
              className={`p-3 rounded-xl border flex items-start gap-2.5 text-xs ${
                resultMessage.ok
                  ? 'bg-[#238636]/15 border-[#238636]/50 text-[#3fb950]'
                  : 'bg-[#da3633]/15 border-[#da3633]/50 text-[#f85149]'
              }`}
            >
              {resultMessage.ok ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              )}
              <span className="leading-relaxed">{resultMessage.text}</span>
            </div>
          )}

          {/* Data sources status (server-side env keys) */}
          <div className="p-3 rounded-xl bg-[#040b18]/90 border border-[#0f3a55]/50">
            <div className="flex items-center gap-2 text-xs font-bold text-white mb-2">
              <Server className="w-3.5 h-3.5 text-[#58a6ff]" />
              <span>منابع قیمت سرور (کلیدها فقط در .env — هرگز در مرورگر)</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-[11px]">
              <div className={`p-2 rounded-lg border ${sources.metaapi ? 'bg-[#238636]/10 border-[#238636]/40 text-[#3fb950]' : 'bg-[#161b22] border-[#30363d] text-[#8b949e]'}`}>
                MetaApi (MT5): {sources.metaapi ? 'فعال ✓' : 'تنظیم‌نشده'}
              </div>
              <div className={`p-2 rounded-lg border ${sources.twelvedata ? 'bg-[#238636]/10 border-[#238636]/40 text-[#3fb950]' : 'bg-[#161b22] border-[#30363d] text-[#8b949e]'}`}>
                Twelve Data: {sources.twelvedata ? 'فعال ✓' : 'تنظیم‌نشده'}
              </div>
              <div
                className={`p-2 rounded-lg border ${
                  sources.biquote ? 'bg-[#238636]/10 border-[#238636]/40 text-[#3fb950]' : 'bg-[#161b22] border-[#30363d] text-[#8b949e]'
                }`}
              >
                biquote: {sources.biquote ? 'فعال ✓' : 'غیرفعال'}
              </div>
            </div>
          </div>

          {isAlreadyConnected && !isEditing ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-[#0d1117] border border-[#238636]/40 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#3fb950] animate-pulse"></span>
                    <span className="text-xs font-bold text-white">ربات تلگرام متصل است</span>
                  </div>
                  <span className="text-[10px] text-[#8b949e] font-mono">
                    {telegramState.lastVerifiedAt ? new Date(telegramState.lastVerifiedAt).toLocaleDateString('fa-IR') : 'فعال'}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-[#21262d] text-xs">
                  <div className="p-2.5 rounded-lg bg-[#061223]/80 border border-[#0f3a55]/50">
                    <span className="text-[11px] text-[#8b949e] block mb-1">ربات ثبت‌شده</span>
                    <div className="font-mono font-semibold text-white flex items-center gap-1.5">
                      <span className="text-[#3fb950]">@{telegramState.botUsername || 'bot'}</span>
                      <span className="text-[10px] text-[#8b949e]">({telegramState.botName || 'Bot'})</span>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-[#061223]/80 border border-[#0f3a55]/50">
                    <span className="text-[11px] text-[#8b949e] block mb-1 flex items-center justify-between">
                      <span>توکن ربات (Bot Token)</span>
                      <Lock className="w-3 h-3 text-[#3fb950]" />
                    </span>
                    <div className="font-mono text-white text-xs flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5 text-[#3fb950]" />
                      <span>ذخیره‌شده در دیتابیس سرور</span>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-[#061223]/80 border border-[#0f3a55]/50">
                    <span className="text-[11px] text-[#8b949e] block mb-1 flex items-center gap-1">
                      <Radio className="w-3 h-3 text-[#58a6ff]" />
                      <span>کانال (سیگنال + پیگیری اهداف و SL)</span>
                    </span>
                    <div className="font-mono font-semibold text-[#58a6ff]" dir="ltr">
                      {telegramState.channelChatId}
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-[#061223]/80 border border-[#0f3a55]/50">
                    <span className="text-[11px] text-[#8b949e] block mb-1 flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3 text-[#3fb950]" />
                      <span>چت شخصی من (فقط هشدارهای فنی)</span>
                    </span>
                    <div className="font-mono font-semibold text-[#3fb950]" dir="ltr">
                      {telegramState.adminChatId || '—'} 
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-[#040b18]/90 border border-[#0f3a55]/50 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-[#58a6ff]" />
                    <span>آزمایش لحظه‌ای ارسال پیام‌ها:</span>
                  </span>
                  <span className="text-[10px] text-[#8b949e]">پیام‌های تست با برچسب 🧪 ارسال می‌شوند</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleTestChannel}
                    disabled={testingTarget !== null}
                    className="mystic-btn p-2 rounded-lg border text-[11px] text-white flex items-center justify-center gap-1.5 transition cursor-pointer disabled:opacity-50"
                  >
                    <Radio className="w-3.5 h-3.5 text-[#7c9cff]" />
                    <span>تست کانال</span>
                  </button>

                  {(['TP1', 'TP2', 'TP3'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => handleTestTarget(t)}
                      disabled={testingTarget !== null}
                      className="mystic-btn p-2 rounded-lg border text-[11px] text-white flex items-center justify-center gap-1.5 transition cursor-pointer disabled:opacity-50"
                    >
                      <span>{t === 'TP1' ? '🎯' : t === 'TP2' ? '🚀' : '🏆'}</span>
                      <span>تست {t} در کانال</span>
                    </button>
                  ))}

                  <button
                    type="button"
                    onClick={() => handleTestTarget('SL')}
                    disabled={testingTarget !== null}
                    className="mystic-btn p-2 rounded-lg border text-[11px] text-[#7cf3ff] flex items-center justify-center gap-1.5 transition cursor-pointer disabled:opacity-50 col-span-2 sm:col-span-1"
                  >
                    <span>🔴</span>
                    <span>تست حد ضرر در کانال</span>
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-[#21262d]">
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="mystic-btn px-3 py-2 rounded-xl text-xs text-[#d8a0b0] transition cursor-pointer"
                >
                  حذف اتصال
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setChannelChatId(telegramState.channelChatId || '');
                    setIsEditing(true);
                  }}
                  className="mystic-btn flex items-center gap-1.5 px-4 py-2 rounded-xl text-white text-xs font-semibold transition cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>تغییر تنظیمات</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="mystic-form-container">
              <div className="p-3 rounded-xl bg-[#1f6feb]/10 border border-[#1f6feb]/30 text-xs text-[#58a6ff] flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="leading-relaxed">
                  توکن پس از اعتبارسنجی کامل (getMe + پیام آزمایشی واقعی به کانال) در دیتابیس
                  ذخیره می‌شود و هرگز در پاسخ API یا لاگ‌ها نمایش داده نمی‌شود.
                </span>
              </div>

              <form onSubmit={handleSubmit} className="mystic-form">
                <div className="mystic-form-group">
                  <label htmlFor="tg-bot-token">
                    توکن ربات تلگرام (Telegram Bot Token) <span className="text-[#f85149]">*</span>
                  </label>
                  <div className="relative">
                    <input
                      id="tg-bot-token"
                      type="password"
                      placeholder={isAlreadyConnected ? 'برای تغییر، توکن جدید را وارد کنید' : 'مثال: 7123456789:AAHk...'}
                      value={botToken}
                      onChange={(e) => setBotToken(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                      dir="ltr"
                      required={!isAlreadyConnected}
                      className="pl-10"
                    />
                    <Key className="w-4 h-4 text-[#38e8ff] absolute left-3 top-3.5 pointer-events-none" />
                  </div>
                  <p className="text-[11px] text-[#8b949e] mt-1">توکن ربات دریافتی از @BotFather</p>
                </div>

                <div className="mystic-form-group">
                  <label htmlFor="tg-channel-id" className="flex items-center justify-between gap-2">
                    <span>
                      چت‌آیدی کانال تلگرام (Channel Chat ID) <span className="text-[#f85149]">*</span>
                    </span>
                    <span className="text-[10px] text-[#58a6ff]">سیگنال طلا + پیگیری TP1/TP2/TP3 و SL</span>
                  </label>
                  <div className="relative">
                    <input
                      id="tg-channel-id"
                      type="text"
                      placeholder="مثال: @AzariTradeChannel یا -1001234567890"
                      value={channelChatId}
                      onChange={(e) => setChannelChatId(e.target.value)}
                      autoComplete="off"
                      dir="ltr"
                      required
                      className="pl-10"
                    />
                    <Radio className="w-4 h-4 text-[#38e8ff] absolute left-3 top-3.5 pointer-events-none" />
                  </div>
                  <p className="text-[11px] text-[#8b949e] mt-1">ربات باید در کانال با دسترسی ارسال پیام (ادمین) باشد.</p>
                </div>

                <div className="mystic-form-group">
                  <label htmlFor="tg-admin-id" className="flex items-center justify-between gap-2">
                    <span>چت‌آیدی شخصی من (اختیاری)</span>
                    <span className="text-[10px] text-[#39ffb6]">هشدار کهنگی/سلامت داده</span>
                  </label>
                  <div className="relative">
                    <input
                      id="tg-admin-id"
                      type="text"
                      placeholder="مثال: 123456789"
                      value={adminChatId}
                      onChange={(e) => setAdminChatId(e.target.value)}
                      autoComplete="off"
                      dir="ltr"
                      className="pl-10"
                    />
                    <ShieldCheck className="w-4 h-4 text-[#39ffb6] absolute left-3 top-3.5 pointer-events-none" />
                  </div>
                  <p className="text-[11px] text-[#8b949e] mt-1">
                    اگر داده کندل بیش از ۱۰ دقیقه کهنه شود، پیام هشدار فقط به همین چت می‌رود (نه به کانال). برای گرفتن آیدی، یک‌بار در تلگرام به ربات /start بدهید.
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-[#0f3a55]/50">
                  {isAlreadyConnected && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditing(false);
                        setResultMessage(null);
                      }}
                      className="mystic-btn px-4 py-2.5 rounded-xl text-xs text-[#d8ecfa] transition cursor-pointer"
                    >
                      انصراف
                    </button>
                  )}
                  <button type="submit" disabled={loading} className="mystic-form-submit-btn">
                    {loading ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>در حال اعتبارسنجی و ذخیره...</span>
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4" />
                        <span>ذخیره تنظیمات تلگرام</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
