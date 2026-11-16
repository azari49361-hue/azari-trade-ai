import React from 'react';
import { ShieldAlert, ShieldCheck, ShieldOff, Clock, AlertTriangle, PauseCircle } from 'lucide-react';
import { CandleHealthStatus } from '../types';
import { SlicedText } from './SlicedText';

interface CandleHealthCardProps {
  status?: CandleHealthStatus | null;
}

const faTime = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('fa-IR', {
      timeZone: 'Asia/Tehran',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(d);
  } catch {
    return '—';
  }
};

const faMinutes = (ms: number | null | undefined): string => {
  if (ms === null || ms === undefined) return '—';
  const min = ms / 60_000;
  const text = min < 10 ? min.toFixed(1) : String(Math.round(min));
  return `${text} دقیقه`;
};

const faNumber = (n: number): string => n.toLocaleString('fa-IR');

const VIEW: Record<
  CandleHealthStatus['state'],
  { label: string; cls: string; Icon: React.FC<{ className?: string }>; hint: string }
> = {
  OK: {
    label: 'سالم — داده تازه است',
    cls: 'bg-[#238636]/20 text-[#3fb950] border-[#238636]/40',
    Icon: ShieldCheck,
    hint: 'کندل بستهٔ M5 تازه است؛ سیگنال‌گیری فعال.',
  },
  STALE: {
    label: 'هشدار — داده کهنه',
    cls: 'bg-[#da3633]/20 text-[#f85149] border-[#da3633]/40',
    Icon: AlertTriangle,
    hint: 'هشدار به چت شخصی فرستاده شده؛ سیگنال جدید صادر نمی‌شود.',
  },
  WAITING: {
    label: 'در انتظار داده',
    cls: 'bg-[#d29922]/20 text-[#e3b341] border-[#d29922]/40',
    Icon: Clock,
    hint: 'هنوز کندلی از منبع نرسیده است.',
  },
  MARKET_CLOSED: {
    label: 'بازار بسته',
    cls: 'bg-[#21262d] text-[#8b949e] border-[#30363d]',
    Icon: PauseCircle,
    hint: 'آخر هفته/تعطیلی بروکر — هشدار عمداً ساکت است.',
  },
  DISABLED: {
    label: 'غیرفعال — چت شخصی تنظیم نشده',
    cls: 'bg-[#21262d] text-[#8b949e] border-[#30363d]',
    Icon: ShieldOff,
    hint: 'آیدی چت شخصی را در تنظیمات تلگرام وارد کنید تا هشدار برود.',
  },
};

export const CandleHealthCard: React.FC<CandleHealthCardProps> = ({ status }) => {
  const view = VIEW[status?.state || 'WAITING'];
  const threshold = status ? Math.round(status.thresholdMs / 60_000) : null;

  // برچسب و مقدار کنار هم می‌مانند تا جفت‌شدنشان در عرض‌های بزرگ گم نشود
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-center gap-1.5 py-1 text-[11px] whitespace-nowrap">
      <span className="text-[#8b949e]">{label}:</span>
      <span className="font-mono text-[#c9d1d9]" dir="ltr">
        {value}
      </span>
    </div>
  );

  return (
    <div className="mystic-frame rounded-xl border border-[#0f3a55]/60 bg-[#071522]/75 backdrop-blur-sm h-full flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 border-b border-[#0f3a55]/50">
        <div className="flex items-center gap-2 min-w-0">
          <ShieldAlert className="w-4 h-4 text-[#58a6ff]" />
          <span className="text-xs font-bold text-white">هشدار کهنگی داده</span>
          <span className="text-[10px] text-[#8b949e]">XAUUSD M5</span>
        </div>
        <span className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${view.cls}`}>
          <view.Icon className="w-3 h-3" />
          <SlicedText
            text={view.label}
            mainSize="0.68rem"
            textColor={status?.state === 'OK' ? '#3fb950' : status?.state === 'STALE' ? '#f85149' : status?.state === 'WAITING' ? '#e3b341' : '#8b949e'}
            shadowColor={status?.state === 'OK' ? '#39ffb6' : status?.state === 'STALE' ? '#ff9b54' : '#ffd36a'}
            shineColor="#ffffff30"
            width={`${Math.max(5.5, view.label.length * 0.62)}em`}
          />
        </span>
      </div>

      <div className="px-3.5 py-2 flex-1">
        <p className="text-[10px] text-[#8b949e] mb-1.5 leading-relaxed">{view.hint}</p>
        {/* در عرض کم دو ستون، در ستون باریک کنار پنل یک ستون */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-x-6">
          {row('آستانه هشدار', threshold === null ? '—' : `${faNumber(threshold)} دقیقه`)}
          {row('سن کندل بسته', faMinutes(status?.ageMs))}
          {row('آخرین بررسی', faTime(status?.lastCheckAt))}
          {row('بررسی بعدی', faTime(status?.nextCheckAt))}
          {row(
            'آخرین هشدار',
            status?.lastAlertAt ? (
              <span className="text-[#f85149]">{faTime(status.lastAlertAt)}</span>
            ) : (
              'هنوز هشدار نداده'
            )
          )}
          {status?.lastRecoveredAt &&
            row('آخرین بازگشت داده', <span className="text-[#3fb950]">{faTime(status.lastRecoveredAt)}</span>)}
        </div>
      </div>
    </div>
  );
};
