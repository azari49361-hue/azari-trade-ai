import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  ColorType,
  CrosshairMode,
  IChartApi,
  ISeriesApi,
  IPriceLine,
  LineStyle,
  UTCTimestamp,
} from 'lightweight-charts';
import { QuoteData, OHLCBar, TradeSignal } from '../types';
import { computeTradePnl, formatPnl } from '../utils/tradePnl';
import {
  BarChart2,
  LineChart,
  Maximize2,
  Layers,
  TrendingUp,
  TrendingDown,
  Sparkles,
  AlertTriangle,
} from 'lucide-react';
import { digitsFor } from '../utils/digits';
import { apiUrl } from '../utils/api';

interface LiveTradingChartProps {
  selectedSymbol: string;
  quote?: QuoteData;
  /** معاملهٔ بازِ همین نماد — خطوط ورود/SL/TP و سود لحظه‌ای روی نمودار. */
  activeSignal?: TradeSignal | null;
}

const TIMEFRAMES = [
  { label: 'M1', value: '1m', name: '۱ دقیقه' },
  { label: 'M5', value: '5m', name: '۵ دقیقه (اصلی)' },
  { label: 'M15', value: '15m', name: '۱۵ دقیقه' },
  { label: 'H1', value: '1h', name: '۱ ساعت' },
  { label: 'H4', value: '4h', name: '۴ ساعت' },
  { label: 'D1', value: '1d', name: 'روزانه' },
];

