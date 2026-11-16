import { useCallback, useEffect, useState } from 'react';

/** رویداد غیراستاندارد کروم/اج برای نصب PWA */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
}

/** آیا اپ از حالت نصب‌شده (standalone) باز شده است؟ */
export function isStandaloneMode(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return window.matchMedia?.('(display-mode: standalone)').matches || iosStandalone;
}

/** آیفون/آیپد — اینجا پرامپت نصب وجود ندارد و باید راهنمای Share داده شود */
export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/**
 * پرامپت نصب PWA را مدیریت می‌کند.
 * `beforeinstallprompt` فقط یک‌بار و فقط وقتی شرایط مرورگر مهیاست می‌آید؛
 * تا آن لحظه `canInstall` برابر false است و UI باید راهنمای دستی نشان دهد.
 */
export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState<boolean>(() => isStandaloneMode());

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      // جلوگیری از مینی‌اینفوی خودکار مرورگر تا خودمان دکمه را کنترل کنیم
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setStandalone(true);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    const mq = window.matchMedia?.('(display-mode: standalone)');
    const onDisplayChange = () => setStandalone(isStandaloneMode());
    mq?.addEventListener?.('change', onDisplayChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      mq?.removeEventListener?.('change', onDisplayChange);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (!deferred) return 'unavailable';
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      setDeferred(null);
      return choice.outcome === 'accepted' ? 'accepted' : 'dismissed';
    } catch {
      setDeferred(null);
      return 'unavailable';
    }
  }, [deferred]);

  return { canInstall: deferred !== null, standalone, promptInstall };
}
