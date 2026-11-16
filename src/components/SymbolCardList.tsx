import React, { useEffect, useState, useRef } from 'react';
import { QuoteData } from '../types';
import { TrendingUp, TrendingDown, Eye, ShieldAlert, WifiOff } from 'lucide-react';
import { digitsFor } from '../utils/digits';

interface SymbolCardListProps {
  quotes: Record<string, QuoteData>;
  selectedSymbol: string;
  onSelectSymbol: (symbol: string) => void;
}

const SYMBOL_CONFIG = [
  {
    symbol: 'XAUUSD',
    nameFa: 'طلا (انس جهانی)',
    ticker: 'XAU/USD',
    stepAlert: '۱۰ دلار',
    badgeColor: 'border-[#d29922]/50 text-[#e3b341] bg-[#d29922]/10',
    icon: '🥇',
  },
  {
    symbol: 'DXY',
    nameFa: 'دلار (شاخص دلار آمریکا)',
    ticker: 'USD / DXY',
    stepAlert: '۰.۱ دلار',
    badgeColor: 'border-[#1f6feb]/50 text-[#58a6ff] bg-[#1f6feb]/10',
    icon: '💵',
  },
  {
    symbol: 'XAGUSD',
    nameFa: 'نقره (انس جهانی)',
    ticker: 'XAG/USD',
    stepAlert: '۰.۵ دلار',
    badgeColor: 'border-[#8b949e]/50 text-[#c9d1d9] bg-[#8b949e]/10',
    icon: '🥈',
  },
  {
    symbol: 'USOIL',
    nameFa: 'نفت خام WTI',
    ticker: 'WTI / USOIL',
    stepAlert: '۱.۰ دلار',
    badgeColor: 'border-[#da3633]/50 text-[#f85149] bg-[#da3633]/10',
    icon: '🛢️',
  },
];

