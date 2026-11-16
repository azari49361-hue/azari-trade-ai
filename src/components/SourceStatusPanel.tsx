import React from 'react';
import { Database, Radio, AlertTriangle, CheckCircle2, Clock, KeyRound, CircleSlash } from 'lucide-react';
import { SourceDetails } from '../types';
import { digitsFor } from '../utils/digits';
import { SlicedText } from './SlicedText';

interface SourceStatusPanelProps {
  details: SourceDetails | null;
  onOpenSources: () => void;
}

const stateBadge = (state: 'LIVE' | 'STALE' | 'NONE') => {
  if (state === 'LIVE')
    return { text: 'زنده', cls: 'bg-[#238636]/20 text-[#3fb950] border-[#238636]/40', Icon: CheckCircle2 };
  if (state === 'STALE')
    return { text: 'کهنه', cls: 'bg-[#d29922]/20 text-[#e3b341] border-[#d29922]/40', Icon: Clock };
  return { text: 'بدون داده', cls: 'bg-[#da3633]/20 text-[#f85149] border-[#da3633]/40', Icon: CircleSlash };
};

const sourceShort = (source: string): string => {
  if (!source) return '—';
  if (source.toLowerCase().includes('metaapi')) return 'MetaApi';
  if (source.toLowerCase().includes('twelve')) return 'TwelveData';
  if (source.toLowerCase().includes('biquote')) return 'biquote';
  return source.split('·')[0].trim();
};

export const SourceStatusPanel: React.FC<SourceStatusPanelProps> = ({ details, onOpenSources }) => {
  const symbols = details?.symbols || [];
  const errors = details?.pollErrors || [];
  const age = details?.dataAgeSeconds;

  const sourceChip = (label: string, active: boolean) => (
    <span
      key={label}
      className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-mono ${
        active
          ? 'bg-[#238636]/15 text-[#3fb950] border-[#238636]/40'
          : 'bg-[#21262d] text-[#8b949e] border-[#30363d]'
      }`}
      title={active ? 'پیکربندی شده و در حال استفاده' : 'پیکربندی نشده'}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-[#3fb950]' : 'bg-[#484f58]'}`} />
      {label}
    </span>
  );

  return (
    <div className="mystic-frame rounded-xl border border-[#0f3a55]/60 bg-[#071522]/75 backdrop-blur-sm h-full">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 border-b border-[#0f3a55]/50">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-[#58a6ff]" />
          <span className="text-xs font-bold text-white">وضعیت منابع قیمت</span>
          <span className="text-[10px] text-[#8b949e]" title="منبعی که آخرین قیمت را داده است">
            {details?.activeSource || 'در انتظار اولین پاسخ'}
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2 min-w-0">
          <span className="text-[10px] font-mono text-[#8b949e]" dir="ltr">
            {age === null || age === undefined ? 'age: —' : `age: ${age}s`}
          </span>
          {sourceChip('MetaApi', Boolean(details?.metaapi))}
          {sourceChip('TwelveData', Boolean(details?.twelvedata))}
          {sourceChip('biquote', Boolean(details?.biquote))}
          <button
            onClick={onOpenSources}
            className="mystic-btn flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] transition cursor-pointer"
            title="تنظیم کلید منبع داده"
          >
            <KeyRound className="w-3 h-3" />
            <span>کلید</span>
          </button>
        </div>
      </div>

      <div className="divide-y divide-[#21262d]">
        {symbols.length === 0 && (
          <div className="px-3.5 py-3 text-[11px] text-[#8b949e]">هنوز قیمتی از هیچ منبعی نرسیده است.</div>
        )}

        {symbols.map((s) => {
          const badge = stateBadge(s.quoteState);
          const digits = digitsFor(s.symbol as any);
          return (
            <div key={s.symbol} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2 text-[11px]">
              <div className="flex items-center gap-1.5 min-w-[128px]">
                <span className="text-white font-semibold">{s.nameFa}</span>
                <span className="font-mono text-[10px] text-[#8b949e]" dir="ltr">
                  {s.symbol}
                </span>
              </div>

              <div className="font-mono text-white min-w-[92px]" dir="ltr">
                {s.mid === null ? '—' : s.mid.toFixed(digits)}
              </div>

              <div className="flex items-center gap-1 text-[#8b949e] min-w-[104px]" title={s.exchange || s.source}>
                <Radio className="w-3 h-3 text-[#58a6ff]" />
                <span className="font-mono">{sourceShort(s.source)}</span>
              </div>

              <div className="flex items-center gap-1 text-[#8b949e] min-w-[86px]">
                <span>اسپرد:</span>
                <span className="font-mono" dir="ltr">
                  {s.spread === null || s.spread === undefined ? '—' : s.spread.toFixed(digits)}
                </span>
              </div>

              <div className="flex items-center gap-1 text-[#8b949e] min-w-[74px]">
                <Clock className="w-3 h-3" />
                <span className="font-mono" dir="ltr">
                  {s.ageSeconds}s
                </span>
              </div>

              <div className="flex items-center gap-1.5 mr-auto">
                {s.marketState === 'closed' && (
                  <span className="text-[10px] text-[#e3b341] border border-[#d29922]/40 bg-[#d29922]/10 px-1.5 py-0.5 rounded">
                    <SlicedText text="بازار بسته" mainSize="0.66rem" textColor="#e3b341" shadowColor="#ffd36a" shineColor="#e3b34140" width="4.8em" />
                  </span>
                )}
                <span className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${badge.cls}`}>
                  <badge.Icon className="w-3 h-3" />
                  <SlicedText
                    text={badge.text}
                    mainSize="0.66rem"
                    textColor={badge.text === 'زنده' ? '#3fb950' : badge.text === 'کهنه' ? '#e3b341' : '#f85149'}
                    shadowColor={badge.text === 'زنده' ? '#39ffb6' : '#ffd36a'}
                    shineColor="#ffffff30"
                    width={`${Math.max(3.8, badge.text.length * 0.9)}em`}
                  />
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {errors.length > 0 && (
        <div className="px-3.5 py-2 border-t border-[#21262d] flex items-start gap-1.5 text-[10px] text-[#e3b341]">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            {errors.slice(0, 3).map((e, i) => (
              <div key={i} className="break-words">
                {e}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
