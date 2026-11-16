import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config';
import { setLogSink, log } from './lib/logger';
import { startPeriodicTimeSync } from './lib/time';
import { runMigrations } from './db/migrate';
import { closePool } from './db/pool';
import * as repo from './db/repo';
import * as telegram from './telegram/client';
import { startQuotePolling, getQuotes } from './engine/quotes';
import { startDispatcher } from './engine/dispatcher';
import { startTracking } from './engine/tracking';
import { startCandleHealth } from './engine/candleHealth';
import { startMarketReport } from './engine/marketReport';
import { startScanLoop } from './engine/scanLoop';
import { startNewsCalendar } from './engine/newsCalendar';
import { startNewsDigest } from './engine/newsDigest';
import { onQuotes } from './engine/alerts';
import { stateRouter } from './routes/state';
import { liveRouter } from './routes/live';
import { ohlcRouter } from './routes/ohlc';
import { scanRouter } from './routes/scan';
import { botRouter } from './routes/bot';
import { testsRouter } from './routes/tests';
import { healthRouter } from './routes/health';
import { sourcesRouter } from './routes/sources';
import { newsRouter } from './routes/news';
import { backtestRouter } from './routes/backtest';
import { reportRouter } from './routes/report';
import { searchRouter } from './routes/search';
import { renderIndexHtml } from './lib/og';
import { TWELVEDATA_KEY_SETTING, setTwelveDataKey } from './sources/twelvedata';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  log('info', 'Boot', 'AZARI TRADE AI v2 در حال راه‌اندازی…');

  // داشبورد عمداً بدون رمز است (خواسته‌ی مالک): ورود/سشنی وجود ندارد.
  // برای محدود کردن دسترسی در اینترنت، از فایروال یا بلوک allow/deny در nginx استفاده کنید — docs/HTTPS.md.
  if (config.isProduction) {
    log('info', 'Boot', 'داشبورد بدون رمز داخلی اجرا می‌شود — دسترسی را در سطح شبکه محدود کنید.');
  }

  startPeriodicTimeSync();

  // 1) Database first — everything else depends on it.
  await runMigrations();
  await repo.initDefaultRows();
  setLogSink((level, scope, message) => void repo.addLog(level, scope, message));

  // 1.5) کلید داده‌ی ذخیره‌شده در داشبورد (اگر باشد بر .env اولویت دارد)
  const savedTdKey = await repo.getAppSetting(TWELVEDATA_KEY_SETTING).catch(() => '');
  if (savedTdKey) {
    setTwelveDataKey(savedTdKey);
    log('info', 'Boot', 'کلید TwelveData از تنظیمات داشبورد بارگذاری شد.');
  }

  // 2) Telegram (decrypt token / bootstrap from env)
  await telegram.init();

  // 3) HTTP app
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '256kb' }));

  // CORS فقط برای دامنه‌هایی که صریحاً در CORS_ORIGIN آمده‌اند (حالت «صفحه جدا، بک‌اند جدا»)
  if (config.corsOrigins.length > 0) {
    const allowAll = config.corsOrigins.includes('*');
    app.use('/api', (req, res, next) => {
      const origin = (req.get('origin') || '').replace(/\/+$/, '');
      if (origin && (allowAll || config.corsOrigins.includes(origin))) {
        res.setHeader('Access-Control-Allow-Origin', allowAll ? '*' : origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Max-Age', '600');
      }
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
      next();
    });
  }

  // هاست پیش‌نمایش بعد از هر ری‌استارت ماشین عوض می‌شود و جای دیگری روی ماشین ذخیره نیست.
  // تنها جایی که هاست فعلی دیده می‌شود، همین درخواست‌های ورودی است؛ پس اینجا یاد گرفته
  // و در .preview-host ذخیره می‌شود تا اسکریپت‌های استارت به مقدار کهنه وابسته نباشند.
  let learnedPreviewHost = '';
  app.use((req, _res, next) => {
    const host = (req.get('host') || '').trim().toLowerCase();
    if (host && host.endsWith('.style.dev') && host !== learnedPreviewHost) {
      learnedPreviewHost = host;
      try {
        fs.writeFileSync(path.join(process.cwd(), '.preview-host'), `${host}\n`);
      } catch {
        /* فایل‌سیستم فقط‌خواندنی (مثل میزبان ابری) — یادگیری بی‌اثر است، خطا نمی‌دهیم */
      }
    }
    next();
  });

  app.use('/api', healthRouter);
  app.use('/api', stateRouter);
  app.use('/api', liveRouter);
  app.use('/api', ohlcRouter);
  app.use('/api', scanRouter);
  app.use('/api', botRouter);
  app.use('/api', testsRouter);
  app.use('/api', backtestRouter);
  app.use('/api', sourcesRouter);
  app.use('/api', newsRouter);
  app.use('/api', reportRouter);
  app.use('/api', searchRouter);

  const distDir = path.join(__dirname, '..', 'dist');
  if (config.isProduction && fs.existsSync(distDir)) {
    // index.html یک‌بار خوانده می‌شود و توکن __OG_BASE__ برای هر درخواست با دامنهٔ واقعی پر می‌شود
    const indexTemplate = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
    const indexBase = (req: express.Request): string =>
      config.publicBaseUrl || `${req.protocol}://${req.get('host') || ''}`;

    app.use(express.static(distDir, { index: false }));
    app.use((req, res, next) => {
      if (req.method === 'GET' && !req.path.startsWith('/api')) {
        res.type('html').send(renderIndexHtml(indexTemplate, indexBase(req)));
        return;
      }
      next();
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  }

  app.listen(config.port, '0.0.0.0', () => {
    log('info', 'Boot', `سرور روی پورت ${config.port} بالا آمد (NODE_ENV=${process.env.NODE_ENV || 'development'})`);
    log('info', 'Boot', `منابع قیمت: MetaApi=${config.metaapi.configured ? 'فعال' : 'تنظیم‌نشده'} | TwelveData=${config.twelvedata.configured ? 'فعال' : 'تنظیم‌نشده'} | biquote=${config.biquote.enabled ? 'فعال' : 'غیرفعال'}`);
    log('info', 'Boot', `تلگرام: ${telegram.isConnected() ? `متصل (@${telegram.view().botUsername})` : 'تنظیم‌نشده (از داشبورد قابل تنظیم است)'}`);
  });

  // 4) 24/7 engines — these run as long as the process lives (Docker restart: always keeps it alive)
  startQuotePolling(() => {
    void onQuotes(getQuotes()).catch((e) => log('error', 'Alerts', e?.message));
  });
  startDispatcher();
  startTracking();
  startCandleHealth();
  startMarketReport();

  // اسکن دوره‌ای + ناظر آن (آزادسازی قفل، بازیابی فید و هشدار توقف)
  startScanLoop();

  // تقویم رویدادهای خبری (ForexFactory) — سکوت ۳۰ دقیقه‌ای قبل/بعد از رویدادهای high-impact
  startNewsCalendar();
  startNewsDigest();

  // 5) Graceful shutdown
  const shutdown = async (signal: string) => {
    log('info', 'Boot', `دریافت ${signal} — خاموشی تمیز…`);
    await closePool();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[FATAL] راه‌اندازی سرور شکست خورد:', err);
  process.exit(1);
});