function StateChip({ q }: { q?: QuoteData }) {
  if (!q || q.quoteState === 'NONE' || q.mid === null) {
    return (
      <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-[#da3633]/20 text-[#f85149] border border-[#da3633]/40">
        <WifiOff className="w-3 h-3" />
        <span>اتصال برقرار نیست</span>
      </span>
    );
  }
  if (q.quoteState === 'STALE') {
    return (
      <span
        className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-[#d29922]/20 text-[#e3b341] border border-[#d29922]/40"
        title={`آخرین داده: ${q.ageSeconds ?? '?'} ثانیه قبل | منبع: ${q.source}`}
      >
        <span>داده کهنه</span>
      </span>
    );
  }
  return (
    <span
      className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-[#238636]/20 text-[#3fb950] border border-[#238636]/40"
      title={`منبع: ${q.source}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-[#3fb950] animate-pulse"></span>
      <span>زنده</span>
    </span>
  );
}

export const SymbolCardList: React.FC<SymbolCardListProps> = ({ quotes, selectedSymbol, onSelectSymbol }) => {
  const prevPrices = useRef<Record<string, number>>({});
  const [flashStates, setFlashStates] = useState<Record<string, 'up' | 'down' | null>>({});

  useEffect(() => {
    const nextFlashes: Record<string, 'up' | 'down' | null> = {};

    SYMBOL_CONFIG.forEach((cfg) => {
      const q = quotes[cfg.symbol];
      // Only LIVE prices can flash — stale data must not animate as if it were live.
      const current = q?.quoteState === 'LIVE' ? q.mid || 0 : 0;
      const prev = prevPrices.current[cfg.symbol];

      if (prev && current && current !== prev) {
        nextFlashes[cfg.symbol] = current > prev ? 'up' : 'down';
      }
      if (current) {
        prevPrices.current[cfg.symbol] = current;
      }
    });

    if (Object.keys(nextFlashes).length > 0) {
      setFlashStates((prev) => ({ ...prev, ...nextFlashes }));
      const timer = setTimeout(() => setFlashStates({}), 700);
      return () => clearTimeout(timer);
    }
  }, [quotes]);

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#3fb950] animate-ping"></span>
          <h2 className="text-sm font-semibold text-white">نرخ‌های زنده بازار</h2>
        </div>
        <span className="text-[11px] text-[#8b949e]">به‌روزرسانی خودکار هر ۱.۲ ثانیه</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {SYMBOL_CONFIG.map((cfg) => {
          const q = quotes[cfg.symbol];
          const isSelected = selectedSymbol === cfg.symbol;
          const flash = flashStates[cfg.symbol];
          const isUp = (q?.dayDiffPercent ?? 0) >= 0;
          const digits = digitsFor(cfg.symbol);
          const hasPrice = Boolean(q && q.mid !== null && q.mid > 0);
          const isLive = q?.quoteState === 'LIVE';

          return (
            <div
              key={cfg.symbol}
              onClick={() => onSelectSymbol(cfg.symbol)}
              className={`mystic-frame relative rounded-xl p-3.5 border transition-all duration-200 cursor-pointer group backdrop-blur-sm ${
                isSelected
                  ? 'bg-[#081a2d]/90 border-[#1f6f99]/70 shadow-[0_0_24px_rgba(180,0,70,0.25)]'
                  : 'bg-[#071522]/75 border-[#0f3a55]/50 hover:border-[#1a5a7a]/70 hover:bg-[#071828]/85'
              } ${flash === 'up' ? 'flash-up' : flash === 'down' ? 'flash-down' : ''}`}
            >
              {/* Top row */}
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xl" role="img" aria-label={cfg.nameFa}>
                    {cfg.icon}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                      <span className="font-bold text-white text-sm whitespace-nowrap">{cfg.ticker}</span>
                      <StateChip q={q} />
                    </div>
                    <span className="text-xs text-[#8b949e] block truncate">{cfg.nameFa}</span>
                  </div>
                </div>

                {/* Day Diff % — only when the source really provides it */}
                <div
                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-bold ${
                    q?.dayDiffPercent === null || q?.dayDiffPercent === undefined
                      ? 'bg-[#21262d] text-[#8b949e] border border-[#30363d]'
                      : isUp
                      ? 'bg-[#238636]/20 text-[#3fb950] border border-[#238636]/40'
                      : 'bg-[#da3633]/20 text-[#f85149] border border-[#da3633]/40'
                  }`}
                  dir="ltr"
                >
                  {q?.dayDiffPercent === null || q?.dayDiffPercent === undefined ? (
                    <span>--</span>
                  ) : (
                    <>
                      {isUp ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                      <span>{`${isUp ? '+' : ''}${q.dayDiffPercent.toFixed(2)}%`}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Main Price Display */}
              <div className="flex items-baseline justify-between mt-1 mb-2">
                <div
                  className={`font-mono font-bold tracking-tight ${hasPrice ? 'text-2xl text-white' : 'text-sm text-[#f85149]'}`}
                  dir={hasPrice ? 'ltr' : undefined}
                >
                  {hasPrice ? q!.mid!.toFixed(digits) : 'اتصال برقرار نیست'}
                </div>
                <div className="flex flex-col text-right">
                  <span className="text-[11px] text-[#8b949e]">اسپرد (Spread)</span>
                  <span className="text-xs font-mono text-[#c9d1d9]" dir="ltr">
                    {q?.spread !== null && q?.spread !== undefined ? q.spread.toFixed(digits) : '--'}
                  </span>
                </div>
              </div>

              {/* Bid / Ask */}
              <div className="grid grid-cols-2 gap-2 text-[11px] py-1.5 px-2 rounded-md bg-[#040b18]/90 border border-[#0f3a55]/50 mb-2 font-mono" dir="ltr">
                <div className="flex justify-between items-center text-[#8b949e]">
                  <span>Bid:</span>
                  <span className="text-[#c9d1d9] font-medium">
                    {q?.bid !== null && q?.bid !== undefined ? q.bid.toFixed(digits) : '--'}
                  </span>
                </div>
                <div className="flex justify-between items-center text-[#8b949e]">
                  <span>Ask:</span>
                  <span className="text-[#c9d1d9] font-medium">
                    {q?.ask !== null && q?.ask !== undefined ? q.ask.toFixed(digits) : '--'}
                  </span>
                </div>
              </div>

              {/* Source & step footer */}
              <div className="flex items-center justify-between text-[11px] text-[#8b949e] pt-1 border-t border-[#21262d]">
                <div className="flex items-center gap-1 text-[#e3b341]" title={q?.source || 'منبعی هنوز پاسخ نداده'}>
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>گام هشدار: {cfg.stepAlert}</span>
                </div>
                <div
                  className={`flex items-center gap-1 ${isLive ? 'text-[#58a6ff] group-hover:text-white' : 'text-[#8b949e]'} transition`}
                  title={q?.source || ''}
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span className="truncate max-w-[110px]">{q?.source ? q.source.split('·')[0].trim() : '—'}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
