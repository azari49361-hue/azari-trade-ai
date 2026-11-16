import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import type { PnlSummary } from '../types';
import { formatPersianDateTime } from '../utils/dateTime';

interface PnlSummaryCardsProps {
  summary?: PnlSummary | null;
}

/** مبلغ دلاری با جداکنندهٔ هزارگان (هم‌قلم با قیمت‌های داشبورد). */
const usd = (n: number): string => Math.round(Math.abs(n)).toLocaleString('en-US');

/** «از تاریخ ۱۴۰۵/۰۸/۲۰ تا الان» */
const sinceText = (since: string | null): string => {
  const jalali = since ? formatPersianDateTime(since).jalaliDate : '';
  return jalali ? `از تاریخ ${jalali} تا الان` : 'تا الان';
};

const Card: React.FC<{
  kind: 'profit' | 'loss';
  amountUsd: number;
  count: number;
  since: string | null;
  hasData: boolean;
}> = ({ kind, amountUsd, count, since, hasData }) => {
  const profit = kind === 'profit';
  const Icon = profit ? TrendingUp : TrendingDown;
  const title = profit ? 'جمع سود سیگنال‌ها' : 'جمع ضرر سیگنال‌ها';
  const value = profit
    ? hasData
      ? `+${usd(amountUsd)} دلار`
      : '—'
    : hasData
    ? `−${usd(amountUsd)} دلار`
    : '—';

  return (
    <div
      className={`mystic-frame rounded-xl border backdrop-blur-sm px-3.5 py-3 ${
        profit ? 'border-[#238636]/40 bg-[#071522]/75' : 'border-[#da3633]/40 bg-[#071522]/75'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className={`w-4 h-4 ${profit ? 'text-[#3fb950]' : 'text-[#f85149]'}`} />
          <span className="text-xs font-bold text-white whitespace-nowrap">{title}</span>
        </div>
        <span className="text-[9px] text-[#8b949e] whitespace-nowrap" title="۱ لات استاندارد طلا = ۱۰۰ اونس">
          ۱ لات (۱۰۰ اونس)
        </span>
      </div>

      <div
        className={`mt-1.5 text-xl font-extrabold font-mono leading-none ${
          profit ? 'text-[#3fb950]' : 'text-[#f85149]'
        }`}
        dir="ltr"
      >
        {value}
      </div>

      <div className="mt-1.5 text-[10px] text-[#8b949e] leading-relaxed">
        {hasData ? (
          <>
            <span>{sinceText(since)}</span>
            <span className="mx-1 opacity-60">·</span>
            <span>
              {count} سیگنال {profit ? 'به هدف رسیده' : 'حد ضرر خورده'}
            </span>
          </>
        ) : (
          <span>هنوز هیچ سیگنالی به هدف یا حد ضرر نرسیده است.</span>
        )}
      </div>
    </div>
  );
};

/** دو کارت بالای داشبورد: جمع سود و جمع ضرر از اولین تحقق هدف تا الان. */
export const PnlSummaryCards: React.FC<PnlSummaryCardsProps> = ({ summary }) => {
  const profitUsd = summary?.profitUsd ?? 0;
  const lossUsd = summary?.lossUsd ?? 0;
  const wins = summary?.wins ?? 0;
  const losses = summary?.losses ?? 0;

  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Card kind="profit" amountUsd={profitUsd} count={wins} since={summary?.since ?? null} hasData={wins > 0} />
      <Card kind="loss" amountUsd={lossUsd} count={losses} since={summary?.since ?? null} hasData={losses > 0} />
    </section>
  );
};
