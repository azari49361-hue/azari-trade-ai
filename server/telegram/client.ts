import { config } from '../config';
import { log, redactToken } from '../lib/logger';
import { authoritativeNow, formatPersianDateTime } from '../lib/time';
import * as repo from '../db/repo';
import * as messages from './messages';
import type { TradeSignal } from '../domain/types';

/**
 * Telegram client.
 * - Token is stored as-is in the DB row (single-owner deployment, no encryption layer).
 * - Env values bootstrap the settings row on first boot; after that, dashboard owns the config.
 * - The token NEVER appears in API responses or logs (redactToken guard on every error path).
 */

interface TelegramState {
  token: string;
  channel: string;
  /** چت شخصی مالک؛ فقط هشدارهای فنی به آن می‌رود. */
  admin: string;
  botUsername: string;
  botName: string;
  isConnected: boolean;
}

const state: TelegramState = {
  token: '',
  channel: '',
  admin: '',
  botUsername: '',
  botName: '',
  isConnected: false,
};

export async function init(): Promise<void> {
  let row = await repo.getTelegramRow();

  // First-boot bootstrap from env (optional)
  if (!row || (!row.bot_token && config.telegram.botToken)) {
    await repo.saveTelegramRow({
      botToken: config.telegram.botToken,
      channelChatId: config.telegram.channelId || row?.channel_chat_id || '',
      adminChatId: config.telegram.adminChatId || row?.admin_chat_id || '',
    });
    row = await repo.getTelegramRow();
    log('info', 'Telegram', 'توکن تلگرام از متغیر محیطی در دیتابیس ذخیره شد.');
  }

  if (row?.bot_token) {
    state.token = row.bot_token;
  }
  if (row) {
    state.channel = row.channel_chat_id || config.telegram.channelId || '';
    state.admin = row.admin_chat_id || config.telegram.adminChatId || '';
    state.botUsername = row.bot_username;
    state.botName = row.bot_name;
    // فقط کانال لازم است — گروه حذف شد و همه پیام‌ها به کانال می‌روند.
    state.isConnected = Boolean(row.is_connected && state.token && state.channel);
  }
  // If env provides channel but DB row lacked it, persist for next boots.
  if (config.telegram.channelId && !state.channel) {
    state.channel = config.telegram.channelId;
    await repo.saveTelegramRow({ channelChatId: state.channel });
  }
  if (config.telegram.adminChatId && !state.admin) {
    state.admin = config.telegram.adminChatId;
    await repo.saveTelegramRow({ adminChatId: state.admin });
  }
}

export function view() {
  return {
    hasToken: Boolean(state.token),
    isConnected: state.isConnected,
    botUsername: state.botUsername,
    botName: state.botName,
    channelChatId: state.channel,
    adminChatId: state.admin,
  };
}

/** آیا چت شخصی مالک برای هشدارهای فنی تنظیم شده است؟ */
export function hasAdminChat(): boolean {
  return Boolean(state.admin && state.token);
}

export function isConnected(): boolean {
  return state.isConnected;
}

interface SendResult {
  ok: boolean;
  description?: string;
  messageId?: number;
}

async function send(chatId: string, text: string): Promise<SendResult> {
  if (!state.token || !chatId) return { ok: false, description: 'توکن ربات یا چت‌آیدی تنظیم نشده است.' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${state.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: controller.signal,
    });
    const data = (await res.json()) as { ok: boolean; result?: { message_id: number }; description?: string };
    if (data.ok && data.result) return { ok: true, messageId: data.result.message_id };
    return { ok: false, description: redactToken(data.description || 'خطای تلگرام') };
  } catch (err: any) {
    return { ok: false, description: redactToken(err?.message || 'خطای شبکه در ارسال پیام') };
  } finally {
    clearTimeout(timeout);
  }
}

// ------------------------------------------------------------ config lifecycle

export interface ConfigureResult {
  ok: boolean;
  error?: string;
  botUsername?: string;
  botName?: string;
}

