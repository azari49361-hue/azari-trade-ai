import React, { useEffect, useState } from 'react';
import { SlicedText } from './SlicedText';
import {
  Send,
  FileCode2,
  Radio,
  Calendar,
  Clock,
  AlertTriangle,
  ServerCrash,
  Database,
} from 'lucide-react';
import { TelegramConfigState, MarketStatus, WorkerStatus, SourcesStatus } from '../types';
import { soundPlayer } from '../utils/sound';
import { InstallAppButton } from './InstallAppButton';

interface HeaderProps {
  source: string;
  isWeekend: boolean;
  marketStatus?: MarketStatus;
  telegramConfigured: boolean;
  telegram: TelegramConfigState;
  workerStatus: WorkerStatus;
  sources: SourcesStatus;
  feedErrors: string[];
  onOpenBotModal: () => void;
  onOpenSourcesModal: () => void;
  onOpenDeployModal: () => void;
  soundEnabled: boolean;
  setSoundEnabled: (val: boolean) => void;
  onNotify: (msg: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  source,
  isWeekend,
  marketStatus,
  telegramConfigured,
  telegram,
  workerStatus,
  sources,
  feedErrors,
  onOpenBotModal,
  onOpenSourcesModal,
  onOpenDeployModal,
  soundEnabled,
  setSoundEnabled,
  onNotify,
}) => {
  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    soundPlayer.setEnabled(next);
    if (next) soundPlayer.playAlert();
  };

  const [isDayMode, setIsDayMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('azari_theme') === 'day';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      if (isDayMode) {
        document.body.classList.add('day-mode');
        document.documentElement.classList.add('day-mode');
        localStorage.setItem('azari_theme', 'day');
      } else {
        document.body.classList.remove('day-mode');
        document.documentElement.classList.remove('day-mode');
        localStorage.setItem('azari_theme', 'night');
      }
    } catch {
      // ignore storage errors
    }
  }, [isDayMode]);

  // Honest connection badge based on actual configured sources + live state
  const isMetaLive = sources.metaapi && marketStatus?.isDataFresh;
  const connectionBadge = !marketStatus?.isDataFresh ? (
    <span className="flex items-center gap-1 text-[11px] font-mono px-1.5 py-0.5 rounded bg-[#da3633]/20 text-[#f85149] border border-[#da3633]/40">
      <AlertTriangle className="w-3 h-3" />
      <SlicedText text="اتصال برقرار نیست" mainSize="0.75rem" textColor="#f85149" shadowColor="#ff9b54" shineColor="#ff4d6d40" width="7.8em" />
    </span>
  ) : isMetaLive ? (
    <span className="flex items-center gap-1 text-[11px] font-mono px-1.5 py-0.5 rounded bg-[#238636]/20 text-[#3fb950] border border-[#238636]/40">
      <span className="w-1.5 h-1.5 rounded-full bg-[#3fb950] animate-pulse"></span>
      <SlicedText text="MT5 LIVE" mainSize="0.8rem" textColor="#3fb950" shadowColor="#39ffb6" shineColor="#3fb95040" width="4.8em" />
    </span>
  ) : (
    <span className="flex items-center gap-1 text-[11px] font-mono px-1.5 py-0.5 rounded bg-[#d29922]/20 text-[#e3b341] border border-[#d29922]/40">
      <Radio className="w-3 h-3" />
      <SlicedText text={source || 'منبع عمومی'} mainSize="0.75rem" textColor="#e3b341" shadowColor="#ffd36a" shineColor="#e3b34140" width={`${Math.max(5, (source || 'منبع عمومی').length * 0.75)}em`} />
    </span>
  );

  return (
    <header className="mystic-frame border-b border-[#0f3a55]/60 bg-[#050d1a]/80 backdrop-blur-md sticky top-0 z-40 px-4 py-3 shadow-[0_10px_40px_rgba(0,40,80,0.35)]">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-3">
        {/* Brand & Status */}
        <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-start">
          <div className="flex items-center gap-2.5">
            <img
              src="/icon-512.png"
              alt="Azari Trade AI"
              width={40}
              height={40}
              className="w-10 h-10 rounded-full ring-1 ring-[#d29922]/45 shadow-lg shadow-black/40 shrink-0"
            />
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <SlicedText text="Azari Trade AI" mainSize="1.15rem" textColor="#e6f6ff" shadowColor="#38e8ff" shineColor="#00e5ff40" className="brand-sliced" />
                {connectionBadge}
              </div>
              <p className="hidden sm:block text-xs text-[#8b949e]">
                دیده‌بان زنده طلا، دلار، نقره و نفت — همه هشدارها در یک کانال تلگرام
              </p>
            </div>
          </div>

          <button
            onClick={onOpenBotModal}
            className="mystic-btn md:hidden p-2 rounded-lg border text-[#c9d1d9]"
            title="تنظیمات ربات تلگرام"
          >
            <Send className={`w-4 h-4 ${telegramConfigured ? 'text-[#39ffb6]' : 'text-[#ff9b54]'}`} />
          </button>
        </div>

        {/* Live System Badges */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Market Status */}
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-medium ${
              marketStatus?.isSaturdayOrSunday
                ? 'bg-[#da3633]/15 border-[#da3633]/50 text-[#f85149]'
                : marketStatus && !marketStatus.isOpen
                ? 'bg-[#d29922]/15 border-[#d29922]/50 text-[#f0883e]'
                : isWeekend
                ? 'bg-[#d29922]/10 border-[#d29922]/40 text-[#f0883e]'
                : 'bg-[#238636]/10 border-[#238636]/40 text-[#3fb950]'
            }`}
            title={
              marketStatus
                ? `${marketStatus.reasonFa}\nزمان نیویورک: ${marketStatus.nyTimeStr}\nزمان تهران: ${marketStatus.tehranTimeStr}\n${marketStatus.nextOpenFa}`
                : 'در حال دریافت وضعیت بازار…'
            }
          >
            {marketStatus?.isSaturdayOrSunday ? (
              <Calendar className="w-3.5 h-3.5" />
            ) : marketStatus?.isWeekend ? (
              <Clock className="w-3.5 h-3.5" />
            ) : (
              <Radio className="w-3.5 h-3.5" />
            )}
            {(() => {
              const label = marketStatus ? (marketStatus.isOpen ? 'بازار باز' : marketStatus.dayFa) : '—';
              const isOpen = Boolean(marketStatus?.isOpen);
              const isClosedWarn = Boolean(marketStatus && !marketStatus.isOpen);
              const color = isOpen ? '#3fb950' : isClosedWarn ? '#f0883e' : '#e3b341';
              const shadow = isOpen ? '#39ffb6' : '#ffd36a';
              return <SlicedText text={label} mainSize="0.78rem" textColor={color} shadowColor={shadow} shineColor={`${color}40`} width={`${Math.max(4.5, label.length * 0.8)}em`} />;
            })()}
          </div>

          {/* REAL worker status from heartbeat */}
          <div
            className={`hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-md border ${
              workerStatus.isOnline
                ? 'bg-[#040b18] border-[#0f3a55] text-[#3fb950]'
                : 'bg-[#da3633]/15 border-[#da3633]/50 text-[#f85149]'
            }`}
            title={
              workerStatus.isOnline
                ? `آخرین heartbeat: ${workerStatus.lastHeartbeat || '—'}\nآخرین اسکن: ${workerStatus.lastScanAt || '—'}`
                : 'بک‌اند پاسخ نمی‌دهد — داده‌ها ممکن است کهنه باشند.'
            }
          >
            {workerStatus.isOnline ? (
              <span className="w-1.5 h-1.5 rounded-full bg-[#3fb950] animate-ping"></span>
            ) : (
              <ServerCrash className="w-3.5 h-3.5" />
            )}
            <SlicedText
              text={workerStatus.isOnline ? 'بک‌اند فعال' : 'بک‌اند آفلاین'}
              mainSize="0.75rem"
              textColor={workerStatus.isOnline ? '#3fb950' : '#f85149'}
              shadowColor={workerStatus.isOnline ? '#39ffb6' : '#ff9b54'}
              shineColor={workerStatus.isOnline ? '#3fb95040' : '#f8514940'}
              width="6.2em"
            />
          </div>

          {/* Feed error hint */}
          {feedErrors.length > 0 && (
            <span
              className="flex items-center gap-1 px-2 py-1 rounded-md bg-[#d29922]/15 border border-[#d29922]/40 text-[#e3b341] text-[11px]"
              title={feedErrors.join('\n')}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <SlicedText text="خطای منبع قیمت" mainSize="0.72rem" textColor="#e3b341" shadowColor="#ffd36a" shineColor="#e3b34140" width="7em" />
            </span>
          )}

          {/* Telegram */}
          <button
            onClick={onOpenBotModal}
            className={`mystic-btn flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-medium transition cursor-pointer ${
              telegramConfigured
                ? 'text-[#39ffb6]'
                : 'text-[#7cf3ff]'
            }`}
            title="تنظیمات تلگرام (کانال)"
          >
            <Send className="w-3.5 h-3.5" />
            {telegramConfigured ? (
              <SlicedText text={`تلگرام متصل (@${telegram.botUsername || 'bot'})`} mainSize="0.7rem" textColor="#39ffb6" shadowColor="#7cf3ff" shineColor="#39ffb640" width={`${Math.max(7, (`تلگرام متصل (@${telegram.botUsername || 'bot'})`).length * 0.55)}em`} />
            ) : (
              <SlicedText text="اتصال به تلگرام" mainSize="0.72rem" textColor="#7cf3ff" shadowColor="#38e8ff" shineColor="#7cf3ff40" width="7.2em" />
            )}
          </button>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 w-full md:w-auto justify-end shrink-0 flex-wrap">
          <div className="toggle-container" title={isDayMode ? 'حالت روز (کلیک برای شب)' : 'حالت شب (کلیک برای روز)'}>
            <div className="toggle-wrap">
              <input
                className="toggle-input"
                id="holo-toggle"
                type="checkbox"
                checked={isDayMode}
                onChange={(e) => setIsDayMode(e.target.checked)}
                aria-label={isDayMode ? 'تغییر به حالت شب' : 'تغییر به حالت روز'}
              />
              <label className="toggle-track" htmlFor="holo-toggle">
                <div className="track-lines">
                  <div className="track-line"></div>
                </div>

                <div className="toggle-thumb">
                  <div className="thumb-core"></div>
                  <div className="thumb-inner"></div>
                  <div className="thumb-scan"></div>
                  <div className="thumb-particles">
                    <div className="thumb-particle"></div>
                    <div className="thumb-particle"></div>
                    <div className="thumb-particle"></div>
                    <div className="thumb-particle"></div>
                    <div className="thumb-particle"></div>
                  </div>
                </div>

                <div className="toggle-data">
                  <div className="data-text off">شب</div>
                  <div className="data-text on">روز</div>
                  <div className="status-indicator off"></div>
                  <div className="status-indicator on"></div>
                </div>

                <div className="energy-rings">
                  <div className="energy-ring"></div>
                  <div className="energy-ring"></div>
                  <div className="energy-ring"></div>
                </div>

                <div className="interface-lines">
                  <div className="interface-line"></div>
                  <div className="interface-line"></div>
                  <div className="interface-line"></div>
                  <div className="interface-line"></div>
                  <div className="interface-line"></div>
                  <div className="interface-line"></div>
                </div>

                <div className="toggle-reflection"></div>
                <div className="holo-glow"></div>
              </label>
            </div>
          </div>

          <InstallAppButton onNotify={onNotify} />

          <label
            className="sound-toggle mystic-btn p-1.5 rounded-lg border"
            title={soundEnabled ? 'صدا فعال است (کلیک برای بی‌صدا)' : 'صدا غیرفعال است (کلیک برای فعال‌سازی)'}
          >
            <input
              type="checkbox"
              checked={soundEnabled}
              onChange={toggleSound}
              aria-label={soundEnabled ? 'غیرفعال کردن صدا' : 'فعال کردن صدا'}
            />
            <svg viewBox="0 0 576 512" height="1em" xmlns="http://www.w3.org/2000/svg" className="mute" aria-hidden="true">
              <path d="M301.1 34.8C312.6 40 320 51.4 320 64V448c0 12.6-7.4 24-18.9 29.2s-25 3.1-34.4-5.3L131.8 352H64c-35.3 0-64-28.7-64-64V224c0-35.3 28.7-64 64-64h67.8L266.7 40.1c9.4-8.4 22.9-10.4 34.4-5.3zM425 167l55 55 55-55c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9l-55 55 55 55c9.4 9.4 9.4 24.6 0 33.9s-24.6 9.4-33.9 0l-55-55-55 55c-9.4 9.4-24.6 9.4-33.9 0s-9.4-24.6 0-33.9l55-55-55-55c-9.4-9.4-9.4-24.6 0-33.9s24.6-9.4 33.9 0z"></path>
            </svg>
            <svg viewBox="0 0 448 512" height="1em" xmlns="http://www.w3.org/2000/svg" className="voice" aria-hidden="true">
              <path d="M301.1 34.8C312.6 40 320 51.4 320 64V448c0 12.6-7.4 24-18.9 29.2s-25 3.1-34.4-5.3L131.8 352H64c-35.3 0-64-28.7-64-64V224c0-35.3 28.7-64 64-64h67.8L266.7 40.1c9.4-8.4 22.9-10.4 34.4-5.3zM412.6 181.5C434.1 199.1 448 225.9 448 256s-13.9 56.9-35.4 74.5c-10.3 8.4-25.4 6.8-33.8-3.5s-6.8-25.4 3.5-33.8C393.1 284.4 400 271 400 256s-6.9-28.4-17.7-37.3c-10.3-8.4-11.8-23.5-3.5-33.8s23.5-11.8 33.8-3.5z"></path>
            </svg>
          </label>

          <button
            onClick={onOpenSourcesModal}
            className="mystic-btn flex items-center gap-1.5 px-2.5 py-2 sm:py-1.5 rounded-lg border text-xs text-[#d8ecfa] transition cursor-pointer whitespace-nowrap shrink-0"
            title="منابع داده قیمت (TwelveData / MetaApi)"
          >
            <Database className={`w-3.5 h-3.5 ${sources.twelvedata ? 'text-[#39ffb6]' : 'text-[#7c9cff]'}`} />
            <span className="hidden sm:inline">منابع داده</span>
          </button>

          <button
            onClick={onOpenDeployModal}
            className="mystic-btn flex items-center gap-1.5 px-2.5 py-2 sm:py-1.5 rounded-lg border text-xs text-[#d8ecfa] transition cursor-pointer whitespace-nowrap shrink-0"
            title="راهنمای استقرار Docker روی سرور"
          >
            <FileCode2 className="w-3.5 h-3.5 text-[#ff9b54]" />
            <span className="hidden sm:inline">راهنمای استقرار</span>
          </button>
        </div>
      </div>
    </header>
  );
};
