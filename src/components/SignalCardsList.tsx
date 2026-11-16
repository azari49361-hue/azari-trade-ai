import React, { useState } from 'react';
import { TradeSignal, MarketStatus, PreSignalStatus, SignalStatus, QuoteData } from '../types';
import {
  Zap,
  Send,
  Clock,
  TrendingUp,
  TrendingDown,
  Radio,
  Users,
  Check,
  Calendar,
  AlertOctagon,
  Hourglass,
  ShieldAlert,
  History,
} from 'lucide-react';
import { formatPersianDateTime } from '../utils/dateTime';
import { digitsFor } from '../utils/digits';
import { SignalAnimatedText } from './SignalAnimatedText';
import { SignalScanPath } from './SignalScanPath';
import { computeTradePnl, formatPnl, isOpenTrade, tradeProgress, computePositionSize } from '../utils/tradePnl';

interface SignalCardsListProps {
  signals: TradeSignal[];
  trackedGoldSignals?: TradeSignal[];
  marketStatus?: MarketStatus;
  preSignalStatus?: PreSignalStatus | null;
  /** قیمت زندهٔ هر نماد برای نمایش سود/ضرر لحظه‌ای معامله‌های باز. */
  quotes?: Record<string, QuoteData>;
}

/** ورودی‌های مشترک موجودی/ریسک برای محاسبهٔ حجم موقعیت. */
const PositionSizeInputs: React.FC<{
  balance: number;
  riskPct: number;
  setBalance: (v: number) => void;
  setRiskPct: (v: number) => void;
  compact?: boolean;
}> = ({ balance, riskPct, setBalance, setRiskPct, compact }) => {
  const balCls = compact
    ? 'w-12 px-1 py-0.5 rounded bg-[#0d1117] border border-[#30363d] text-[9px] text-white'
    : 'w-14 px-1 py-0.5 rounded bg-[#0d1117] border border-[#30363d] text-[10px] text-white';
  const riskCls = compact
    ? 'w-9 px-1 py-0.5 rounded bg-[#0d1117] border border-[#30363d] text-[9px] text-white'
    : 'w-10 px-1 py-0.5 rounded bg-[#0d1117] border border-[#30363d] text-[10px] text-white';
  const lblCls = compact ? 'text-[9px]' : 'text-[9px] opacity-70';
  return (
    <>
      <input
        type="number"
        min={0}
        step={100}
        value={balance}
        onChange={(e) => { const v = Number(e.target.value); setBalance(v); }}
        className={balCls}
        title="موجودی حساب"
      />
      <span className={lblCls}>$</span>
      <input
        type="number"
        min={0.1}
        max={100}
        step={0.5}
        value={riskPct}
        onChange={(e) => { const v = Number(e.target.value); setRiskPct(v); }}
        className={riskCls}
        title="درصد ریسک"
      />
      <span className={lblCls}>%</span>
    </>
  );
};

/** نوار سود/ضرر زندهٔ معامله — هر رندر با قیمت تازه به‌روز می‌شود (هر ثانیه). */
const LivePnlRow: React.FC<{
  sig: TradeSignal;
  digits: number;
  quotes?: Record<string, QuoteData>;
  balance: number;
  riskPct: number;
  setBalance: (v: number) => void;
  setRiskPct: (v: number) => void;
}> = ({ sig, digits, quotes, balance, riskPct, setBalance, setRiskPct }) => {
  if (!isOpenTrade(sig.status)) return null;
  const price = quotes?.[sig.symbol]?.mid;
  const pnl = computeTradePnl(sig, price);
  if (!pnl) return null;
  const progress = tradeProgress(sig, price);
  const posSize = computePositionSize(sig, balance, riskPct);
  return (
    <div
      className={`flex items-center justify-between gap-2 px-2 py-1 mb-2 rounded border text-[11px] font-mono ${
        pnl.inProfit ? 'bg-[#238636]/15 border-[#238636]/40 text-[#3fb950]' : 'bg-[#da3633]/15 border-[#da3633]/40 text-[#f85149]'
      }`}
    >
      <SignalAnimatedText
        text={pnl.inProfit ? '↗ در سود' : '↘ در ضرر'}
        mainSize="0.68rem"
        textColor={pnl.inProfit ? '#3fb950' : '#f85149'}
        shadowColor={pnl.inProfit ? '#39ffb6' : '#ff9b54'}
        shineColor="#ffffff20"
        className="text-right"
      />
      <span dir="ltr" className="flex items-center gap-2">
        <span>
          {formatPnl(pnl, digits)}
        </span>
        <span className="opacity-80">{`${pnl.percent >= 0 ? '+' : '−'}${Math.abs(pnl.percent).toFixed(2)}%`}</span>
        <span className="opacity-60 text-[10px]">{`${pnl.price.toFixed(digits)}`}</span>
      </span>
      {progress && (
        <div className="w-[110px] sm:w-[140px] shrink-0" dir="ltr">
          <div className="relative h-1.5 rounded-full bg-gradient-to-r from-[#da3633]/60 via-[#30363d] to-[#3fb950]/60">
            {/* نشانهٔ نقطهٔ ورود */}
            <span
              className="absolute top-0 h-full w-px bg-white/45"
              style={{ left: `${progress.entryPct}%` }}
              title="نقطهٔ ورود"
            />
            {/* موقعیت لحظه‌ای قیمت */}
            <span
              className={`absolute -top-[2px] w-2 h-2 rounded-full border border-black/40 ${pnl.inProfit ? 'bg-[#3fb950]' : 'bg-[#f85149]'}`}
              style={{ left: `calc(${progress.toTp1Pct}% - 4px)` }}
              title={`${progress.toTp1Pct.toFixed(0)}% تا TP1`}
            />
          </div>
          <div className="flex items-center justify-between mt-0.5 text-[8px] opacity-70">
            <span>{`SL ${progress.toSl.toFixed(digits)}`}</span>
            <span>{`${progress.toTp1Pct.toFixed(0)}%`}</span>
            <span>{`TP1 ${progress.toTp1.toFixed(digits)}`}</span>
          </div>
        </div>
      )}
      {/* محاسبه‌گر حجم موقعیت (position sizing) — موجودی و درصد ریسک */}
      <span className="flex items-center gap-1.5 text-[10px] opacity-80 shrink-0" dir="ltr">
        <span className="text-[9px] opacity-70">حجم:</span>
      <PositionSizeInputs balance={balance} riskPct={riskPct} setBalance={setBalance} setRiskPct={setRiskPct} />
        {posSize && (
          <span className="font-bold text-[#58a6ff]" title={`ریسک: ${posSize.riskAmount.toFixed(2)}$ · فاصله SL: ${posSize.slDistance.toFixed(2)}`}>
            {posSize.lotSize.toFixed(2)} lot
          </span>
        )}
      </span>
    </div>
  );
};