export async function verifyAndConfigure(input: {
  botToken: string;
  channelChatId: string;
  /** چت شخصی اختیاری؛ خالی = دست‌نخورده بماند */
  adminChatId?: string;
}): Promise<ConfigureResult> {
  const { channelChatId } = input;
  const adminChatId = (input.adminChatId || '').trim();
  // اگر توکن خالی باشد، از توکن ذخیره‌شده استفاده می‌کنیم — تغییر مقصد نباید توکن دوباره بخواهد.
  const botToken = input.botToken.trim() || state.token;
  if (!botToken) {
    return { ok: false, error: 'توکن ربات تنظیم نشده است. توکن را از @BotFather وارد کنید.' };
  }

  const meRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`).then(
    (r) => r.json() as Promise<any>
  ).catch(() => null);
  if (!meRes?.ok) {
    return { ok: false, error: 'توکن ربات نامعتبر است. توکن را از @BotFather بررسی کنید.' };
  }
  const botUsername = meRes.result?.username || 'Bot';
  const botName = meRes.result?.first_name || 'Azari Trade Bot';

  // Temporarily use the new token for verification sends.
  const previousToken = state.token;
  state.token = botToken;
  const fmt = formatPersianDateTime(authoritativeNow(), 'Asia/Tehran');

  const channelRes = await send(channelChatId, messages.connectChannel(fmt.jalaliDate, fmt.time24));
  if (!channelRes.ok) {
    state.token = previousToken;
    let explanation = 'ارسال پیام به کانال ناموفق بود.';
    const d = channelRes.description || '';
    if (d.includes('chat not found')) explanation = 'کانال یافت نشد. آیدی کانال را بررسی کنید (@کانال یا -100...).';
    else if (d.includes('rights')) explanation = 'ربات در کانال ادمین نیست. آن را با دسترسی Post Messages ادمین کنید.';
    else if (d) explanation = `خطای کانال: ${d}`;
    return { ok: false, error: explanation };
  }

  // چت شخصی (اختیاری): با یک پیام واقعی تأیید می‌شود تا هشدارهای فنی بی‌صدا گم نشوند.
  if (adminChatId) {
    const adminRes = await send(adminChatId, messages.connectAdmin(fmt.jalaliDate, fmt.time24));
    if (!adminRes.ok) {
      state.token = previousToken;
      let explanation = 'ارسال پیام آزمایشی به چت شخصی ناموفق بود.';
      const d = adminRes.description || '';
      if (d.includes('chat not found')) explanation = 'چت شخصی یافت نشد. یک‌بار در تلگرام به ربات /start بدهید و دوباره تلاش کنید.';
      else if (d.includes('blocked') || d.includes('kicked')) explanation = 'ربات توسط شما بلاک شده است. آن را آنبلاک کنید و /start بدهید.';
      else if (d) explanation = `خطای چت شخصی: ${d}`;
      return { ok: false, error: explanation };
    }
    state.admin = adminChatId;
  }

  state.channel = channelChatId;
  state.botUsername = botUsername;
  state.botName = botName;
  state.isConnected = true;

  await repo.saveTelegramRow({
    botToken,
    botUsername,
    botName,
    channelChatId,
    // ستون قدیمی گروه پاک می‌شود؛ مفهوم گروه از این نسخه حذف شده است.
    groupChatId: '',
    adminChatId: state.admin,
    isConnected: true,
    lastVerifiedAt: authoritativeNow(),
  });
  log(
    'info',
    'Telegram',
    `تنظیمات تلگرام ذخیره شد: @${botUsername} | کانال: ${channelChatId} | چت شخصی: ${state.admin || 'تنظیم نشده'}`
  );
  return { ok: true, botUsername, botName };
}

export async function disconnect(): Promise<void> {
  state.token = '';
  state.channel = '';
  state.admin = '';
  state.botUsername = '';
  state.botName = '';
  state.isConnected = false;
  await repo.saveTelegramRow({
    botToken: '',
    botUsername: '',
    botName: '',
    channelChatId: '',
    groupChatId: '',
    adminChatId: '',
    isConnected: false,
    lastVerifiedAt: null,
  });
}

// ------------------------------------------------------------ high-level sends

export async function sendPreSignalToChannel(): Promise<{ ok: boolean; emoji: string; phrase: string; description?: string }> {
  const { emoji, phrase } = messages.randomPreSignal();
  if (!state.isConnected) return { ok: false, emoji, phrase, description: 'تلگرام تنظیم نشده است.' };
  const res = await send(state.channel, messages.preSignal(emoji, phrase));
  return { ok: res.ok, emoji, phrase, description: res.description };
}

export async function sendChannelSignal(sig: TradeSignal): Promise<SendResult> {
  if (!state.isConnected) return { ok: false, description: 'تلگرام تنظیم نشده است.' };
  if (sig.symbol !== 'XAUUSD') return { ok: false, description: 'فقط سیگنال طلا اجازه ارسال به تلگرام دارد.' };
  const res = await send(state.channel, messages.channelSignal(sig));
  if (!res.ok) log('error', 'TelegramChannel', `ارسال سیگنال ${sig.id} به کانال ناموفق: ${res.description}`);
  return res;
}

/** TP1/TP2/TP3/SL — همه به کانال می‌روند (گروه حذف شده است). */
export async function sendTargetUpdate(
  target: 'TP1' | 'TP2' | 'TP3' | 'SL',
  price: number,
  pnlUsd?: number
): Promise<SendResult> {
  if (!state.isConnected) return { ok: false, description: 'تلگرام تنظیم نشده است.' };
  const fmt = formatPersianDateTime(authoritativeNow(), 'Asia/Tehran');
  const res = await send(state.channel, messages.targetUpdate(target, price, fmt.jalaliDate, fmt.time24, pnlUsd));
  if (!res.ok) log('error', 'TelegramChannel', `ارسال ${target} به کانال ناموفق: ${res.description}`);
  return res;
}

export async function sendProtectionWarning(sig: TradeSignal, stage: 'YELLOW' | 'RED'): Promise<SendResult> {
  if (!state.isConnected) return { ok: false, description: 'تلگرام تنظیم نشده است.' };
  const fmt = formatPersianDateTime(authoritativeNow(), 'Asia/Tehran');
  const res = await send(state.channel, messages.protectionWarning(stage, sig, fmt.jalaliDate, fmt.time24));
  if (!res.ok) log('error', 'TelegramChannel', `ارسال هشدار ${stage} ناموفق: ${res.description}`);
  return res;
}

export async function sendTestChannel(): Promise<SendResult> {
  if (!state.isConnected) return { ok: false, description: 'تلگرام تنظیم نشده است.' };
  const fmt = formatPersianDateTime(authoritativeNow(), 'Asia/Tehran');
  return send(state.channel, messages.testChannelSignal(fmt.jalaliDate, fmt.time24));
}

/** هشدار فنی/سلامت داده — فقط به چت شخصی مالک می‌رود (هیچ‌وقت به کانال سیگنال نمی‌رود). */
export async function sendAdminAlert(text: string): Promise<SendResult> {
  if (!state.admin) return { ok: false, description: 'چت شخصی مالک تنظیم نشده است.' };
  if (!state.token) return { ok: false, description: 'توکن ربات تنظیم نشده است.' };
  const res = await send(state.admin, text);
  if (!res.ok) log('error', 'TelegramAdmin', `ارسال هشدار فنی ناموفق: ${res.description}`);
  return res;
}

/** Send an arbitrary pre-formatted text to the channel (used by labelled test routes). */
export async function sendRawToChannel(text: string): Promise<SendResult> {
  if (!state.isConnected) return { ok: false, description: 'تلگرام تنظیم نشده است.' };
  return send(state.channel, text);
}

export async function sendTestTarget(target: 'TP1' | 'TP2' | 'TP3' | 'SL'): Promise<SendResult> {
  if (!state.isConnected) return { ok: false, description: 'تلگرام تنظیم نشده است.' };
  const fmt = formatPersianDateTime(authoritativeNow(), 'Asia/Tehran');
  return send(state.channel, messages.testTargetUpdate(target, fmt.jalaliDate, fmt.time24));
}
