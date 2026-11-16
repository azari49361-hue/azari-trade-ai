import React, { useState } from 'react';
import { X, Copy, Check, Download, Terminal, FileText, ExternalLink, CheckCircle2, Layers, Rocket, Code } from 'lucide-react';

interface DeploymentGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const COMPOSE_CONTENT = `services:
  app:
    build: .
    restart: always
    ports:
      - "3000:3000"
    env_file:
      - .env
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  db:
    image: postgres:16-alpine
    restart: always
    environment:
      POSTGRES_USER: azari
      POSTGRES_PASSWORD: change-me-strong-password
      POSTGRES_DB: azaritrade
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U azari -d azaritrade"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
`;

const STEPS: { n: number; title: string; lines: React.ReactNode; commands?: { label: string; text: string }[] }[] = [
  {
    n: 1,
    title: 'نصب Docker و Docker Compose روی سرور (اوبونتو/دبیان)',
    lines: (
      <p>
        یک VPS با حداقل ۱GB RAM کافی است. دستورات زیر را با کاربر root اجرا کنید:
      </p>
    ),
    commands: [{ label: 'نصب Docker', text: 'curl -fsSL https://get.docker.com | sh' }],
  },
  {
    n: 2,
    title: 'آپلود پروژه و ساخت .env',
    lines: (
      <p>
        کل پوشه پروژه را روی سرور کپی کنید (git clone یا scp). سپس فایل{' '}
        <span className="font-mono text-[#58a6ff]">.env.example</span> را به{' '}
        <span className="font-mono text-[#58a6ff]">.env</span> تبدیل کرده و مقادیر واقعی را بگذارید. مقادیر اجباری{' '}
        <span className="font-mono">DATABASE_URL</span> و{' '}
        <span className="font-mono">DASHBOARD_PASSWORD</span> (رمز ورود داشبورد) هستند؛ کلیدهای منبع قیمت و تلگرام اختیاری‌اند.
      </p>
    ),
    commands: [
      { label: 'بررسی محتوا', text: 'cat .env' },
    ],
  },
  {
    n: 3,
    title: 'اجرای سامانه با Docker Compose',
    lines: (
      <p>
        با این دستور، اپلیکیشن + PostgreSQL بالا می‌آیند. <span className="font-mono">restart: always</span> تضمین
        می‌کند سرویس پس از ری‌استارت سرور هم خودش برگردد — پایه ادعای «۲۴ ساعته فعال».
      </p>
    ),
    commands: [{ label: 'اجرا', text: 'docker compose up -d --build' }],
  },
  {
    n: 4,
    title: 'اجرای Migration ها (خودکار در بوت هم انجام می‌شود)',
    lines: (
      <p>
        مایگریشن‌ها در هر بار بالا آمدن اپ به‌صورت خودکار و امن اجرا می‌شوند. برای اجرای دستی:
      </p>
    ),
    commands: [{ label: 'مایگریشن دستی', text: 'docker compose exec app npm run migrate' }],
  },
  {
    n: 5,
    title: 'فعال‌سازی 24/7 واقعی (سرویس systemd برای Docker Compose)',
    lines: (
      <p>
        با فایل زیر در <span className="font-mono">/etc/systemd/system/azari.service</span> مطمئن شوید کانتینرها
        بعد از بوت سرور خودشان شروع می‌شوند:
      </p>
    ),
    commands: [
      { label: 'فعال‌سازی', text: 'systemctl enable --now azari' },
    ],
  },
  {
    n: 6,
    title: 'تست سلامت و مشاهده لاگ‌ها',
    lines: <p>آدرس داشبورد: <span className="font-mono text-[#58a6ff]">http://SERVER_IP:3000</span> — اگر پشت Nginx و دامنه هستید، reverse proxy با TLS بگذارید.</p>,
    commands: [
      { label: 'سلامت', text: 'curl http://localhost:3000/api/health' },
      { label: 'لاگ‌ها', text: 'docker compose logs -f app' },
    ],
  },
];