/**
 * فاصلهٔ حد ضرر تا ورود، هم برحسب واحد قیمت (دلار برای طلا) و هم برحسب ATR.
 * با پویا شدن استاپ، این عدد نشان می‌دهد استاپ چقدر پهن‌تر از ATR باز شده است.
 */
function stopDistanceLabel(sig: TradeSignal, digits: number): string {
  const distance = Math.abs(sig.entry - sig.sl);
  const atr = Number(sig.indicators?.atr ?? sig.analysis?.timeframes?.M5?.atr ?? 0);
  const unit = sig.symbol === 'XAUUSD' ? '$' : '';
  const base = `${distance.toFixed(digits)}${unit}`;
  if (!(atr > 0)) return `فاصله تا ورود: ${base}`;
  return `فاصله ${base} · ${(distance / atr).toFixed(2)}×ATR`;
}

const STATUS_META: Record<SignalStatus, { label: string; cls: string }> = {
  PENDING: { label: 'در صف ارسال', cls: 'bg-[#d29922]/20 text-[#e3b341] border-[#d29922]/40' },
  ACTIVE: { label: 'فعال در بازار', cls: 'bg-[#1f6feb]/20 text-[#58a6ff] border-[#1f6feb]/40' },
  TP1_HIT: { label: 'TP1 محقق شد', cls: 'bg-[#238636]/20 text-[#3fb950] border-[#238636]/40' },
  TP2_HIT: { label: 'TP2 محقق شد', cls: 'bg-[#238636]/25 text-[#3fb950] border-[#238636]/50' },
  TP3_HIT: { label: '🏆 تمام اهداف محقق شد', cls: 'bg-[#238636]/30 text-[#3fb950] border-[#238636]/60' },
  SL_HIT: { label: 'حد ضرر لمس شد', cls: 'bg-[#da3633]/25 text-[#f85149] border-[#da3633]/50' },
  REVERSED: { label: '🛑 برگشت سیگنال — بسته شد', cls: 'bg-[#da3633]/25 text-[#f85149] border-[#da3633]/60' },
  CLOSED: { label: 'بسته شده', cls: 'bg-[#21262d] text-[#8b949e] border-[#30363d]' },
};

