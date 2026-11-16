import React, { useState } from 'react';
import { PriceAlert, MarketStatus } from '../types';
import { Bell, Send, ArrowUpRight, ArrowDownRight, ShieldAlert, Play, Clock, Info, CheckCircle2, Calendar } from 'lucide-react';
import { formatPersianDateTime } from '../utils/dateTime';
import { digitsFor } from '../utils/digits';

interface AlertsBoxProps {
  alerts: PriceAlert[];
  baselines: Record<string, number>;
  isWeekend: boolean;
  marketStatus?: MarketStatus;
  telegramConfigured: boolean;
  onTestAlert: (symbol: string) => Promise<void>;
}

export const AlertsBox: React.FC<AlertsBoxProps> = ({
  alerts,
  baselines,
  isWeekend,
  marketStatus,
  telegramConfigured,
  onTestAlert,
}) => {
  const [testing, setTesting] = useState(false);

  const handleTriggerTest = async () => {
    setTesting(true);
    await onTestAlert('XAUUSD');
    setTesting(false);
  };

  const formatTime = (isoString: string) => formatPersianDateTime(isoString).time24;

  const isClosed = marketStatus ? !marketStatus.isOpen : isWeekend;

  return (
    <div className="mystic-frame bg-[#071522]/75 border border-[#0f3a55]/60 rounded-2xl p-4 flex flex-col h-full shadow-lg backdrop-blur-sm">
      {/* Box Header */}
      <div className="flex items-center justify-between pb-3 border-b border-[#21262d] mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[#d29922]/15 text-[#e3b341] flex items-center justify-center">
            <Bell className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
              <span>سیستم هشدار خودکار قیمت</span>
              <span className="text-[10px] bg-[#21262d] text-[#8b949e] px-1.5 py-0.5 rounded font-mono">Auto-Alerts</span>
            </h3>
            <p className="text-[11px] text-[#8b949e]">
              هشدار تغییر گام (طلا ۱۰$، نقره ۰.۵$، نفت ۱$، دلار ۰.۱$) با آپدیت مبنا
            </p>
          </div>
        </div>

        <button
          onClick={handleTriggerTest}
          disabled={testing}
          className="mystic-btn flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs transition cursor-pointer disabled:opacity-50"
          title="ثبت هشدار آزمایشی در داشبورد"
        >
          <Play className="w-3.5 h-3.5 text-[#ff9b54]" />
          <span>{testing ? 'در حال ارسال...' : 'تست هشدار'}</span>
        </button>
      </div>

      {/* Market-closed notice */}
      {isClosed && (
        <div className="mb-3 p-2.5 rounded-lg bg-[#d29922]/10 border border-[#d29922]/30 flex items-center gap-2 text-xs text-[#f0883e]">
          <Calendar className="w-4 h-4 shrink-0 text-[#f85149]" />
          <span>
            <strong>{marketStatus?.dayFa || 'بازار بسته'}:</strong> هشدارهای قیمتی در زمان بسته بودن بازار ثبت نمی‌شوند.
          </span>
        </div>
      )}

      {/* Baselines */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2 mb-3">
        {[
          { sym: 'XAUUSD', label: 'مبنای طلا', step: '۱۰$' },
          { sym: 'DXY', label: 'مبنای دلار', step: '۰.۱' },
          { sym: 'XAGUSD', label: 'مبنای نقره', step: '۰.۵$' },
          { sym: 'USOIL', label: 'مبنای نفت', step: '۱$' },
        ].map((item) => (
          <div key={item.sym} className="p-2 rounded-lg bg-[#040b18]/90 border border-[#0f3a55]/50 flex flex-col justify-between">
            <div className="flex items-center justify-between text-[11px] text-[#8b949e]">
              <span>{item.label}</span>
              <span className="text-[#e3b341] font-mono text-[10px]">±{item.step}</span>
            </div>
            <div className="font-mono text-xs font-semibold text-white mt-1" dir="ltr">
              {baselines[item.sym]
                ? baselines[item.sym].toFixed(digitsFor(item.sym))
                : 'در حال دریافت اولین قیمت'}
            </div>
          </div>
        ))}
      </div>

      {/* Alerts Feed */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1 max-h-[340px]">
        {alerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-[#8b949e] border border-dashed border-[#21262d] rounded-xl text-center px-4">
            <ShieldAlert className="w-8 h-8 text-[#30363d] mb-2" />
            <p className="text-xs">هنوز هشداری ثبت نشده است.</p>
            <p className="text-[11px] text-[#484f58] mt-1">
              با نوسان قیمت در گام تعیین‌شده یا تغییر جهت روند، هشدار خودکار در اینجا ثبت می‌شود.
            </p>
          </div>
        ) : (
          alerts.map((alt) => {
            const isUp = alt.direction === 'UP';
            const digits = digitsFor(alt.symbol);
            const isReversalRed = alt.alertType === 'REVERSAL_RED';
            const isReversalYellow = alt.alertType === 'REVERSAL_YELLOW';

            if (isReversalRed || isReversalYellow) {
              const red = isReversalRed;
              return (
                <div
                  key={alt.id}
                  className={`p-3 rounded-xl border transition flex items-start justify-between gap-3 animate-in fade-in ${
                    red ? 'bg-[#da3633]/10 border-[#da3633]/50' : 'bg-[#d29922]/10 border-[#d29922]/50'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 font-bold text-sm ${
                        red ? 'bg-[#da3633]/25 text-[#f85149]' : 'bg-[#d29922]/25 text-[#e3b341]'
                      }`}
                    >
                      {red ? '🛑' : '🟡'}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-bold ${red ? 'text-[#f85149]' : 'text-[#e3b341]'}`}>
                          {red ? 'هشدار بستن معامله (برگشت تأیید شده)' : 'هشدار اولیه مدیریت معامله (تغییر جهت در حال مشاهده)'}
                        </span>
                        <span
                          className={`text-[10px] px-1.5 py-0.2 rounded font-mono font-bold ${
                            red ? 'bg-[#da3633]/30 text-[#f85149]' : 'bg-[#d29922]/30 text-[#e3b341]'
                          }`}
                        >
                          {red ? 'REVERSAL RED' : 'STAGE 1'}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#c9d1d9] mt-1 leading-relaxed">
                        نماد: <span className="font-bold text-white">طلا {alt.symbol}</span> | جهت فعلی:{' '}
                        <span className={`font-semibold ${red ? 'text-[#f85149]' : 'text-[#e3b341]'}`}>
                          {alt.activeTradeDirection === 'BUY' ? 'خرید (Long) 🟢' : 'فروش (Short) 🔴'}
                        </span>{' '}
                        | سطح ورود: <span className="font-mono font-bold text-white" dir="ltr">{alt.activeTradeEntry?.toFixed(2)}</span>
                      </p>
                      {alt.detailsFa && <p className={`text-[10px] mt-0.5 font-medium ${red ? 'text-[#f85149]' : 'text-[#8b949e]'}`}>{alt.detailsFa}</p>}
                      <div className="flex items-center gap-1 font-mono text-[10px] text-[#8b949e] mt-1">
                        <Clock className="w-3 h-3" />
                        <span>{formatTime(alt.createdAt)} (به وقت تهران)</span>
                      </div>
                    </div>
                  </div>
                  {alt.telegramSent && (
                    <span
                      className={`shrink-0 flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border ${
                        red ? 'text-[#f85149] bg-[#da3633]/20 border-[#da3633]/40' : 'text-[#e3b341] bg-[#d29922]/20 border-[#d29922]/40'
                      }`}
                    >
                      <Send className="w-3 h-3" />
                      <span>کانال</span>
                    </span>
                  )}
                </div>
              );
            }

            return (
              <div
                key={alt.id}
                className="p-3 rounded-xl bg-[#040b18]/90 border border-[#0f3a55]/50 hover:border-[#30363d] transition flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                      isUp ? 'bg-[#238636]/20 text-[#3fb950]' : 'bg-[#da3633]/20 text-[#f85149]'
                    }`}
                  >
                    {isUp ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-white">{alt.nameFa}</span>
                      <span className="text-[11px] font-mono font-medium text-[#c9d1d9]" dir="ltr">
                        {alt.price ? alt.price.toFixed(digits) : alt.detailsFa ? '—' : alt.price.toFixed(digits)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-[11px] text-[#8b949e] mt-0.5">
                      <span
                        className={`font-mono font-semibold ${isUp ? 'text-[#3fb950]' : 'text-[#f85149]'}`}
                        dir="ltr"
                      >
                        {isUp ? '+' : ''}
                        {alt.change.toFixed(2)} دلار {isUp ? '⬆️' : '⬇️'}
                      </span>
                      <span>•</span>
                      <span className="flex items-center gap-1 font-mono text-[10px]">
                        <Clock className="w-3 h-3" />
                        {formatTime(alt.createdAt)}
                      </span>
                    </div>
                  </div>
                </div>

                <div>
                  {alt.telegramSent ? (
                    <span className="flex items-center gap-1 text-[10px] text-[#3fb950] bg-[#238636]/15 px-2 py-0.5 rounded border border-[#238636]/30">
                      <Send className="w-3 h-3" />
                      <span>ارسال شد</span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[10px] text-[#8b949e] bg-[#21262d] px-2 py-0.5 rounded border border-[#30363d]">
                      <CheckCircle2 className="w-3 h-3 text-[#3fb950]" />
                      <span>داشبورد</span>
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div className="mt-3 pt-2 border-t border-[#21262d] flex items-center justify-between text-[11px] text-[#8b949e]">
        <div className="flex items-center gap-1">
          <Info className="w-3.5 h-3.5 text-[#58a6ff]" />
          <span>مبنا پس از هر هشدار به قیمت جاری به‌روزرسانی می‌شود.</span>
        </div>
        <span className="font-mono text-[10px]">آخرین هشدارها</span>
      </div>
    </div>
  );
};