export const DeploymentGuideModal: React.FC<DeploymentGuideModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'guide' | 'compose'>('guide');
  const [copied, setCopied] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleDownload = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md">
      <div className="mystic-frame mystic-modal rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="mystic-modal-header px-5 py-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#f0883e]/20 text-[#f0883e] flex items-center justify-center">
              <Rocket className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">مرکز استقرار — Docker + VPS (۲۴ ساعته واقعی)</h3>
              <p className="text-[11px] text-[#8b949e]">
                اجرای دائمی Azari Trade AI با PostgreSQL و restart خودکار
              </p>
            </div>
          </div>
          <button onClick={onClose} className="mystic-btn p-1.5 rounded-lg text-[#b9d8ee] hover:text-white transition cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center px-4 pt-2 border-b border-[#0f3a55]/50 bg-[#061223]/70 gap-1 text-xs font-medium">
          <button
            onClick={() => setActiveTab('guide')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg transition border-b-2 cursor-pointer ${
              activeTab === 'guide' ? 'border-[#00d4ff] text-white bg-[#081828]' : 'border-transparent text-[#b8a7b5] hover:text-[#e6f6ff]'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>راهنمای گام‌به‌گام</span>
          </button>

          <button
            onClick={() => setActiveTab('compose')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg transition border-b-2 font-mono cursor-pointer ${
              activeTab === 'compose' ? 'border-[#39ffb6] text-white bg-[#081828]' : 'border-transparent text-[#b8a7b5] hover:text-[#e6f6ff]'
            }`}
          >
            <FileText className="w-3.5 h-3.5 text-[#ff9b54]" />
            <span>docker-compose.yml</span>
          </button>

          <a
            href="https://docs.docker.com/compose/install/"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-3 py-2 text-[#8b949e] hover:text-[#58a6ff] transition"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>مستندات Docker</span>
          </a>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 text-xs text-[#c9d1d9] space-y-4">
          {activeTab === 'guide' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-[#040b18]/90 border border-[#0f3a55]/50">
                <h4 className="font-bold text-white text-sm mb-1">پیش‌نیازها</h4>
                <p className="text-[#8b949e]">
                  یک VPS (هر ارائه‌دهنده‌ای — Hetzner/DigitalOcean/Vultr/… ) با اوبونتو ۲۲ یا ۲۴، حداقل ۱GB RAM و یک
                  IP اختصاصی. برای اتصال MetaApi فقط کافی است کلید و accountId را در <span className="font-mono">.env</span> بگذارید؛
                  سرور شما نیازی به IP ثابت برای بروکر ندارد.
                </p>
              </div>

              {STEPS.map((step) => (
                <div key={step.n} className="p-4 rounded-xl bg-[#040b18]/90 border border-[#0f3a55]/50 space-y-2">
                  <div className="flex items-center gap-2 text-white font-bold text-sm">
                    <span className="w-6 h-6 rounded-full bg-[#1f6feb] text-white flex items-center justify-center text-xs">{step.n}</span>
                    <span>{step.title}</span>
                  </div>
                  <div className="text-[#8b949e]">{step.lines}</div>
                  {step.commands?.map((cmd) => (
                    <div
                      key={cmd.label}
                      className="p-2.5 rounded-lg bg-[#161b22] border border-[#30363d] font-mono text-xs text-[#3fb950] flex items-center justify-between gap-2"
                      dir="ltr"
                    >
                      <code className="overflow-x-auto">{cmd.text}</code>
                      <button
                        onClick={() => handleCopy(cmd.text, cmd.label)}
                        className="p-1 rounded text-[#8b949e] hover:text-white transition shrink-0"
                        title="کپی دستور"
                      >
                        {copied === cmd.label ? <Check className="w-4 h-4 text-[#3fb950]" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                  ))}
                </div>
              ))}

              <div className="p-3 rounded-xl bg-[#238636]/15 border border-[#238636]/30 flex items-center gap-2 text-[#3fb950] text-xs">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>
                  پس از بالا آمدن، داشبورد را باز کنید و تلگرام را از مودال تنظیمات متصل کنید.
                  وضعیت «بک‌اند فعال» در هدر از heartbeat واقعی دیتابیس می‌آید.
                </span>
              </div>
            </div>
          )}

          {activeTab === 'compose' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-white text-xs">docker-compose.yml — اپ + PostgreSQL</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleDownload('docker-compose.yml', COMPOSE_CONTENT)}
                    className="mystic-btn flex items-center gap-1 px-2.5 py-1 rounded text-xs transition cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>دانلود</span>
                  </button>
                  <button
                    onClick={() => handleCopy(COMPOSE_CONTENT, 'compose')}
                    className="mystic-btn flex items-center gap-1 px-2.5 py-1 rounded text-white text-xs transition cursor-pointer"
                  >
                    {copied === 'compose' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied === 'compose' ? 'کپی شد!' : 'کپی کد'}</span>
                  </button>
                </div>
              </div>
              <pre className="p-4 rounded-xl bg-[#040b18]/90 border border-[#0f3a55]/50 font-mono text-[11px] text-[#c9d1d9] overflow-x-auto" dir="ltr">
                {COMPOSE_CONTENT}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