function StatusPill({ status }: { status: SignalStatus }) {
  const meta = STATUS_META[status] || STATUS_META.CLOSED;
  return (
    <span className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border ${meta.cls}`}>
      <SignalAnimatedText text={meta.label} mainSize="0.72rem" textColor="currentColor" shadowColor="#9bb8d0" shineColor="#ffffff30" />
    </span>
  );
}

function IndicatorsChips({ sig }: { sig: TradeSignal }) {
  const ind = sig.indicators || {};
  const h4 = ind.h4Trend;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono" dir="ltr">
      {ind.ema9 != null && (
        <span className="px-1.5 py-0.2 rounded bg-[#1f6feb]/10 text-[#58a6ff] border border-[#1f6feb]/25">
          <SignalAnimatedText text={`EMA9 ${ind.ema9}`} mainSize="0.68rem" textColor="#58a6ff" shadowColor="#38e8ff" shineColor="#58a6ff20" />
        </span>
      )}
      {ind.ema21 != null && (
        <span className="px-1.5 py-0.2 rounded bg-[#f0883e]/10 text-[#f0883e] border border-[#f0883e]/25">
          <SignalAnimatedText text={`EMA21 ${ind.ema21}`} mainSize="0.68rem" textColor="#f0883e" shadowColor="#ffd36a" shineColor="#f0883e20" />
        </span>
      )}
      {ind.rsi != null && (
        <span className="px-1.5 py-0.2 rounded bg-[#21262d] text-[#c9d1d9] border border-[#30363d]"><SignalAnimatedText text={`RSI ${ind.rsi}`} mainSize="0.68rem" textColor="#c9d1d9" shadowColor="#b9d8ee" shineColor="#ffffff20" /></span>
      )}
      {ind.atr != null && (
        <span className="px-1.5 py-0.2 rounded bg-[#21262d] text-[#c9d1d9] border border-[#30363d]"><SignalAnimatedText text={`ATR ${ind.atr}`} mainSize="0.68rem" textColor="#c9d1d9" shadowColor="#b9d8ee" shineColor="#ffffff20" /></span>
      )}
      {h4 && (
        <span
          className={`px-1.5 py-0.2 rounded border ${
            h4 === 'BULLISH'
              ? 'bg-[#238636]/10 text-[#3fb950] border-[#238636]/30'
              : h4 === 'BEARISH'
              ? 'bg-[#da3633]/10 text-[#f85149] border-[#da3633]/30'
              : 'bg-[#21262d] text-[#8b949e] border-[#30363d]'
          }`}
        >
          <SignalAnimatedText text={`H4 ${h4 === 'BULLISH' ? 'صعودی' : h4 === 'BEARISH' ? 'نزولی' : 'خنثی'}${sig.analysis && !sig.analysis.h4TrendConfirmed ? ' (تاییدنشده)' : ''}`} mainSize="0.68rem" textColor={h4 === 'BULLISH' ? '#3fb950' : h4 === 'BEARISH' ? '#f85149' : '#8b949e'} shadowColor={h4 === 'BULLISH' ? '#39ffb6' : '#ff9b54'} shineColor="#ffffff20" />
        </span>
      )}
      {sig.analysis?.crossOnClosedCandle && (
        <span className="px-1.5 py-0.2 rounded bg-[#21262d] text-[#8b949e] border border-[#30363d]"><SignalAnimatedText text="کندل بسته ✓" mainSize="0.68rem" textColor="#8b949e" shadowColor="#b9d8ee" shineColor="#ffffff20" /></span>
      )}
    </div>
  );
}

/** نمایش فشردهٔ حجم موقعیت برای سیگنال‌های غیرفعال (pending/closed). */
const CompactPositionSize: React.FC<{
  sig: TradeSignal;
  digits: number;
  balance: number;
  riskPct: number;
  setBalance: (v: number) => void;
  setRiskPct: (v: number) => void;
}> = ({ sig, digits, balance, riskPct, setBalance, setRiskPct }) => {
  const posSize = computePositionSize(sig, balance, riskPct);
  if (!posSize) return null;
  return (
    <div className="flex items-center gap-2 px-2 py-1 mb-2 rounded border border-[#1f6feb]/20 bg-[#1f6feb]/5 text-[10px] font-mono" dir="ltr">
      <span className="text-[#58a6ff] opacity-80">حجم پیشنهادی:</span>
      <span className="font-bold text-[#58a6ff]">{posSize.lotSize.toFixed(2)} lot</span>
      <span className="opacity-60 text-[9px]">(ریسک {posSize.riskAmount.toFixed(0)}$ · SL {posSize.slDistance.toFixed(digits)})</span>
      <span className="ml-auto flex items-center gap-1 opacity-70">
        <PositionSizeInputs balance={balance} riskPct={riskPct} setBalance={setBalance} setRiskPct={setRiskPct} compact />
      </span>
    </div>
  );
};

export const SignalCardsList: React.FC<SignalCardsListProps> = ({
  signals,
  trackedGoldSignals = [],
  marketStatus,
  preSignalStatus,
  quotes,
}) => {
  const latestGold = trackedGoldSignals[0] || signals.find((s) => s.symbol === 'XAUUSD');
  const isMarketClosed = marketStatus ? !marketStatus.isOpen : false;
  // کدام کارت، مسیر اسکن همان کندلش را باز کرده است
  const [pathFor, setPathFor] = useState<string | null>(null);
  // کارت اصلی پیگیری طلا، مستقل از کارت‌های شبکه
  const [goldPathOpen, setGoldPathOpen] = useState<boolean>(false);

  // موجودی و ریسک مشترک برای محاسبهٔ حجم موقعیت — یک‌بار در سطح کامپوننت،
  // تا تغییر در یک کارت (LivePnlRow یا CompactPositionSize) بلافاصله در دیگری هم دیده شود.
  const [balance, setBalanceRaw] = useState<number>(() => {
    const v = localStorage.getItem('pos_balance');
    return v ? Number(v) : 1000;
  });
  const [riskPct, setRiskPctRaw] = useState<number>(() => {
    const v = localStorage.getItem('pos_risk');
    return v ? Number(v) : 1;
  });
  const setBalance = (v: number) => {
    setBalanceRaw(v);
    if (v > 0) localStorage.setItem('pos_balance', String(v));
  };
  const setRiskPct = (v: number) => {
    setRiskPctRaw(v);
    if (v > 0) localStorage.setItem('pos_risk', String(v));
  };

  return (
    <div className="mystic-frame bg-[#071522]/75 border border-[#0f3a55]/60 rounded-2xl p-4 flex flex-col shadow-2xl space-y-4 backdrop-blur-sm">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#21262d]">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[#1f6feb]/15 text-[#58a6ff] flex items-center justify-center">
            <Zap className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <SignalAnimatedText text="موتور سیگنال‌دهی و پیگیری اهداف طلا" mainSize="1rem" textColor="#ffffff" shadowColor="#38e8ff" shineColor="#00e5ff40" />
              <span className="text-[10px] bg-[#d29922]/20 text-[#e3b341] px-2 py-0.5 rounded font-mono font-semibold">
                <SignalAnimatedText text="XAUUSD ONLY TELEGRAM" mainSize="0.72rem" textColor="#e3b341" shadowColor="#ffd36a" shineColor="#e3b34140" />
              </span>
            </h3>
            <p className="text-[11px] text-[#8b949e]">
              <SignalAnimatedText text="سیگنال‌های جدید طلا و تحقق اهداف (TP1, TP2, TP3 و SL) همه به کانال تلگرام ارسال می‌شوند" mainSize="0.78rem" textColor="#8b949e" shadowColor="#b9d8ee" shineColor="#ffffff20" />
            </p>
          </div>
        </div>
      </div>

      {/* Market closed banner */}
      {isMarketClosed && marketStatus && (
        <div className="mystic-frame p-3.5 rounded-xl bg-[#081426]/70 border border-[#1a5a7a]/50 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-xs">
          <div className="flex items-start gap-2.5">
            <Calendar className="w-5 h-5 text-[#f85149] shrink-0 mt-0.5" />
            <div>
              <div className="flex items-center gap-2">
                <SignalAnimatedText text={`مدیریت روزهای معاملاتی: ${marketStatus.dayFa}`} mainSize="0.9rem" textColor="#f85149" shadowColor="#ff9b54" shineColor="#f8514940" />
                <span className="text-[10px] bg-[#da3633]/25 text-[#f85149] px-2 py-0.5 rounded font-semibold">
                  <SignalAnimatedText text="تولید و ارسال سیگنال متوقف" mainSize="0.72rem" textColor="#f85149" shadowColor="#ff9b54" shineColor="#f8514940" />
                </span>
              </div>
              <p className="text-[11px] text-[#8b949e] mt-1 leading-relaxed">
                <SignalAnimatedText text={`${marketStatus.reasonFa} سیگنال‌های باز با حفظ وضعیت منتظر بازگشایی بازار می‌مانند و اهداف با قیمت فریز آخر هفته فعال نمی‌شوند.`} mainSize="0.78rem" textColor="#8b949e" shadowColor="#b9d8ee" shineColor="#ffffff20" />
              </p>
            </div>
          </div>
          <div className="text-left shrink-0 bg-[#0d1117] px-3 py-2 rounded-lg border border-[#21262d] font-mono text-[11px] text-[#e3b341]">
            <SignalAnimatedText text="بازگشایی:" mainSize="0.7rem" textColor="#8b949e" shadowColor="#b9d8ee" shineColor="#ffffff20" className="text-right" />
            <SignalAnimatedText text={marketStatus.nextOpenFa} mainSize="0.78rem" textColor="#e3b341" shadowColor="#ffd36a" shineColor="#e3b34140" />
          </div>
        </div>
      )}

      {/* Pre-signal countdown */}
      {preSignalStatus?.active && (
        <div className="mystic-frame p-4 rounded-xl bg-gradient-to-r from-[#2a1020]/70 via-[#120a18]/70 to-[#102018]/60 border border-[#1f6f99]/70 shadow-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-[#e3b341]/20 border border-[#e3b341]/50 text-2xl flex items-center justify-center shrink-0 shadow-md">
              {preSignalStatus.emoji || '⚡'}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <SignalAnimatedText text="⚡ سیگنال جدید در راه است!" mainSize="1rem" textColor="#ffffff" shadowColor="#38e8ff" shineColor="#00e5ff40" />
                <span className="text-[10px] bg-[#e3b341] text-black font-extrabold px-2 py-0.5 rounded-full font-mono">
                  <SignalAnimatedText text={`${preSignalStatus.remainingSeconds}s`} mainSize="0.72rem" textColor="#000000" shadowColor="#7a5a00" shineColor="#e3b34140" />
                </span>
                <span className="text-[10px] bg-[#1f6feb]/25 text-[#58a6ff] border border-[#1f6feb]/40 px-2 py-0.5 rounded font-mono">
                  <SignalAnimatedText text="پیش‌سیگنال کانال" mainSize="0.72rem" textColor="#58a6ff" shadowColor="#38e8ff" shineColor="#58a6ff40" />
                </span>
              </div>
              <div className="text-xs text-[#c9d1d9] mt-1 flex flex-wrap items-center gap-1">
                <SignalAnimatedText text="🎯 نماد:" mainSize="0.82rem" textColor="#c9d1d9" shadowColor="#b9d8ee" shineColor="#ffffff20" />
                <SignalAnimatedText text="XAU/USD (Gold)" mainSize="0.82rem" textColor="#ffffff" shadowColor="#38e8ff" shineColor="#00e5ff30" />
                <SignalAnimatedText text="•" mainSize="0.82rem" textColor="#c9d1d9" shadowColor="#b9d8ee" shineColor="#ffffff20" />
                <SignalAnimatedText text={preSignalStatus.phrase} mainSize="0.82rem" textColor="#e3b341" shadowColor="#ffd36a" shineColor="#e3b34140" />
              </div>
              <p className="text-[11px] text-[#8b949e] mt-0.5">
                <SignalAnimatedText text="برای دیدن سیگنال، پین شدن خودکار پیام‌ها را در کانال تلگرام روشن کنید!" mainSize="0.78rem" textColor="#8b949e" shadowColor="#b9d8ee" shineColor="#ffffff20" />
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 bg-[#0d1117] px-4 py-2.5 rounded-xl border border-[#e3b341]/40 shrink-0 self-stretch md:self-auto justify-between md:justify-start">
            <div className="flex items-center gap-1.5 text-xs text-[#c9d1d9]">
              <Clock className="w-4 h-4 text-[#e3b341] animate-spin" />
              <SignalAnimatedText text="ارسال سیگنال اصلی:" mainSize="0.82rem" textColor="#c9d1d9" shadowColor="#b9d8ee" shineColor="#ffffff20" />
            </div>
            <div className="font-mono text-lg font-black text-[#e3b341] bg-[#161b22] px-2.5 py-0.5 rounded border border-[#21262d]" dir="ltr">
              <SignalAnimatedText text={`00:${String(preSignalStatus.remainingSeconds).padStart(2, '0')}`} mainSize="1rem" textColor="#e3b341" shadowColor="#ffd36a" shineColor="#e3b34130" />
            </div>
          </div>
        </div>
      )}

      {/* Latest gold tracker */}
      {latestGold &&
        (() => {
          const goldDate = latestGold.jalaliDate || formatPersianDateTime(latestGold.createdAt).jalaliDate;
          const goldTime = latestGold.tehranTime || formatPersianDateTime(latestGold.createdAt).time24;
          const sentTime = latestGold.channelSentAt ? formatPersianDateTime(latestGold.channelSentAt).time24 : null;
          const digits = digitsFor('XAUUSD');

          return (
            <div className="mystic-frame signal-arrival-panel p-4 rounded-xl shadow-md">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xl">🥇</span>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <SignalAnimatedText text="XAUUSD (طلا)" mainSize="1rem" textColor="#ffffff" shadowColor="#38e8ff" shineColor="#00e5ff30" />
                      <span
                        className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold border ${
                          latestGold.type === 'BUY'
                            ? 'bg-[#238636]/20 text-[#3fb950] border-[#238636]/50'
                            : 'bg-[#da3633]/20 text-[#f85149] border-[#da3633]/50'
                        }`}
                      >
                        {latestGold.type === 'BUY' ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                        <SignalAnimatedText text={latestGold.type === 'BUY' ? 'BUY (خرید طلا) 🟢' : 'SELL (فروش طلا) 🔴'} mainSize="0.82rem" textColor={latestGold.type === 'BUY' ? '#3fb950' : '#f85149'} shadowColor={latestGold.type === 'BUY' ? '#39ffb6' : '#ff9b54'} shineColor="#ffffff30" />
                      </span>
                      <StatusPill status={latestGold.status} />
                      <span className="text-[10px] bg-[#21262d] text-[#8b949e] px-1.5 py-0.5 rounded font-mono">
                        <SignalAnimatedText text={`${latestGold.timeframe} · RR ${latestGold.rrLabel}`} mainSize="0.72rem" textColor="#8b949e" shadowColor="#b9d8ee" shineColor="#ffffff20" />
                      </span>
                    </div>
                    <p className="text-[11px] text-[#8b949e] mt-0.5"><SignalAnimatedText text={latestGold.reason || ''} mainSize="0.78rem" textColor="#8b949e" shadowColor="#b9d8ee" shineColor="#ffffff20" /></p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  {latestGold.channelSentAt ? (
                    <span className="flex items-center gap-1 px-2 py-1 rounded bg-[#1f6feb]/15 text-[#58a6ff] border border-[#1f6feb]/30">
                      <Radio className="w-3 h-3" />
                      <SignalAnimatedText text="ارسال شده به کانال" mainSize="0.75rem" textColor="#58a6ff" shadowColor="#38e8ff" shineColor="#58a6ff30" />
                    </span>
                  ) : latestGold.status === 'PENDING' ? (
                    <span className="flex items-center gap-1 px-2 py-1 rounded bg-[#d29922]/15 text-[#e3b341] border border-[#d29922]/30">
                      <Hourglass className="w-3 h-3" />
                      <SignalAnimatedText text="در صف ارسال به کانال" mainSize="0.75rem" textColor="#e3b341" shadowColor="#ffd36a" shineColor="#e3b34130" />
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 px-2 py-1 rounded bg-[#21262d] text-[#8b949e] border border-[#30363d]">
                      <ShieldAlert className="w-3 h-3" />
                      <SignalAnimatedText text="ارسال نشده به کانال" mainSize="0.75rem" textColor="#8b949e" shadowColor="#b9d8ee" shineColor="#ffffff20" />
                    </span>
                  )}
                  <span className="flex items-center gap-1 px-2 py-1 rounded bg-[#d29922]/15 text-[#e3b341] border border-[#d29922]/30">
                    <Users className="w-3 h-3" />
                    <SignalAnimatedText text="پیگیری ۲۴ ساعته اهداف در کانال" mainSize="0.75rem" textColor="#e3b341" shadowColor="#ffd36a" shineColor="#e3b34130" />
                  </span>
                </div>
              </div>

              {/* Pricing grid */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 my-3 text-xs font-mono" dir="ltr">
                <div className="p-2.5 rounded-lg bg-[#040b18]/90 border border-[#0f3a55]/50 flex flex-col">
                  <SignalAnimatedText text="ورود (Entry)" mainSize="0.72rem" textColor="#8b949e" shadowColor="#b9d8ee" shineColor="#ffffff20" className="text-right" />
                  <span className="text-white font-bold text-sm mt-0.5"><SignalAnimatedText text={latestGold.entry.toFixed(digits)} mainSize="0.95rem" textColor="#ffffff" shadowColor="#38e8ff" shineColor="#00e5ff30" /></span>
                </div>

                <div
                  className={`p-2.5 rounded-lg border flex flex-col ${
                    latestGold.slHitAt
                      ? 'bg-[#da3633]/25 border-[#da3633] text-[#f85149]'
                      : 'bg-[#da3633]/10 border-[#da3633]/30 text-[#f85149]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <SignalAnimatedText text="حد ضرر (SL)" mainSize="0.72rem" textColor="#f85149" shadowColor="#ff9b54" shineColor="#f8514930" className="text-right" />
                    {latestGold.slHitAt && <span className="text-[9px] bg-[#da3633] text-white px-1 rounded"><SignalAnimatedText text="لمس شد!" mainSize="0.62rem" textColor="#ffffff" shadowColor="#ff9b54" shineColor="#ffffff30" /></span>}
                  </div>
                  <span className="font-bold text-sm mt-0.5"><SignalAnimatedText text={(Number.isInteger(latestGold.sl) ? latestGold.sl.toFixed(0) : latestGold.sl.toFixed(digits))} mainSize="0.95rem" textColor="#f85149" shadowColor="#ff9b54" shineColor="#f8514930" /></span>
                  <span className="mt-0.5 text-[9px] font-sans" dir="rtl">
                    <SignalAnimatedText text={stopDistanceLabel(latestGold, digits)} mainSize="0.62rem" textColor="#8b949e" shadowColor="#b9d8ee" shineColor="#ffffff20" />
                  </span>
                </div>

                {([1, 2, 3] as const).map((n) => {
                  const hit = n === 1 ? Boolean(latestGold.tp1HitAt) : n === 2 ? Boolean(latestGold.tp2HitAt) : Boolean(latestGold.tp3HitAt);
                  const value = n === 1 ? latestGold.tp1 : n === 2 ? latestGold.tp2 : latestGold.tp3;
                  const medals = ['🥇', '🥈', '🥉'];
                  return (
                    <div
                      key={n}
                      className={`p-2.5 rounded-lg border flex flex-col transition-all ${
                        hit ? 'bg-[#238636]/25 border-[#3fb950] text-[#3fb950]' : 'bg-[#0d1117] border-[#21262d] text-[#c9d1d9]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <SignalAnimatedText text={`${medals[n - 1]} TP${n}`} mainSize="0.72rem" textColor={hit ? '#3fb950' : '#c9d1d9'} shadowColor={hit ? '#39ffb6' : '#b9d8ee'} shineColor="#ffffff20" className="text-right" />
                        {hit ? (
                          <span className="flex items-center gap-0.5 text-[9px] bg-[#238636] text-white px-1.5 py-0.2 rounded font-sans">
                            <Check className="w-2.5 h-2.5" />
                            <SignalAnimatedText text="محقق شد (کانال)" mainSize="0.62rem" textColor="#ffffff" shadowColor="#39ffb6" shineColor="#ffffff30" />
                          </span>
                        ) : (
                          <SignalAnimatedText text="در انتظار" mainSize="0.62rem" textColor="#8b949e" shadowColor="#b9d8ee" shineColor="#ffffff20" />
                        )}
                      </div>
                      <span className="font-bold text-sm mt-0.5"><SignalAnimatedText text={value.toFixed(digits)} mainSize="0.95rem" textColor={hit ? '#3fb950' : '#ffffff'} shadowColor={hit ? '#39ffb6' : '#38e8ff'} shineColor="#ffffff20" /></span>
                    </div>
                  );
                })}
              </div>

              <LivePnlRow sig={latestGold} digits={digits} quotes={quotes} balance={balance} riskPct={riskPct} setBalance={setBalance} setRiskPct={setRiskPct} />

              {/* Status footer */}
              <div className="pt-2.5 border-t border-[#21262d] flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#8b949e]">
                <div className="flex items-center gap-2">
                  <SignalAnimatedText text="وضعیت پیگیری:" mainSize="0.78rem" textColor="#ffffff" shadowColor="#38e8ff" shineColor="#ffffff20" />
                  <SignalAnimatedText
                    text={
                      latestGold.status === 'REVERSED'
                        ? '🛑 معامله توسط سیستم محافظت بسته شد (برگشت روند تأیید شد)'
                        : latestGold.status === 'SL_HIT'
                        ? '🔴 معامله با حد ضرر بسته شد'
                        : latestGold.status === 'TP3_HIT' || latestGold.status === 'CLOSED'
                        ? '🏆 تمام اهداف سود این معامله محقق شد'
                        : latestGold.status === 'TP2_HIT'
                        ? '🚀 هدف دوم محقق شد — در حرکت به سمت TP3'
                        : latestGold.status === 'TP1_HIT'
                        ? '🎯 هدف اول محقق شد — در حرکت به سمت TP2'
                        : latestGold.status === 'PENDING'
                        ? '⏳ در صف ارسال به کانال تلگرام'
                        : '⏳ فعال در بازار — در حال نظارت بر قیمت طلا'
                    }
                    mainSize="0.8rem"
                    textColor={latestGold.status === 'REVERSED' || latestGold.status === 'SL_HIT' ? '#f85149' : '#3fb950'}
                    shadowColor={latestGold.status === 'REVERSED' || latestGold.status === 'SL_HIT' ? '#ff9b54' : '#39ffb6'}
                    shineColor="#ffffff20"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs bg-[#0d1117] px-3 py-1.5 rounded-lg border border-[#21262d] max-w-full">
                  <div className="flex items-center gap-1 text-[#c9d1d9] whitespace-nowrap">
                    <Calendar className="w-3.5 h-3.5 text-[#58a6ff]" />
                    <SignalAnimatedText text="تاریخ صدور:" mainSize="0.78rem" textColor="#c9d1d9" shadowColor="#b9d8ee" shineColor="#ffffff20" />
                    <SignalAnimatedText text={goldDate || ''} mainSize="0.82rem" textColor="#ffffff" shadowColor="#38e8ff" shineColor="#ffffff20" />
                  </div>
                  <span className="text-[#30363d]">|</span>
                  <div className="flex items-center gap-1 text-[#c9d1d9] whitespace-nowrap">
                    <Clock className="w-3.5 h-3.5 text-[#e3b341]" />
                    <SignalAnimatedText text="ساعت صدور:" mainSize="0.78rem" textColor="#c9d1d9" shadowColor="#b9d8ee" shineColor="#ffffff20" />
                    <SignalAnimatedText text={goldTime || ''} mainSize="0.82rem" textColor="#ffffff" shadowColor="#38e8ff" shineColor="#ffffff20" />
                    <SignalAnimatedText text="(تهران)" mainSize="0.7rem" textColor="#8b949e" shadowColor="#b9d8ee" shineColor="#ffffff20" />
                  </div>
                  {sentTime && sentTime !== goldTime && (
                    <>
                      <span className="text-[#30363d]">|</span>
                      <SignalAnimatedText text={`ارسال: ${sentTime}`} mainSize="0.72rem" textColor="#3fb950" shadowColor="#39ffb6" shineColor="#3fb95030" />
                    </>
                  )}
                </div>
              </div>

              {/* مسیر اسکن همین سیگنال — هم‌سان با کارت‌های شبکه */}
              <button
                onClick={() => setGoldPathOpen((v) => !v)}
                className="mt-2 flex items-center justify-center gap-1.5 w-full px-3 py-1.5 rounded-lg border border-[#1a3040] bg-[#0b1a26]/70 text-[10px] text-[#8b949e] hover:text-[#c9d1d9] hover:border-[#1a5a7a] transition cursor-pointer"
                title="نمایش ردیف‌های تاریخچهٔ اسکن برای همان کندل این سیگنال"
              >
                <History className="w-3 h-3 text-[#58a6ff]" />
                <span>{goldPathOpen ? 'بستن مسیر اسکن' : 'مسیر اسکن این سیگنال'}</span>
              </button>
              {goldPathOpen && (
                <SignalScanPath
                  symbol={latestGold.symbol}
                  candleOpenTime={latestGold.candleOpenTime || latestGold.analysis?.candleOpenTime || null}
                />
              )}
            </div>
          );
        })()}

      {/* All signals grid */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <SignalAnimatedText text="تمام تحلیل‌ها و سیگنال‌های بازار:" mainSize="0.85rem" textColor="#ffffff" shadowColor="#38e8ff" shineColor="#ffffff20" />
          <SignalAnimatedText text="زمان ثبت: تهران (Asia/Tehran) — تصمیم فقط روی کندل بسته" mainSize="0.7rem" textColor="#8b949e" shadowColor="#b9d8ee" shineColor="#ffffff20" />
        </div>

        {signals.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-[#8b949e] border border-dashed border-[#21262d] rounded-xl text-center px-4">
            <Zap className="w-7 h-7 text-[#30363d] mb-2" />
            <p><SignalAnimatedText text="سیگنالی ثبت نشده است." mainSize="0.85rem" textColor="#c9d1d9" shadowColor="#b9d8ee" shineColor="#ffffff20" /></p>
            <p className="mt-1"><SignalAnimatedText text="روی دکمه «اسکن سریع» در بالای داشبورد کلیک کنید تا تحلیل جدید انجام شود." mainSize="0.75rem" textColor="#6b7f90" shadowColor="#b9d8ee" shineColor="#ffffff20" /></p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {signals.map((sig) => {
              const isGold = sig.symbol === 'XAUUSD';
              const isBuy = sig.type === 'BUY';
              const digits = digitsFor(sig.symbol);
              const dateStr = sig.jalaliDate || formatPersianDateTime(sig.createdAt).jalaliDate;
              const timeStr = sig.tehranTime || formatPersianDateTime(sig.createdAt).time24;

              return (
                <div
                  key={sig.id}
                  className={`bg-[#0d1117] border rounded-xl p-3.5 flex flex-col justify-between transition ${
                    isGold ? 'border-[#d29922]/50 shadow-md shadow-[#d29922]/10 bg-[#161b22]/70' : 'border-[#21262d] hover:border-[#30363d]'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <SignalAnimatedText text={sig.symbol} mainSize="0.9rem" textColor="#ffffff" shadowColor="#38e8ff" shineColor="#ffffff20" />
                          <span className="text-[10px] bg-[#21262d] text-[#8b949e] px-1.5 py-0.2 rounded font-mono"><SignalAnimatedText text={sig.timeframe} mainSize="0.7rem" textColor="#8b949e" shadowColor="#b9d8ee" shineColor="#ffffff20" /></span>
                          <span className="text-[10px] bg-[#1f6feb]/15 text-[#58a6ff] border border-[#1f6feb]/30 px-1.5 py-0.2 rounded font-mono">
                            <SignalAnimatedText text={`RR ${sig.rrLabel}`} mainSize="0.7rem" textColor="#58a6ff" shadowColor="#38e8ff" shineColor="#58a6ff20" />
                          </span>
                          {isGold && sig.channelSentAt && (
                            <span className="text-[9px] bg-[#d29922]/20 text-[#e3b341] px-1.5 py-0.2 rounded font-medium"><SignalAnimatedText text="ارسال تلگرام" mainSize="0.62rem" textColor="#e3b341" shadowColor="#ffd36a" shineColor="#e3b34120" /></span>
                          )}
                        </div>
                        <div className="mt-1">
                          <StatusPill status={sig.status} />
                        </div>
                      </div>

                      <span
                        className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold border ${
                          isBuy
                            ? 'bg-[#238636]/20 text-[#3fb950] border-[#238636]/50'
                            : 'bg-[#da3633]/20 text-[#f85149] border-[#da3633]/50'
                        }`}
                      >
                        {isBuy ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        <SignalAnimatedText text={isBuy ? 'BUY' : 'SELL'} mainSize="0.8rem" textColor={isBuy ? '#3fb950' : '#f85149'} shadowColor={isBuy ? '#39ffb6' : '#ff9b54'} shineColor="#ffffff20" />
                      </span>
                    </div>

                    {sig.reason && <p className="text-[11px] text-[#8b949e] leading-relaxed mb-2"><SignalAnimatedText text={sig.reason || ''} mainSize="0.75rem" textColor="#8b949e" shadowColor="#b9d8ee" shineColor="#ffffff20" /></p>}

                    <div className="grid grid-cols-2 gap-2 text-xs mb-2 font-mono" dir="ltr">
                      <div className="p-1.5 rounded bg-[#061223]/80 border border-[#0f3a55]/50 flex flex-col">
                        <SignalAnimatedText text="ورود" mainSize="0.65rem" textColor="#8b949e" shadowColor="#b9d8ee" shineColor="#ffffff20" className="text-right" />
                        <SignalAnimatedText text={sig.entry.toFixed(digits)} mainSize="0.85rem" textColor="#ffffff" shadowColor="#38e8ff" shineColor="#ffffff20" />
                      </div>
                      <div className="p-1.5 rounded bg-[#da3633]/10 border border-[#da3633]/30 flex flex-col">
                        <SignalAnimatedText text="حد ضرر" mainSize="0.65rem" textColor="#f85149" shadowColor="#ff9b54" shineColor="#f8514920" className="text-right" />
                        <SignalAnimatedText text={(Number.isInteger(sig.sl) ? sig.sl.toFixed(0) : sig.sl.toFixed(digits))} mainSize="0.85rem" textColor="#f85149" shadowColor="#ff9b54" shineColor="#f8514920" />
                        <span className="mt-0.5 text-[9px] font-sans" dir="rtl">
                          <SignalAnimatedText text={stopDistanceLabel(sig, digits)} mainSize="0.6rem" textColor="#8b949e" shadowColor="#b9d8ee" shineColor="#ffffff20" />
                        </span>
                      </div>
                    </div>

                    <div className="space-y-1 mb-2 text-xs font-mono" dir="ltr">
                      {([1, 2, 3] as const).map((n) => (
                        <div key={n} className="flex items-center justify-between p-1 rounded bg-[#238636]/10 border border-[#238636]/20">
                          <SignalAnimatedText text={`${n === 1 ? '🥇' : n === 2 ? '🥈' : '🥉'} TP${n}`} mainSize="0.68rem" textColor="#3fb950" shadowColor="#39ffb6" shineColor="#3fb95020" />
                          <SignalAnimatedText text={(n === 1 ? sig.tp1 : n === 2 ? sig.tp2 : sig.tp3).toFixed(digits)} mainSize="0.8rem" textColor="#ffffff" shadowColor="#38e8ff" shineColor="#ffffff20" />
                        </div>
                      ))}
                    </div>

                    <LivePnlRow sig={sig} digits={digits} quotes={quotes} balance={balance} riskPct={riskPct} setBalance={setBalance} setRiskPct={setRiskPct} />

                    {/* حجم موقعیت برای سیگنال‌های غیرفعال (pending/closed) — همان موجودی/ریسک */}
                    {!isOpenTrade(sig.status) && (
                      <CompactPositionSize sig={sig} digits={digits} balance={balance} riskPct={riskPct} setBalance={setBalance} setRiskPct={setRiskPct} />
                    )}

                    <IndicatorsChips sig={sig} />
                  </div>

                  <div className="pt-2 mt-2 border-t border-[#21262d] flex flex-col gap-1 text-[10px]">
                    <div className="flex items-center justify-between">
                      <SignalAnimatedText text={`اطمینان: ${sig.confidence}%`} mainSize="0.7rem" textColor="#8b949e" shadowColor="#b9d8ee" shineColor="#ffffff20" />
                      {isGold ? (
                        sig.channelSentAt ? (
                          <span className="flex items-center gap-1 text-[#3fb950]">
                            <Send className="w-3 h-3" />
                            <SignalAnimatedText text="کانال تلگرام" mainSize="0.7rem" textColor="#3fb950" shadowColor="#39ffb6" shineColor="#3fb95020" />
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-[#e3b341]">
                            <AlertOctagon className="w-3 h-3" />
                            <SignalAnimatedText text={sig.status === 'PENDING' ? 'در صف ارسال' : 'ارسال‌نشده'} mainSize="0.7rem" textColor="#e3b341" shadowColor="#ffd36a" shineColor="#e3b34120" />
                          </span>
                        )
                      ) : (
                        <SignalAnimatedText text="فقط مانیتورینگ داشبورد" mainSize="0.7rem" textColor="#6b7f90" shadowColor="#b9d8ee" shineColor="#ffffff20" />
                      )}
                    </div>

                    <div className="flex items-center justify-between text-[#8b949e] font-mono pt-1 border-t border-[#21262d]/50">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-[#58a6ff]" />
                        <SignalAnimatedText text={dateStr || ''} mainSize="0.7rem" textColor="#8b949e" shadowColor="#b9d8ee" shineColor="#ffffff20" />
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-[#e3b341]" />
                        <SignalAnimatedText text={timeStr || ''} mainSize="0.7rem" textColor="#8b949e" shadowColor="#b9d8ee" shineColor="#ffffff20" />
                      </span>
                    </div>

                    {/* مسیر همین سیگنال در تاریخچهٔ اسکن (دروازه‌های عبورکرده) */}
                    <button
                      onClick={() => setPathFor((cur) => (cur === sig.id ? null : sig.id))}
                      className="mt-1.5 flex items-center justify-center gap-1 w-full px-2 py-1 rounded-md border border-[#1a3040] bg-[#0b1a26]/70 text-[10px] text-[#8b949e] hover:text-[#c9d1d9] hover:border-[#1a5a7a] transition cursor-pointer"
                      title="نمایش ردیف‌های تاریخچهٔ اسکن برای همان کندل این سیگنال"
                    >
                      <History className="w-3 h-3 text-[#58a6ff]" />
                      <span>{pathFor === sig.id ? 'بستن مسیر اسکن' : 'مسیر اسکن این سیگنال'}</span>
                    </button>
                    {pathFor === sig.id && (
                      <SignalScanPath symbol={sig.symbol} candleOpenTime={sig.candleOpenTime || sig.analysis?.candleOpenTime || null} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
