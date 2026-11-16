import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Share, Smartphone, X, MoreVertical, MonitorSmartphone } from 'lucide-react';
import { isIosDevice, useInstallPrompt } from '../utils/useInstallPrompt';

interface InstallAppButtonProps {
  onNotify?: (msg: string) => void;
}

/**
 * دکمهٔ «نصب روی گوشی»:
 * اگر مرورگر پرامپت نصب داده باشد، همان پرامپت باز می‌شود؛
 * وگرنه راهنمای دستی (اندروید/آیفون/دسکتاپ) نمایش داده می‌شود.
 * در حالت نصب‌شده (standalone) دکمه پنهان است.
 */
export const InstallAppButton: React.FC<InstallAppButtonProps> = ({ onNotify }) => {
  const { canInstall, standalone, promptInstall } = useInstallPrompt();
  const [helpOpen, setHelpOpen] = useState(false);
  const ios = isIosDevice();

  if (standalone) return null;

  const handleClick = async () => {
    if (!canInstall) {
      setHelpOpen(true);
      return;
    }
    const outcome = await promptInstall();
    if (outcome === 'accepted') {
      onNotify?.('📲 نصب اپ شروع شد — آیکون Azari Trade روی صفحهٔ اصلی اضافه می‌شود.');
    } else if (outcome === 'unavailable') {
      setHelpOpen(true);
    }
  };

  return (
    <>
      <button
        onClick={handleClick}
        className="flex items-center gap-1.5 px-3 py-2 sm:px-2.5 sm:py-1.5 rounded-lg bg-[#238636]/15 hover:bg-[#238636]/25 border border-[#238636]/50 text-xs text-[#3fb950] transition cursor-pointer whitespace-nowrap shrink-0"
        title={canInstall ? 'نصب داشبورد روی گوشی' : 'راهنمای نصب روی گوشی'}
      >
        <Download className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">نصب روی گوشی</span>
      </button>

      {/* پورتال لازم است: هدر backdrop-blur دارد و position:fixed را به خودش گره می‌زند */}
      {helpOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setHelpOpen(false)}
          >
          <div
            className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-[#30363d] bg-[#161b22] p-5 text-right space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-[#3fb950]" />
                <h3 className="text-sm font-bold text-white">نصب داشبورد روی گوشی</h3>
              </div>
              <button
                onClick={() => setHelpOpen(false)}
                className="p-1 rounded-md hover:bg-[#21262d] text-[#8b949e] hover:text-white transition cursor-pointer"
                title="بستن"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-[11px] leading-5 text-[#8b949e]">
              {canInstall
                ? 'مرورگر این دستگاه از نصب مستقیم پشتیبانی می‌کند؛ دکمهٔ نصب را بزن و تأیید کن.'
                : 'مرورگر فعلی پرامپت نصب نداد؛ با این مراحل دستی اضافه کن:'}
            </p>

            <div className="space-y-3 text-xs text-[#c9d1d9]">
              <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
                <div className="flex items-center gap-2 font-semibold text-white mb-1.5">
                  <MoreVertical className="w-3.5 h-3.5 text-[#3fb950]" />
                  <span>اندروید — Chrome / Edge</span>
                </div>
                <p className="text-[11px] leading-5 text-[#8b949e]">
                  منوی سه‌نقطهٔ بالا → «افزودن به صفحهٔ اصلی» یا «Install app» → نصب.
                </p>
              </div>

              <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
                <div className="flex items-center gap-2 font-semibold text-white mb-1.5">
                  <Share className="w-3.5 h-3.5 text-[#58a6ff]" />
                  <span>آیفون / آیپد — Safari</span>
                </div>
                <p className="text-[11px] leading-5 text-[#8b949e]">
                  دکمهٔ Share (مربع با فلش) → «Add to Home Screen» → Add.
                </p>
              </div>

              <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
                <div className="flex items-center gap-2 font-semibold text-white mb-1.5">
                  <MonitorSmartphone className="w-3.5 h-3.5 text-[#d29922]" />
                  <span>دسکتاپ</span>
                </div>
                <p className="text-[11px] leading-5 text-[#8b949e]">
                  در نوار آدرس آیکون نصب را بزن؛ در فایرفاکس از منو → «Install» (در صورت پشتیبانی).
                </p>
              </div>
            </div>

            <p className="text-[10px] leading-4 text-[#6e7681]">
              {ios
                ? 'روی آیفون فقط Safari نصب PWA را پشتیبانی می‌کند.'
                : 'نصب فقط وقتی کار می‌کند که سایت روی HTTPS باز شده باشد.'}
            </p>

            <button
              onClick={() => setHelpOpen(false)}
              className="w-full rounded-lg bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-xs text-[#c9d1d9] py-2 transition cursor-pointer"
            >
              متوجه شدم
            </button>
          </div>
          </div>,
          document.body,
        )}
    </>
  );
};