export const LiveTradingChart: React.FC<LiveTradingChartProps> = ({ selectedSymbol, quote, activeSignal }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ema9SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ema21SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);

  const [interval, setIntervalVal] = useState<string>('5m');
  const [chartType, setChartType] = useState<'candlestick' | 'line'>('candlestick');
  const [showEMAs, setShowEMAs] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const currentBarRef = useRef<{
    time: UTCTimestamp;
    open: number;
    high: number;
    low: number;
    close: number;
  } | null>(null);

  const digits = digitsFor(selectedSymbol);

  const calculateEMAPoints = useCallback((closes: { time: UTCTimestamp; value: number }[], period: number) => {
    if (closes.length < period) return [];
    const k = 2 / (period + 1);
    const result: { time: UTCTimestamp; value: number }[] = [];

    let sum = 0;
    for (let i = 0; i < period; i++) sum += closes[i].value;
    let prevEma = sum / period;
    result.push({ time: closes[period - 1].time, value: prevEma });

    for (let i = period; i < closes.length; i++) {
      const currEma = closes[i].value * k + prevEma * (1 - k);
      result.push({ time: closes[i].time, value: currEma });
      prevEma = currEma;
    }
    return result;
  }, []);

  const loadChartData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(apiUrl(`/api/ohlc?symbol=${selectedSymbol}&interval=${interval}&limit=120`));
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(data.bars)) {
        throw new Error(data.error || 'دریافت داده کندل ناموفق بود');
      }
      const rawBars: OHLCBar[] = data.bars;

      if (!rawBars.length) {
        setLoadError('داده‌ای برای این نماد/بازه در دسترس نیست.');
        return;
      }

      const sorted = [...rawBars].sort(
        (a, b) => new Date(a.openTime).getTime() - new Date(b.openTime).getTime()
      );

      const seenTimes = new Set<number>();
      const candleData: { time: UTCTimestamp; open: number; high: number; low: number; close: number }[] = [];
      const lineData: { time: UTCTimestamp; value: number }[] = [];

      for (const b of sorted) {
        const timeSec = Math.floor(new Date(b.openTime).getTime() / 1000) as UTCTimestamp;
        if (!seenTimes.has(timeSec)) {
          seenTimes.add(timeSec);
          candleData.push({ time: timeSec, open: b.open, high: b.high, low: b.low, close: b.close });
          lineData.push({ time: timeSec, value: b.close });
        }
      }

      if (candleData.length > 0) {
        const last = candleData[candleData.length - 1];
        currentBarRef.current = { ...last };

        candleSeriesRef.current?.setData(candleData);
        lineSeriesRef.current?.setData(lineData);

        if (ema9SeriesRef.current && ema21SeriesRef.current) {
          ema9SeriesRef.current.setData(calculateEMAPoints(lineData, 9));
          ema21SeriesRef.current.setData(calculateEMAPoints(lineData, 21));
        }
        chartRef.current?.timeScale().fitContent();
      }
    } catch (err: any) {
      setLoadError(err?.message || 'اتصال برقرار نیست');
    } finally {
      setLoading(false);
    }
  }, [selectedSymbol, interval, calculateEMAPoints]);

  useEffect(() => {
    if (!containerRef.current) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const container = containerRef.current;
    const chart = createChart(container, {
      width: container.clientWidth,
      height: 420,
      layout: {
        background: { type: ColorType.Solid, color: '#07040b' },
        textColor: '#b8a7b5',
        fontSize: 11,
        fontFamily: "'JetBrains Mono', 'Vazirmatn', monospace",
      },
      grid: {
        vertLines: { color: 'rgba(90, 20, 50, 0.22)', style: 1 },
        horzLines: { color: 'rgba(60, 30, 80, 0.22)', style: 1 },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#7c9cff', width: 1, style: 2, labelBackgroundColor: '#3a1030' },
        horzLine: { color: '#00e5ff', width: 1, style: 2, labelBackgroundColor: '#3a1030' },
      },
      rightPriceScale: {
        borderColor: '#3a1025',
        autoScale: true,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: '#3a1025',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
        barSpacing: 8,
      },
    });

    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#238636',
      downColor: '#da3633',
      borderVisible: true,
      borderUpColor: '#2ea043',
      borderDownColor: '#f85149',
      wickUpColor: '#2ea043',
      wickDownColor: '#f85149',
      visible: chartType === 'candlestick',
    });
    candleSeriesRef.current = candleSeries;

    const lineSeries = chart.addSeries(LineSeries, {
      color: '#58a6ff',
      lineWidth: 2,
      visible: chartType === 'line',
      priceLineColor: '#58a6ff',
    });
    lineSeriesRef.current = lineSeries;

    const ema9 = chart.addSeries(LineSeries, {
      color: '#388bfd',
      lineWidth: 2,
      title: 'EMA 9',
      visible: showEMAs,
      lastValueVisible: showEMAs,
      priceLineVisible: false,
    });
    ema9SeriesRef.current = ema9;

    const ema21 = chart.addSeries(LineSeries, {
      color: '#f0883e',
      lineWidth: 2,
      title: 'EMA 21',
      visible: showEMAs,
      lastValueVisible: showEMAs,
      priceLineVisible: false,
    });
    ema21SeriesRef.current = ema21;

    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    loadChartData();

    return () => {
      window.removeEventListener('resize', handleResize);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [loadChartData]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    candleSeriesRef.current?.applyOptions({ visible: chartType === 'candlestick' });
    lineSeriesRef.current?.applyOptions({ visible: chartType === 'line' });
  }, [chartType]);

  useEffect(() => {
    ema9SeriesRef.current?.applyOptions({ visible: showEMAs, lastValueVisible: showEMAs });
    ema21SeriesRef.current?.applyOptions({ visible: showEMAs, lastValueVisible: showEMAs });
  }, [showEMAs]);

  // Live tick update — ONLY for LIVE quotes. Stale data never animates as live.
  useEffect(() => {
    if (!quote || quote.quoteState !== 'LIVE' || !quote.mid || quote.mid <= 0) return;
    if (!currentBarRef.current) return;

    const price = quote.mid;
    const bar = currentBarRef.current;
    const updatedBar = {
      ...bar,
      close: price,
      high: Math.max(bar.high, price),
      low: Math.min(bar.low, price),
    };
    currentBarRef.current = updatedBar;

    if (candleSeriesRef.current && chartType === 'candlestick') {
      try {
        candleSeriesRef.current.update(updatedBar);
      } catch {
        /* safe fail */
      }
    }
    if (lineSeriesRef.current && chartType === 'line') {
      try {
        lineSeriesRef.current.update({ time: updatedBar.time, value: price });
      } catch {
        /* safe fail */
      }
    }
  }, [quote, chartType]);

  // خطوط معاملهٔ باز (ورود / حد ضرر / اهداف) روی نمودار — با هر سیگنال جدید به‌روز می‌شود
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    for (const line of priceLinesRef.current) {
      try {
        series.removePriceLine(line);
      } catch {
        /* safe fail */
      }
    }
    priceLinesRef.current = [];

    if (!activeSignal || activeSignal.symbol !== selectedSymbol) return;

    const vertical = (price: number, color: string, title: string, style: LineStyle) => {
      try {
        priceLinesRef.current.push(
          series.createPriceLine({
            price,
            color,
            lineWidth: 1,
            lineStyle: style,
            axisLabelVisible: true,
            title,
          })
        );
      } catch {
        /* safe fail */
      }
    };

    vertical(activeSignal.entry, '#e6edf3', 'ورود', LineStyle.Solid);
    vertical(activeSignal.sl, '#f85149', 'SL', LineStyle.Dashed);
    vertical(activeSignal.tp1, '#3fb950', 'TP1', LineStyle.Dotted);
    vertical(activeSignal.tp2, '#3fb950', 'TP2', LineStyle.Dotted);
    vertical(activeSignal.tp3, '#3fb950', 'TP3', LineStyle.Dotted);

    return () => {
      for (const line of priceLinesRef.current) {
        try {
          series.removePriceLine(line);
        } catch {
          /* safe fail */
        }
      }
      priceLinesRef.current = [];
    };
  }, [activeSignal, selectedSymbol, loading, interval]);

  const fitContent = () => chartRef.current?.timeScale().fitContent();

  const isUp = (quote?.dayDiffPercent ?? 0) >= 0;
  const isStale = quote?.quoteState !== 'LIVE';
  const hasPrice = Boolean(quote && quote.mid !== null && quote.mid > 0);

  return (
    <div className="mystic-frame mystic-chart bg-[#040c18]/80 border border-[#0f3a55]/60 rounded-2xl overflow-hidden shadow-2xl flex flex-col backdrop-blur-sm">
      {/* Toolbar */}
      <div className="px-4 py-3 border-b border-[#0f3a55]/50 flex flex-wrap items-center justify-between gap-3 bg-[#061223]/80">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${isStale ? 'bg-[#e3b341]' : 'bg-[#3fb950] animate-pulse'}`}
            ></span>
            <span className="font-bold text-white text-base font-mono">{selectedSymbol}</span>
            <span className="text-xs text-[#8b949e]">({quote?.nameFa || 'نمودار زنده'})</span>
          </div>

          <div className="mystic-frame flex flex-wrap items-center bg-[#040a16]/90 p-1 rounded-lg border border-[#164d66]/50 max-w-full">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf.value}
                onClick={() => setIntervalVal(tf.value)}
                className={`px-2.5 py-1.5 sm:px-2 sm:py-1 rounded text-xs font-mono font-medium transition cursor-pointer ${
                  interval === tf.value
                    ? 'bg-gradient-to-b from-[#4a1030] to-[#1a1028] text-[#ffe8f0] shadow-[0_0_12px_rgba(180,0,70,0.45)] border border-[#1f6f99]/60'
                    : 'text-[#b8a7b5] hover:text-[#e6f6ff] hover:bg-[#1a0f1e] border border-transparent'
                }`}
                title={tf.name}
              >
                {tf.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowEMAs(!showEMAs)}
            className={`mystic-btn flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition cursor-pointer ${
              showEMAs ? 'text-[#7c9cff]' : 'text-[#b8a7b5]'
            }`}
            title="نمایش اندیکاتورهای EMA 9 و EMA 21 روی نمودار"
          >
            <Layers className="w-3.5 h-3.5" />
            <span>EMA 9/21</span>
            {showEMAs && (
              <div className="flex items-center gap-1 text-[10px] mr-1">
                <span className="w-2 h-2 rounded-full bg-[#7c4dff] shadow-[0_0_6px_#7c4dff]"></span>
                <span className="w-2 h-2 rounded-full bg-[#ff6d00] shadow-[0_0_6px_#ff6d00]"></span>
              </div>
            )}
          </button>

          <div className="mystic-frame flex items-center bg-[#040a16]/90 p-0.5 rounded-lg border border-[#164d66]/50">
            <button
              onClick={() => setChartType('candlestick')}
              className={`p-1.5 rounded transition cursor-pointer ${
                chartType === 'candlestick' ? 'bg-[#2a1020] text-[#39ffb6] shadow-[0_0_8px_rgba(127,255,212,0.35)]' : 'text-[#b8a7b5] hover:text-white'
              }`}
              title="نمودار کندل استیک"
            >
              <BarChart2 className="w-4 h-4" />
            </button>
            <button
              onClick={() => setChartType('line')}
              className={`p-1.5 rounded transition cursor-pointer ${
                chartType === 'line' ? 'bg-[#2a1020] text-[#7c9cff] shadow-[0_0_8px_rgba(179,136,255,0.35)]' : 'text-[#b8a7b5] hover:text-white'
              }`}
              title="نمودار خطی"
            >
              <LineChart className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={fitContent}
            className="mystic-btn p-1.5 rounded-lg border text-[#b8a7b5] hover:text-white transition cursor-pointer"
            title="تنظیم خودکار ابعاد نمودار"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Chart Area */}
      <div className="relative w-full h-[420px] bg-[#030814]">
        {loading && (
          <div className="absolute inset-0 bg-[#030814]/85 backdrop-blur-sm flex items-center justify-center z-10">
            <div className="flex flex-col items-center gap-2">
              <div className="w-7 h-7 border-2 border-[#1f6feb] border-t-transparent rounded-full animate-spin"></div>
              <span className="text-xs text-[#8b949e]">در حال بارگذاری داده‌های کندل…</span>
            </div>
          </div>
        )}

        {!loading && loadError && (
          <div className="absolute inset-0 bg-[#0d1117]/92 flex items-center justify-center z-10">
            <div className="flex flex-col items-center gap-2 text-center px-4">
              <AlertTriangle className="w-8 h-8 text-[#f85149]" />
              <span className="text-sm text-[#f85149] font-semibold">اتصال برقرار نیست</span>
              <span className="text-xs text-[#8b949e]">{loadError}</span>
              <button
                onClick={loadChartData}
                className="mt-2 px-3 py-1.5 rounded-lg bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-xs text-white transition cursor-pointer"
              >
                تلاش مجدد
              </button>
            </div>
          </div>
        )}

        {isStale && !loading && !loadError && (
          <div className="absolute top-3 right-3 z-10 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#d29922]/15 border border-[#d29922]/50 text-[#e3b341] text-[11px]">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>
              {quote?.quoteState === 'NONE'
                ? 'اتصال برقرار نیست — به‌روزرسانی زنده متوقف است'
                : `داده کهنه (${quote?.ageSeconds ?? '?'} ثانیه قبل) — به‌روزرسانی زنده متوقف است`}
            </span>
          </div>
        )}

        {activeSignal && activeSignal.symbol === selectedSymbol && (() => {
          const pnl = computeTradePnl(activeSignal, quote?.mid);
          const isLive = quote?.quoteState === 'LIVE';
          const cls = !pnl
            ? 'bg-[#21262d]/90 border-[#30363d] text-[#8b949e]'
            : pnl.inProfit
            ? 'bg-[#238636]/25 border-[#3fb950] text-[#3fb950]'
            : 'bg-[#da3633]/25 border-[#f85149] text-[#f85149]';
          return (
            <div className={`absolute top-3 left-3 z-10 rounded-lg border px-2.5 py-1.5 font-mono text-[11px] ${cls}`} dir="rtl">
              <div className="flex items-center gap-1.5 font-bold">
                <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'animate-pulse' : ''} ${pnl?.inProfit ? 'bg-[#3fb950]' : 'bg-[#f85149]'}`}></span>
                <span>{activeSignal.type === 'BUY' ? 'معاملهٔ باز · خرید' : 'معاملهٔ باز · فروش'}</span>
                <span className="text-[#8b949e] font-normal">{isLive ? 'زنده' : 'قیمت کهنه'}</span>
              </div>
              <div className="mt-0.5 text-[10px] text-[#8b949e]" dir="ltr">
                {`${activeSignal.entry.toFixed(digits)} → ${pnl ? pnl.price.toFixed(digits) : '--'}`}
              </div>
              {pnl ? (
                <div className="mt-0.5 text-[12px] font-bold" dir="ltr">
                  {formatPnl(pnl, digits)}
                  <span className="mr-1.5 font-normal">{`${pnl.percent >= 0 ? '+' : '−'}${Math.abs(pnl.percent).toFixed(2)}%`}</span>
                </div>
              ) : (
                <div className="mt-0.5">قیمت زنده در دسترس نیست</div>
              )}
            </div>
          );
        })()}

        <div ref={containerRef} className="w-full h-full" />

        <div
          className="absolute bottom-3 left-4 pointer-events-none text-[11px] font-mono text-[#30363d] flex items-center gap-1.5"
          dir="ltr"
        >
          <Sparkles className="w-3.5 h-3.5 text-[#30363d]" />
          <span>Azari Trade AI · {quote?.source || 'Live Stream'}</span>
        </div>
      </div>

      {/* Bottom Live Price Banner */}
      <div className="px-5 py-4 border-t border-[#0f3a55]/50 bg-[#061223]/80 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <div
            className={`font-mono font-bold tracking-tight ${hasPrice ? 'text-3xl sm:text-4xl text-white' : 'text-lg text-[#f85149]'}`}
            dir={hasPrice ? 'ltr' : undefined}
          >
            {hasPrice ? quote!.mid!.toFixed(digits) : 'اتصال برقرار نیست'}
          </div>

          {quote?.dayDiffPercent !== null && quote?.dayDiffPercent !== undefined ? (
            <div
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-sm font-mono font-bold ${
                isUp
                  ? 'bg-[#238636]/20 text-[#3fb950] border border-[#238636]/40'
                  : 'bg-[#da3633]/20 text-[#f85149] border border-[#da3633]/40'
              }`}
              dir="ltr"
            >
              {isUp ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              <span>{`${isUp ? '+' : ''}${quote.dayDiffPercent.toFixed(2)}%`}</span>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3 sm:gap-6 text-xs font-mono" dir="ltr">
          <div className="flex flex-col">
            <span className="text-[11px] text-[#8b949e] text-right">Bid</span>
            <span className="text-white font-medium">
              {quote?.bid !== null && quote?.bid !== undefined ? quote.bid.toFixed(digits) : '--'}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] text-[#8b949e] text-right">Ask</span>
            <span className="text-white font-medium">
              {quote?.ask !== null && quote?.ask !== undefined ? quote.ask.toFixed(digits) : '--'}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] text-[#8b949e] text-right">Spread</span>
            <span className="text-[#58a6ff] font-medium">
              {quote?.spread !== null && quote?.spread !== undefined ? quote.spread.toFixed(digits) : '--'}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] text-[#8b949e] text-right">High</span>
            <span className="text-[#3fb950] font-medium">
              {quote?.high !== null && quote?.high !== undefined ? quote.high.toFixed(digits) : '--'}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] text-[#8b949e] text-right">Low</span>
            <span className="text-[#f85149] font-medium">
              {quote?.low !== null && quote?.low !== undefined ? quote.low.toFixed(digits) : '--'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
