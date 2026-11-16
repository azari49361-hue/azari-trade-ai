import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from './components/Header';
import { SymbolCardList } from './components/SymbolCardList';
import { LiveTradingChart } from './components/LiveTradingChart';
import { isOpenTrade } from './utils/tradePnl';
import { AlertsBox } from './components/AlertsBox';
import { SignalCardsList } from './components/SignalCardsList';
import { TelegramBotModal } from './components/TelegramBotModal';
import { DeploymentGuideModal } from './components/DeploymentGuideModal';
import { DataSourceModal } from './components/DataSourceModal';
import { SourceStatusPanel } from './components/SourceStatusPanel';
import { CandleHealthCard } from './components/CandleHealthCard';
import { ScanHistoryPanel } from './components/ScanHistoryPanel';
import { BacktestPanel } from './components/BacktestPanel';
import { NewsDigestCard } from './components/NewsDigestCard';
import { PnlSummaryCards } from './components/PnlSummaryCards';
import { SpectralBackground } from './components/SpectralBackground';
import { AppState, QuoteData, SourceDetails } from './types';
import { soundPlayer } from './utils/sound';
import { postJson, apiUrl, isJsonResponse, API_BASE } from './utils/api';
import { useAdaptivePolling } from './utils/adaptivePolling';
import { Activity, Zap, RefreshCw } from 'lucide-react';

/** آخرین اسکن به وقت تهران — اگر انجام نشده باشد، «—» */
function formatScanTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('fa-IR', {
      timeZone: 'Asia/Tehran',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
  } catch {
    return '—';
  }
}

