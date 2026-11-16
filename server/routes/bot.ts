import { Router } from 'express';
import { rateLimit } from '../lib/rateLimit';
import * as telegram from '../telegram/client';
import { log } from '../lib/logger';

export const botRouter = Router();

const limiter = rateLimit({ windowMs: 60_000, max: 8, keyPrefix: 'bot' });

/**
 * Telegram configuration (rate-limited against accidental spam).
 * The token is verified against Telegram (getMe + real test messages to channel & group)
 * BEFORE anything is stored, then persisted. The token is never echoed back.
 * Updating destinations may omit the token: the stored one is reused server-side.
 */
botRouter.post('/bot', limiter, async (req, res) => {
  const botToken = String(req.body?.botToken || '').trim();
  const channelChatId = String(req.body?.channelChatId || '').trim();
  const adminChatId = String(req.body?.adminChatId || '').trim();

  if (!channelChatId) {
    log('warn', 'Telegram', 'ذخیره تنظیمات رد شد: چت‌آیدی کانال خالی است.');
    res.status(400).json({ ok: false, error: 'لطفاً چت‌آیدی کانال تلگرام را وارد فرمایید.' });
    return;
  }
  if (!botToken && !telegram.view().hasToken) {
    log('warn', 'Telegram', 'ذخیره تنظیمات رد شد: نه توکن فرستاده شده و نه توکنی ذخیره است.');
    res.status(400).json({ ok: false, error: 'لطفاً توکن ربات تلگرام را وارد فرمایید.' });
    return;
  }

  const result = await telegram.verifyAndConfigure({ botToken, channelChatId, adminChatId });
  if (!result.ok) {
    log('error', 'Telegram', `ذخیره تنظیمات ناموفق — کانال=${channelChatId}: ${result.error || 'دلیل نامشخص'}`);
    res.status(400).json({ ok: false, error: result.error || 'خطا در اعتبارسنجی تلگرام.' });
    return;
  }
  log(
    'info',
    'Telegram',
    `تنظیمات جدید تأیید شد — کانال=${channelChatId} چت‌شخصی=${adminChatId || 'بدون تغییر'}`
  );

  res.json({
    ok: true,
    botUsername: result.botUsername,
    botName: result.botName,
    channelChatId,
    adminChatId: telegram.view().adminChatId,
    message: 'تنظیمات تلگرام با موفقیت آزمایش و ذخیره شد.',
  });
});

botRouter.post('/bot/disconnect', limiter, async (_req, res) => {
  await telegram.disconnect();
  res.json({ ok: true, message: 'تنظیمات تلگرام پاک شد.' });
});