export default function App() {
  const [state, setState] = useState<AppState>({
    quotes: {},
    source: 'هیچ منبعی هنوز پاسخ نداده',
    lastSuccessfulFetch: null,
    isWeekend: false,
    marketStatus: {
      isOpen: false,
      isWeekend: false,
      isSaturdayOrSunday: false,
      isDataFresh: false,
      reasonFa: 'در حال بررسی وضعیت بازار…',
      dayFa: 'در حال بررسی',
      currentDayName: '',
      nyTimeStr: '',
      tehranTimeStr: '',
      nextOpenFa: '—',
    },
    telegramConfigured: false,
    telegram: {
      isConnected: false,
      hasToken: false,
      botUsername: '',
      botName: '',
      channelChatId: '',
      adminChatId: '',
    },
    alertBaselines: {},
    alerts: [],
    signals: [],
    trackedGoldSignals: [],
    workerStatus: {
      isOnline: false,
      lastHeartbeat: null,
      lastQuoteAt: null,
      lastScanAt: null,
      lastError: null,
      activeTrackedCount: 0,
    },
    preSignalStatus: null,
    sources: { metaapi: false, twelvedata: false, biquote: false, activeSource: '', lastSuccessfulFetchAt: null },
    feedErrors: [],
    pnlSummary: null,
  });

  const [selectedSymbol, setSelectedSymbol] = useState<string>('XAUUSD');
  const [isBotModalOpen, setIsBotModalOpen] = useState<boolean>(false);
  const [isDeployModalOpen, setIsDeployModalOpen] = useState<boolean>(false);
  const [isSourcesModalOpen, setIsSourcesModalOpen] = useState<boolean>(false);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [sourceDetails, setSourceDetails] = useState<SourceDetails | null>(null);
  const [newsToggling, setNewsToggling] = useState<boolean>(false);
  // سرور (بک‌اند) در دسترس است؟ null = هنوز نمی‌دانیم؛ false = چند درخواست پیاپی به /api جواب JSON نگرفتند
  const [backendUp, setBackendUp] = useState<boolean | null>(null);
  const stateFailures = useRef<number>(0);

  const prevAlertCount = useRef<number>(0);
  const prevSignalCount = useRef<number>(0);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // وضعیت کامل — پولینگ تطبیقی (App پایین همین فایل)
  const fetchState = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(apiUrl('/api/state'));
      if (res.ok && !isJsonResponse(res)) {
        // میزبان استاتیک به‌جای API همان index.html را برگردانده — یعنی بک‌اند اینجا اجرا نمی‌شود
        stateFailures.current += 1;
        if (stateFailures.current >= 2) setBackendUp(false);
        return false;
      }
      if (res.ok) {
        const data: AppState = await res.json();
        stateFailures.current = 0;
        setBackendUp(true);
        setState(data);

        if (prevAlertCount.current > 0 && data.alerts.length > prevAlertCount.current) {
          soundPlayer.playAlert();
        }
        if (prevSignalCount.current > 0 && data.signals.length > prevSignalCount.current) {
          soundPlayer.playSignal();
        }

        prevAlertCount.current = data.alerts.length;
        prevSignalCount.current = data.signals.length;
        return true;
      }
      stateFailures.current += 1;
      if (stateFailures.current >= 2) setBackendUp(false);
      return false;
    } catch {
      // server unreachable — state stays as-is; worker badge will show offline
      stateFailures.current += 1;
      if (stateFailures.current >= 2) setBackendUp(false);
      return false;
    }
  }, []);

  // قیمت زنده — سریع‌ترین حلقه، اما فقط وقتی لازم است
  const fetchLiveQuotes = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(apiUrl('/api/live'));
      if (res.ok) {
        const data = await res.json();
        if (data.quotes) {
          setState((prev) => ({
            ...prev,
            quotes: data.quotes,
            source: data.source || prev.source,
          }));
        }
        return true;
      }
      return false;
    } catch {
      // silent fail
      return false;
    }
  }, []);

  // جزئیات سلامت منابع (منبع هر نماد، اسپرد، سن داده) — کندتر از قیمت‌ها
  const fetchSourceDetails = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(apiUrl('/api/sources'));
      if (res.ok) {
        setSourceDetails((await res.json()) as SourceDetails);
        return true;
      }
      return false;
    } catch {
      // keep last known details
      return false;
    }
  }, []);

  /**
   * پولینگ تطبیقی — جای سه setInterval قبلی (۱٫۲/۲٫۵/۵ ثانیه بدون توقف).
   * تب پنهان صفر درخواست می‌دهد، بازار بسته کند می‌شود و روی گوشی فاصله‌ها بیشتر است.
   * این‌طور مصرف باتری و داده‌ی همراه به‌طور محسوس کم می‌شود بدون اینکه قیمت زنده از دست برود.
   */
  const marketOpen = state.marketStatus?.isOpen === true;
  useAdaptivePolling(fetchState, {
    activeMs: 2500,
    idleMs: 15_000,
    mobileMs: 4000,
    active: marketOpen,
  });
  useAdaptivePolling(fetchLiveQuotes, {
    activeMs: 1200,
    mobileMs: 3000,
    idleMs: 20_000,
    active: marketOpen,
  });
  useAdaptivePolling(fetchSourceDetails, {
    activeMs: 5000,
    mobileMs: 10_000,
    idleMs: 30_000,
    active: marketOpen,
  });

  // Manual scan
  const handleTriggerScan = async () => {
    setIsScanning(true);
    try {
      const data = await postJson<any>('/api/scan-now');

      if (data.isMarketClosed) {
        showToast(`⛔ ${data.dayFa || 'بازار تعطیل'}: ${data.message || data.reason}`);
        fetchState();
        return;
      }

      if (data.ok) {
        if (data.generatedCount > 0 && data.goldSignalsCount > 0) {
          showToast(`✅ سیگنال جدید طلا صادر شد و در صف ارسال به کانال است!`);
          soundPlayer.playSignal();
        } else if (data.generatedCount > 0) {
          showToast(`🔍 ${data.generatedCount} سیگنال جدید در بازار انجام شد.`);
          soundPlayer.playAlert();
        } else {
          const why = data.skipped?.[0] ? ` (${data.skipped[0].symbol}: ${data.skipped[0].reason})` : '';
          showToast(`🔍 اسکن کامل شد. شرایط ورود مهیا نیست${why}`);
        }
        fetchState();
      } else {
        showToast(data.error || data.message || 'اسکن انجام نشد.');
      }
    } catch (err: any) {
      showToast(err?.message || 'خطا در انجام اسکن.');
    } finally {
      setIsScanning(false);
    }
  };

  const handleToggleNewsBlackout = async () => {
    const current = state.newsBlackout?.enabled ?? true;
    setNewsToggling(true);
    try {
      const data = await postJson<any>('/api/news-blackout', { enabled: !current });
      if (data.ok) {
        showToast(data.enabled ? '📰 سکوت خبری فعال شد.' : '📰 سکوت خبری غیرفعال شد.');
        fetchState();
      } else {
        showToast(data.error || 'خطا در تغییر وضعیت سکوت خبری.');
      }
    } catch (err: any) {
      showToast(err?.message || 'خطا در تغییر وضعیت سکوت خبری.');
    } finally {
      setNewsToggling(false);
    }
  };

  const handleTestAlert = async (symbol: string) => {
    try {
      const d = await postJson<any>('/api/test-alert', { symbol });
      if (d.ok) {
        soundPlayer.playAlert();
        showToast('🔔 هشدار قیمت آزمایشی ثبت شد.');
        fetchState();
      }
    } catch (err: any) {
      showToast(err?.message || 'خطا در ارسال هشدار تستی.');
    }
  };

  const currentQuote: QuoteData | undefined = state.quotes[selectedSymbol];
  // معاملهٔ بازِ نماد انتخاب‌شده — روی نمودار زنده نمایش داده می‌شود
  const activeSignal = state.signals.find((s) => s.symbol === selectedSymbol && isOpenTrade(s.status)) ?? null;

  return (
    <div className="relative min-h-screen text-[#d8d0e0] flex flex-col selection:bg-[#5a1030] selection:text-white">
      <SpectralBackground />
      <div className="mystic-fog" aria-hidden="true"></div>
      <div className="mystic-fog mystic-fog-2" aria-hidden="true"></div>
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 left-5 z-50 mystic-frame bg-[#071522]/95 border border-[#1a5a7a]/60 text-white text-xs px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2 animate-in slide-in-from-bottom duration-200 backdrop-blur-sm">
          <Activity className="w-4 h-4 text-[#39ffb6]" />
          <span>{toastMessage}</span>
        </div>
      )}

      <Header
        source={state.source}
        isWeekend={state.isWeekend}
        marketStatus={state.marketStatus}
        telegramConfigured={state.telegramConfigured}
        telegram={state.telegram}
        workerStatus={state.workerStatus}
        sources={state.sources}
        feedErrors={state.feedErrors}
        onOpenBotModal={() => setIsBotModalOpen(true)}
        onOpenSourcesModal={() => setIsSourcesModalOpen(true)}
        onOpenDeployModal={() => setIsDeployModalOpen(true)}
        soundEnabled={soundEnabled}
        setSoundEnabled={setSoundEnabled}
        onNotify={showToast}
      />

      <main className="relative z-10 flex-1 max-w-7xl w-full mx-auto p-3 sm:p-5 space-y-5">
        {backendUp === false && (
          <div
            role="alert"
            className="rounded-xl border border-[#da3633]/50 bg-[#da3633]/10 px-3.5 py-3 text-xs leading-6 text-[#ffb4ae]"
          >
            <div className="font-bold text-[#f85149] mb-1">سرور (بک‌اند) در دسترس نیست</div>
            <div>
              این صفحه بالا آمده ولی به <span className="font-mono" dir="ltr">{API_BASE || window.location.origin}/api</span> جواب
              نمی‌گیرد؛ برای همین قیمت و سیگنال نشان داده نمی‌شود. این اپ علاوه بر صفحه، یک سرور Node و دیتابیس
              PostgreSQL لازم دارد و روی میزبان‌های فقط‌استاتیک (مثل Netlify یا GitHub Pages) اجرا نمی‌شود.
              راه‌حل: بک‌اند را روی Render/Koyeb/VPS بالا بیاورید و اگر صفحه جداست، آدرسش را در
              <span className="font-mono" dir="ltr"> VITE_API_BASE </span>
              بگذارید. راهنمای قدم‌به‌قدم: <span className="font-mono" dir="ltr">docs/FIX-CONNECTION.md</span>
            </div>
          </div>
        )}

        {/* جمع سود/ضرر تحقق‌یافته — بالای داشبورد */}
        <PnlSummaryCards summary={state.pnlSummary} />

        {/* Quick scan — no settings needed */}
        <section className="mystic-frame flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#1a5a7a]/60 bg-[#071522]/70 px-3.5 py-2.5 backdrop-blur-sm">
          <div className="flex items-center gap-2 flex-wrap">
            <Zap className="w-4 h-4 text-[#00e5ff] drop-shadow-[0_0_8px_rgba(255,70,100,0.7)]" />
            <span className="text-xs font-bold text-[#e6f6ff]">اسکن سریع بازار</span>
            <span className="text-[11px] text-[#b8a7b5]">بدون رفتن به تنظیمات — فقط کندل بسته M5 و شرایط ورود طلا بررسی می‌شود</span>
          </div>

          <div className="flex items-center gap-3">
            {(() => {
              const sh = state.scanHealth;
              if (!sh) return null;
              const mins = sh.stalledForMs != null ? Math.max(1, Math.round(sh.stalledForMs / 60_000)) : null;
              const view =
                sh.state === 'OK'
                  ? { text: 'اسکن سالم', cls: 'bg-[#238636]/20 text-[#3fb950] border-[#238636]/40' }
                  : sh.state === 'STALLED'
                  ? { text: `⛔ اسکن متوقف${mins ? ` — ${mins} دقیقه` : ''}`, cls: 'bg-[#da3633]/20 text-[#f85149] border-[#da3633]/50' }
                  : sh.state === 'WAITING'
                  ? { text: 'در انتظار اولین اسکن', cls: 'bg-[#d29922]/15 text-[#e3b341] border-[#d29922]/40' }
                  : { text: 'بازار بسته — اسکن متوقف', cls: 'bg-[#21262d] text-[#8b949e] border-[#30363d]' };
              return (
                <span
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-mono ${view.cls}`}
                  title={sh.lastError || sh.lastBlockedReason || 'چرخهٔ اسکن هر چند ثانیه اجرا می‌شود'}
                >
                  <Activity className="w-3 h-3" />
                  <span>{view.text}</span>
                  {sh.timeoutRecoveries > 0 && <span className="opacity-80">· بازیابی {sh.timeoutRecoveries}</span>}
                </span>
              );
            })()}
            <span className="text-[10px] font-mono text-[#b8a7b5]" title={state.workerStatus.lastScanAt || 'هنوز اسکنی انجام نشده'}>
              آخرین اسکن: {formatScanTime(state.workerStatus.lastScanAt)}
            </span>
            <button
              onClick={handleTriggerScan}
              disabled={isScanning}
              className="mystic-btn flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition shadow-sm disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
              <span>{isScanning ? 'در حال اسکن…' : 'اسکن سریع'}</span>
            </button>

            <button
              onClick={handleToggleNewsBlackout}
              disabled={newsToggling}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition shadow-sm disabled:opacity-50 cursor-pointer border ${
                state.newsBlackout?.enabled
                  ? 'bg-[#238636]/20 text-[#3fb950] border-[#238636]/40'
                  : 'bg-[#21262d] text-[#8b949e] border-[#30363d]'
              }`}
              title={state.newsBlackout?.inBlackout ? `سکوت فعال: ${state.newsBlackout.currentEvent?.title}` : 'تغییر وضعیت سکوت خبری'}
            >
              <span>📰</span>
              <span>{state.newsBlackout?.enabled ? 'سکوت خبری: فعال' : 'سکوت خبری: خاموش'}</span>
              {state.newsBlackout?.inBlackout && <span className="text-[9px] opacity-80">(در سکوت)</span>}
            </button>
          </div>

          {state.scanHealth?.state === 'STALLED' && (
            <div className="w-full text-[10px] text-[#f85149] bg-[#da3633]/10 border border-[#da3633]/30 rounded-lg px-2 py-1">
              اسکن بیش از {Math.max(1, Math.round((state.scanHealth.thresholdMs || 180000) / 60_000))} دقیقه کامل نشده است — علت:{' '}
              <span className="font-mono">{state.scanHealth.lastError || state.scanHealth.lastBlockedReason || 'نامشخص'}</span>. ناظر خودکار در حال
              بازیابی است (آزادسازی قفل، پاک‌کردن کش کندل و پول تازهٔ فید).
              {state.scanHealth.adminChatConfigured ? ' هشدار تلگرام به چت شخصی ارسال شد.' : ' برای هشدار تلگرام، چت شخصی مالک را تنظیم کنید.'}
            </div>
          )}
        </section>

        {/* Live Watch Cards */}
        <section>
          <SymbolCardList
            quotes={state.quotes}
            selectedSymbol={selectedSymbol}
            onSelectSymbol={(sym) => setSelectedSymbol(sym)}
          />
        </section>

        {/* Price source health + candle staleness watchdog */}
        <section className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-stretch">
          <div className="mystic-frame rounded-2xl xl:col-span-2">
            <SourceStatusPanel details={sourceDetails} onOpenSources={() => setIsSourcesModalOpen(true)} />
          </div>
          <div className="mystic-frame rounded-2xl xl:col-span-1">
            <CandleHealthCard status={state.candleHealth} />
          </div>
        </section>

        {/* تاریخچهٔ رد اسکن‌ها — دروازه و دلیل، مستقیم از داشبورد */}
        <section>
          <ScanHistoryPanel />
        </section>

        {/* متریک‌های بک‌تست مجموعه‌پارامتر فعلی — تنظیم با عدد، نه حدس */}
        <section>
          <BacktestPanel />
        </section>

        {/* خبر روزانهٔ کانال — پیش‌نمایش، زمان ارسال بعدی، ارسال دستی */}
        <section>
          <NewsDigestCard />
        </section>

        {/* Live Chart */}
        <section>
          <LiveTradingChart selectedSymbol={selectedSymbol} quote={currentQuote} activeSignal={activeSignal} />
        </section>

        {/* Alerts + Signals */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <section className="mystic-frame rounded-2xl lg:col-span-1">
            <AlertsBox
              alerts={state.alerts}
              baselines={state.alertBaselines}
              isWeekend={state.isWeekend}
              marketStatus={state.marketStatus}
              telegramConfigured={state.telegramConfigured}
              onTestAlert={handleTestAlert}
            />
          </section>

          <section className="lg:col-span-2">
            <SignalCardsList
              signals={state.signals}
              trackedGoldSignals={state.trackedGoldSignals}
              marketStatus={state.marketStatus}
              preSignalStatus={state.preSignalStatus}
              quotes={state.quotes}
            />
          </section>
        </div>
      </main>

      <TelegramBotModal
        isOpen={isBotModalOpen}
        onClose={() => setIsBotModalOpen(false)}
        telegramState={state.telegram}
        sources={state.sources}
        onSuccess={fetchState}
        onNotify={showToast}
      />

      <DataSourceModal
        isOpen={isSourcesModalOpen}
        onClose={() => setIsSourcesModalOpen(false)}
        sources={state.sources}
        details={sourceDetails}
        onSuccess={() => {
          fetchState();
          fetchSourceDetails();
        }}
        onNotify={showToast}
      />

      <DeploymentGuideModal isOpen={isDeployModalOpen} onClose={() => setIsDeployModalOpen(false)} />

      {/* Footer Info */}
      <footer className="relative z-10 mystic-frame border-t border-[#0f3a55]/60 bg-[#050d1a]/85 px-4 py-3 text-xs text-[#b8a7b5] backdrop-blur-sm">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${state.workerStatus.isOnline ? 'bg-[#39ffb6] shadow-[0_0_10px_rgba(127,255,212,0.8)] animate-pulse' : 'bg-[#00e5ff] shadow-[0_0_10px_rgba(255,77,109,0.8)]'}`}
            ></span>
            <span>
              Azari Trade AI — مانیتورینگ زنده بازار
              {state.workerStatus.isOnline ? ' (بک‌اند فعال)' : ' (بک‌اند پاسخ نمی‌دهد)'}
            </span>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-[#a892a8]">
            <span>همه پیام‌ها در یک مقصد: کانال (سیگنال طلا + پیگیری TP1/TP2/TP3 و SL)</span>
            <span>ذخیره دائمی در PostgreSQL</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
