import { useState, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { useInterval } from 'ahooks';
import goldData from '../data/goldData.json';
import heroGold from '../assets/hero-gold.jpg';
import { useLiveQuotes } from '../hooks/useLiveQuotes';
import { resolveGoldMarketClock } from '../utils/marketClock';

const MONO = "ui-monospace, 'SF Mono', Consolas, monospace";
const DISPLAY = "'Barlow Condensed', 'Arial Narrow', Arial, sans-serif";

const UP = '#FF6B6B';
const DOWN = '#4ADE80';
const GOLD = '#FFD700';
const AMBER = '#F5C542';
const CYAN = '#38bdf8';
const PURPLE = '#a855f7';
const EMERALD = '#34d399';

function shortSession(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  return `${Number(match[2])}/${Number(match[3])}`;
}

function macroQuoteText(quote: { value?: number; chg?: string; unit?: string; session?: string; bp?: number } | undefined): string {
  if (!quote || typeof quote.value !== 'number') return '';
  if (quote.unit === '%') {
    const session = quote.session ? shortSession(quote.session) : '';
    const bp = typeof quote.bp === 'number' ? `${quote.bp > 0 ? '+' : ''}${quote.bp.toFixed(1)}BP` : '';
    const inner = [session ? `${session} 收` : '', bp].filter(Boolean).join('，');
    return `${quote.value.toFixed(3)}%${inner ? `（${inner}）` : ''}`;
  }
  return `${quote.value.toFixed(2)}${quote.chg ? `（${quote.chg}）` : ''}`;
}

const OVERLAY_SERIES = [
  { key: 'london', name: '伦敦金现货 (XAU/USD)', color: GOLD },
  { key: 'shau', name: '上海金现货 (汇率归一)', color: CYAN },
  { key: 'tips', name: '美债10Y实际利率 (倒置)', color: PURPLE },
  { key: 'dxy', name: '美元指数 (DXY)', color: EMERALD },
] as const;

export default function GoldPanel() {
  const {
    metrics,
    tech,
    positioning,
    macro,
    etf,
    action,
    footer,
    snapshot,
    benchmarks,
    premium,
    demandDynamics,
    nextDayWatch,
    charts,
  } = goldData;

  const { liveQuotes } = useLiveQuotes();
  const liveGold = liveQuotes?.gold;

  // 1. 全球黄金交易时钟状态
  const [currentTime, setCurrentTime] = useState(() => new Date());
  useInterval(() => {
    setCurrentTime(new Date());
  }, 30000);

  const clockInfo = useMemo(() => {
    return resolveGoldMarketClock(currentTime);
  }, [currentTime]);

  const [yy, mm, dd] = snapshot.slice(0, 10).split('-');
  const snapDate = liveQuotes?.asOf
    ? new Date(liveQuotes.asOf).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
    : `${yy}年${mm}月${dd}日 ${snapshot.slice(11, 16)}`;

  // 核心报价动态混合
  const displayNum = liveGold?.price || metrics.main.num;
  const displayChg = liveGold?.chg || metrics.main.chg;
  const displayChgClass = liveGold?.chgClass || metrics.main.chgClass;

  const liveBm = liveGold?.benchmarks;
  const activeBm = {
    londonSpot: {
      ...benchmarks.londonSpot,
      price: liveBm?.londonSpot?.price ?? benchmarks.londonSpot.price,
      chg: liveBm?.londonSpot?.chg ?? displayChg,
      chgClass: liveBm?.londonSpot?.chgClass ?? displayChgClass,
    },
    comexGold: {
      ...benchmarks.comexGold,
      price: liveBm?.comexGold?.price ?? benchmarks.comexGold.price,
      chg: liveBm?.comexGold?.chg ?? benchmarks.comexGold.chg,
      chgClass: liveBm?.comexGold?.chgClass ?? benchmarks.comexGold.chgClass,
    },
    shau: {
      ...benchmarks.shau,
      price: liveBm?.shau?.price ?? benchmarks.shau.price,
      chg: liveBm?.shau?.chg ?? benchmarks.shau.chg,
      chgClass: liveBm?.shau?.chgClass ?? benchmarks.shau.chgClass,
    },
  };

  const livePrem = liveGold?.premium ?? premium;
  const chgCls = (c: string) => (c === 'up' ? ' up' : c === 'down' ? ' down' : '');
  const DIM: Record<string, string> = {
    rates: '利率',
    dollar: '美元',
    fed: '美联储',
    centralbank: '央行',
    geo: '地缘',
  };
  const dimOf = (dim?: string) => (dim && DIM[dim] ? DIM[dim] : '');

  // 2. 图表视图模式（Tab 1: 经典日K; Tab 2: 宏观多资产叠加比价）
  const [chartMode, setChartMode] = useState<'kline' | 'overlay'>('kline');
  const [activeTabKey, setActiveTabKey] = useState<'londonSpot' | 'comexGold' | 'shau' | 'premium'>('londonSpot');

  // 日K窗口设置
  const [range, setRange] = useState<'5d' | '30d' | '90d'>('30d');
  const rangeLen = range === '5d' ? 5 : range === '30d' ? 30 : 90;
  const rangeLabel = range === '5d' ? '近 5 交易日' : range === '30d' ? '近 30 交易日' : '近 90 交易日';
  // 当前选中标的专属技术时序与量价
  const currentInst = useMemo(() => {
    const insts = (tech as unknown as { instruments?: Record<string, {
      name: string;
      symbol: string;
      unit: string;
      unitLabel: string;
      currency: string;
      candles: Array<{ d: string; o: number; h: number; l: number; c: number }>;
      volume: number[];
      support: [number, number];
      resistance: [number, number];
    }> }).instruments;

    if (activeTabKey !== 'premium' && insts && insts[activeTabKey]) {
      return insts[activeTabKey];
    }
    return {
      name: '伦敦金现货',
      symbol: 'XAU/USD',
      unit: '$/oz',
      unitLabel: '美元/盎司',
      currency: '$',
      candles: tech.candles,
      volume: tech.volume,
      support: tech.support as [number, number],
      resistance: tech.resistance as [number, number],
    };
  }, [tech, activeTabKey]);

  const sliceCandles = currentInst.candles.slice(-rangeLen);
  const candleDates = sliceCandles.map((c) => c.d);
  const candleData = sliceCandles.map((c) => [c.o, c.c, c.l, c.h] as number[]);
  const volData = currentInst.volume.slice(-rangeLen).map((v, i) => {
    const c = sliceCandles[i];
    return { value: v, itemStyle: { color: c.c >= c.o ? UP : DOWN, opacity: 0.75 } };
  });

  // 趋势生命线 MA20 / MA60 计算（基于当前标的全量时序滑动计算）
  const fullCloses = currentInst.candles.map((c) => c.c);
  const sliceMA20 = fullCloses.map((_, i) => {
    if (i < 19) return null;
    let sum = 0;
    for (let j = 0; j < 20; j++) sum += fullCloses[i - j];
    return parseFloat((sum / 20).toFixed(2));
  }).slice(-rangeLen);

  const sliceMA60 = fullCloses.map((_, i) => {
    if (i < 59) return null;
    let sum = 0;
    for (let j = 0; j < 60; j++) sum += fullCloses[i - j];
    return parseFloat((sum / 60).toFixed(2));
  }).slice(-rangeLen);

  const currentMA20 = fullCloses.length >= 20
    ? (fullCloses.slice(-20).reduce((a, b) => a + b, 0) / 20).toFixed(1)
    : (fullCloses[fullCloses.length - 1] ?? 0).toFixed(1);

  const currentMA60 = fullCloses.length >= 60
    ? (fullCloses.slice(-60).reduce((a, b) => a + b, 0) / 60).toFixed(1)
    : currentMA20;

  const klineOpt: EChartsOption = useMemo(() => ({
    backgroundColor: 'transparent',
    animation: false,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross', crossStyle: { color: 'rgba(240,240,250,0.3)' } },
      backgroundColor: 'rgba(0,0,0,0.9)',
      borderColor: 'rgba(240,240,250,0.35)',
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: '#f0f0fa', fontFamily: DISPLAY, fontSize: 12 },
      formatter: (params: unknown) => {
        const list = params as { seriesName?: string; axisValue?: string; value?: unknown }[];
        if (!Array.isArray(list) || list.length === 0) return '';
        const date = list[0].axisValue ?? '';
        const k = list.find((p) => p.seriesName === currentInst.name);
        const v = k?.value;
        let kline = '';
        if (Array.isArray(v) && v.length >= 4) {
          const [o, c, l, h] = v as number[];
          const pctNum = ((c - o) / o) * 100;
          const pct = `${pctNum >= 0 ? '+' : ''}${pctNum.toFixed(2)}%`;
          const color = c >= o ? UP : DOWN;
          kline = `<span style="font-family:${MONO};font-size:11px;color:#f0f0fa">${date} · ${currentInst.name}</span><br/>`
            + `<b style="color:${color}">收 ${currentInst.currency}${c.toFixed(2)}（${pct}）</b>`
            + `<span style="color:rgba(240,240,250,0.65)">　开 ${currentInst.currency}${o.toFixed(2)}　高 ${currentInst.currency}${h.toFixed(2)}　低 ${currentInst.currency}${l.toFixed(2)}</span>`;
        }
        const ma20 = list.find((p) => p.seriesName === 'MA20')?.value;
        const ma60 = list.find((p) => p.seriesName === 'MA60')?.value;
        const maTxt = [
          typeof ma20 === 'number' ? `<span style="color:${AMBER}">MA20: ${currentInst.currency}${ma20.toFixed(2)}</span>` : '',
          typeof ma60 === 'number' ? `<span style="color:${CYAN}">MA60: ${currentInst.currency}${ma60.toFixed(2)}</span>` : '',
        ].filter(Boolean).join('　');
        const vol = list.find((p) => p.seriesName === '成交量');
        const volTxt = vol && typeof vol.value === 'number' ? `<span style="color:rgba(240,240,250,0.55)">量 ${Number(vol.value).toLocaleString()} 手</span>` : '';
        return `${kline}${maTxt ? `<br/>${maTxt}` : ''}<br/>${volTxt}`;
      },
    },
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    grid: [
      { left: 58, right: 18, top: 26, height: '56%' },
      { left: 58, right: 18, top: '72%', height: '14%' },
    ],
    xAxis: [
      {
        type: 'category',
        data: candleDates,
        gridIndex: 0,
        axisLine: { lineStyle: { color: 'rgba(240,240,250,0.25)' } },
        axisTick: { show: false },
        axisLabel: { color: 'rgba(240,240,250,0.6)', fontFamily: MONO, fontSize: 10 },
      },
      {
        type: 'category',
        data: candleDates,
        gridIndex: 1,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { show: false },
      },
    ],
    yAxis: [
      {
        type: 'value',
        gridIndex: 0,
        scale: true,
        splitLine: { lineStyle: { color: 'rgba(240,240,250,0.12)' } },
        axisLabel: {
          color: 'rgba(240,240,250,0.6)',
          fontFamily: MONO,
          fontSize: 10,
          formatter: (v: number) => `${currentInst.currency}${v.toFixed(0)}`,
        },
      },
      {
        type: 'value',
        gridIndex: 1,
        scale: true,
        splitNumber: 2,
        splitLine: { show: false },
        axisLabel: { show: false },
      },
    ],
    series: [
      {
        name: currentInst.name,
        type: 'candlestick',
        data: candleData,
        itemStyle: { color: UP, color0: DOWN, borderColor: UP, borderColor0: DOWN },
        markArea: {
          silent: true,
          data: [
            [
              {
                name: `SUPPORT ${currentInst.support[0]}-${currentInst.support[1]}`,
                yAxis: currentInst.support[0],
                itemStyle: { color: 'rgba(245,197,66,0.10)' },
                label: {
                  show: true,
                  position: 'insideTop',
                  color: AMBER,
                  fontFamily: MONO,
                  fontSize: 9,
                  formatter: `SUPPORT ${currentInst.support[0]}-${currentInst.support[1]} ${currentInst.unit}`,
                },
              },
              { yAxis: currentInst.support[1] },
            ],
            [
              {
                name: `RESISTANCE ${currentInst.resistance[0]}-${currentInst.resistance[1]}`,
                yAxis: currentInst.resistance[0],
                itemStyle: { color: 'rgba(255,107,107,0.07)' },
                label: {
                  show: true,
                  position: 'insideTop',
                  color: 'rgba(255,107,107,0.95)',
                  fontFamily: MONO,
                  fontSize: 9,
                  formatter: `RESISTANCE ${currentInst.resistance[0]}-${currentInst.resistance[1]} ${currentInst.unit}`,
                },
              },
              { yAxis: currentInst.resistance[1] },
            ],
          ],
        },
      },
      {
        name: '成交量',
        type: 'bar',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: volData,
        barWidth: '55%',
      },
      {
        name: 'MA20',
        type: 'line',
        data: sliceMA20,
        showSymbol: false,
        lineStyle: { color: AMBER, width: 1.6, opacity: 0.9 },
        itemStyle: { color: AMBER },
      },
      {
        name: 'MA60',
        type: 'line',
        data: sliceMA60,
        showSymbol: false,
        lineStyle: { color: CYAN, width: 1.6, opacity: 0.9 },
        itemStyle: { color: CYAN },
      },
    ],
  }), [candleDates, candleData, volData, sliceMA20, sliceMA60, currentInst]);

  // 内外盘溢价历史利差图配置
  const premiumHistory = (tech as unknown as {
    premiumHistory?: {
      dates: string[];
      spreads: number[];
      rates: number[];
      deadband: [number, number];
    };
  }).premiumHistory;

  const premiumOpt: EChartsOption = useMemo(() => {
    if (!premiumHistory) return {};
    const dates = premiumHistory.dates.slice(-rangeLen);
    const spreads = premiumHistory.spreads.slice(-rangeLen);
    const rates = premiumHistory.rates.slice(-rangeLen);
    const deadband = premiumHistory.deadband || [-5, 8];

    return {
      backgroundColor: 'transparent',
      animation: false,
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', crossStyle: { color: 'rgba(240,240,250,0.3)' } },
        backgroundColor: 'rgba(0,0,0,0.92)',
        borderColor: 'rgba(240,240,250,0.35)',
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: '#f0f0fa', fontFamily: DISPLAY, fontSize: 12 },
        formatter: (params: unknown) => {
          const list = params as { seriesName?: string; axisValue?: string; value?: unknown }[];
          if (!Array.isArray(list) || list.length === 0) return '';
          const d = list[0].axisValue ?? '';
          const spreadItem = list.find((p) => p.seriesName === '利差 ($/oz)');
          const rateItem = list.find((p) => p.seriesName === '溢价率 (%)');
          const spreadVal = typeof spreadItem?.value === 'number' ? spreadItem.value : 0;
          const rateVal = typeof rateItem?.value === 'number' ? rateItem.value : 0;
          const status = spreadVal > deadband[1] ? '境内买盘偏强 (HOT)' : spreadVal < deadband[0] ? '离岸买盘偏强 (COLD)' : '无套利中性区间 (DEADBAND)';
          const color = spreadVal > deadband[1] ? UP : spreadVal < deadband[0] ? DOWN : AMBER;
          return `<span style="font-family:${MONO};font-size:11px;color:#f0f0fa">${d} · 内外盘溢价</span><br/>`
            + `<b style="color:${color}">利差: ${spreadVal >= 0 ? '+' : ''}${spreadVal.toFixed(2)} $/oz</b><br/>`
            + `<span style="color:${CYAN}">溢价率: ${rateVal >= 0 ? '+' : ''}${rateVal.toFixed(2)}%</span><br/>`
            + `<span style="color:rgba(240,240,250,0.65);font-size:11px">状态: ${status}</span>`;
        },
      },
      legend: {
        top: 4,
        right: 18,
        itemWidth: 14,
        itemHeight: 4,
        textStyle: { color: 'rgba(240,240,250,0.7)', fontFamily: MONO, fontSize: 10 },
      },
      grid: [
        { left: 58, right: 48, top: 32, height: '54%' },
        { left: 58, right: 48, top: '70%', height: '18%' },
      ],
      xAxis: [
        {
          type: 'category',
          data: dates,
          gridIndex: 0,
          axisLine: { lineStyle: { color: 'rgba(240,240,250,0.25)' } },
          axisTick: { show: false },
          axisLabel: { color: 'rgba(240,240,250,0.6)', fontFamily: MONO, fontSize: 10 },
        },
        {
          type: 'category',
          data: dates,
          gridIndex: 1,
          axisLine: { lineStyle: { color: 'rgba(240,240,250,0.25)' } },
          axisTick: { show: false },
          axisLabel: { color: 'rgba(240,240,250,0.6)', fontFamily: MONO, fontSize: 10 },
        },
      ],
      yAxis: [
        {
          type: 'value',
          gridIndex: 0,
          scale: true,
          splitLine: { lineStyle: { color: 'rgba(240,240,250,0.12)' } },
          axisLabel: {
            color: 'rgba(240,240,250,0.6)',
            fontFamily: MONO,
            fontSize: 10,
            formatter: (v: number) => `${v >= 0 ? '+' : ''}$${v.toFixed(0)}`,
          },
        },
        {
          type: 'value',
          gridIndex: 1,
          scale: true,
          splitLine: { lineStyle: { color: 'rgba(240,240,250,0.08)' } },
          axisLabel: {
            color: 'rgba(240,240,250,0.6)',
            fontFamily: MONO,
            fontSize: 10,
            formatter: (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`,
          },
        },
      ],
      series: [
        {
          name: '利差 ($/oz)',
          type: 'bar',
          gridIndex: 0,
          data: spreads.map((s) => ({
            value: s,
            itemStyle: {
              color: s > deadband[1] ? 'rgba(255,107,107,0.85)' : s < deadband[0] ? 'rgba(74,222,128,0.85)' : 'rgba(245,197,66,0.65)',
            },
          })),
          markArea: {
            silent: true,
            data: [
              [
                {
                  name: `中性死区 [${deadband[0]}, +${deadband[1]}]`,
                  yAxis: deadband[0],
                  itemStyle: { color: 'rgba(245,197,66,0.08)' },
                  label: {
                    show: true,
                    position: 'insideLeft',
                    color: AMBER,
                    fontFamily: MONO,
                    fontSize: 9,
                    formatter: `中性套利死区 [${deadband[0]}, +${deadband[1]}] $/oz`,
                  },
                },
                { yAxis: deadband[1] },
              ],
            ],
          },
          markLine: {
            silent: true,
            lineStyle: { type: 'dashed', color: 'rgba(240,240,250,0.35)', width: 1 },
            data: [{ yAxis: 0 }],
          },
        },
        {
          name: '溢价率 (%)',
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: rates,
          showSymbol: false,
          lineStyle: { color: CYAN, width: 2 },
          itemStyle: { color: CYAN },
        },
      ],
    };
  }, [premiumHistory, rangeLen]);

  // 跨资产归一化叠加图配置
  const normData = charts?.normalized;
  const overlayOpt: EChartsOption = useMemo(() => {
    if (!normData) return {};
    return {
      backgroundColor: 'transparent',
      animationDuration: 300,
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(0,0,0,0.92)',
        borderColor: 'rgba(240,240,250,0.35)',
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: '#f0f0fa', fontFamily: DISPLAY, fontSize: 12 },
        valueFormatter: (v: unknown) => (typeof v === 'number' ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '--'),
      },
      legend: {
        top: 6,
        right: 18,
        itemWidth: 14,
        itemHeight: 3,
        textStyle: { color: 'rgba(240,240,250,0.7)', fontFamily: MONO, fontSize: 10 },
      },
      grid: { left: 48, right: 18, top: 38, bottom: 28 },
      xAxis: {
        type: 'category',
        data: normData.dates,
        axisLine: { lineStyle: { color: 'rgba(240,240,250,0.25)' } },
        axisTick: { show: false },
        axisLabel: { color: 'rgba(240,240,250,0.6)', fontFamily: MONO, fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        scale: true,
        splitLine: { lineStyle: { color: 'rgba(240,240,250,0.1)' } },
        axisLabel: {
          color: 'rgba(240,240,250,0.6)',
          fontFamily: MONO,
          fontSize: 10,
          formatter: (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`,
        },
      },
      series: OVERLAY_SERIES.map((item) => ({
        name: item.name,
        type: 'line',
        data: (normData[item.key as keyof typeof normData] as number[]) || [],
        showSymbol: false,
        lineStyle: { color: item.color, width: item.key === 'london' ? 2.5 : 1.6 },
        itemStyle: { color: item.color },
      })),
    };
  }, [normData]);

  // CTA 趋势持仓与空头耗尽极限仪表图配置
  const ctaGaugeOpt: EChartsOption = useMemo(() => {
    const cta = (positioning as unknown as { ctaMonitor?: { shortCapacityUsedPct?: number } }).ctaMonitor;
    const val = cta?.shortCapacityUsedPct || 93.5;
    return {
      backgroundColor: 'transparent',
      animation: false,
      series: [
        {
          type: 'gauge',
          startAngle: 180,
          endAngle: 0,
          min: 0,
          max: 100,
          radius: '110%',
          center: ['50%', '75%'],
          splitNumber: 5,
          axisLine: {
            lineStyle: {
              width: 10,
              color: [
                [0.7, 'rgba(245, 197, 66, 0.4)'],
                [0.9, 'rgba(255, 107, 107, 0.6)'],
                [1.0, '#FF6B6B'],
              ],
            },
          },
          pointer: {
            icon: 'path://M12.8,0.7l12,40.1H0.7L12.8,0.7z',
            length: '14%',
            width: 8,
            offsetCenter: [0, '-58%'],
            itemStyle: { color: '#FF6B6B' },
          },
          axisTick: { length: 3, lineStyle: { color: 'rgba(255,255,255,0.25)', width: 1 } },
          splitLine: { length: 8, lineStyle: { color: 'rgba(255,255,255,0.4)', width: 1.5 } },
          axisLabel: {
            color: 'rgba(240, 240, 250, 0.6)',
            fontFamily: MONO,
            fontSize: 9,
            distance: -26,
            formatter: (v: number) => (v === 0 ? '0%' : v === 100 ? '极限' : `${v}%`),
          },
          title: {
            offsetCenter: [0, '-22%'],
            fontSize: 11,
            color: 'rgba(240, 240, 250, 0.65)',
            fontFamily: DISPLAY,
          },
          detail: {
            fontSize: 20,
            offsetCenter: [0, '12%'],
            formatter: (v: number) => `${v.toFixed(1)}%`,
            color: '#FF6B6B',
            fontFamily: MONO,
            fontWeight: 'bold',
          },
          data: [{ value: val, name: '有效最大空仓利用率' }],
        },
      ],
    };
  }, [positioning]);

  // 77吨微观吸收矩阵通道图配置
  const absorptionOpt: EChartsOption = useMemo(() => {
    const abs = (positioning as unknown as {
      absorptionMatrix?: {
        channels: Array<{ name: string; tons: string; share: string; role: string; tag: string }>;
      };
    }).absorptionMatrix;
    if (!abs) return {};
    const channels = [...abs.channels].reverse();
    const names = channels.map((c) => c.name);
    const values = channels.map((c) => parseFloat(c.tons));
    const colors = [EMERALD, GOLD, CYAN];

    return {
      backgroundColor: 'transparent',
      animation: false,
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: 'rgba(0,0,0,0.92)',
        borderColor: 'rgba(56, 189, 248, 0.4)',
        borderWidth: 1,
        padding: [6, 10],
        textStyle: { color: '#f0f0fa', fontFamily: DISPLAY, fontSize: 11 },
        formatter: (params: unknown) => {
          const list = params as { name: string; value: number }[];
          if (!list || list.length === 0) return '';
          const item = abs.channels.find((c) => c.name === list[0].name);
          if (!item) return '';
          return `<span style="font-family:${MONO};font-size:11px;color:${CYAN}">${item.name} · ${item.tag}</span><br/>`
            + `<b style="font-size:13px;color:#fff">${item.tons}</b> <span style="color:${AMBER}">(${item.share})</span><br/>`
            + `<span style="font-size:10.5px;color:rgba(240,240,250,0.7)">${item.role}</span>`;
        },
      },
      grid: {
        left: 114,
        right: 48,
        top: 6,
        bottom: 18,
      },
      xAxis: {
        type: 'value',
        max: 50,
        splitLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.08)' } },
        axisLabel: {
          color: 'rgba(240, 240, 250, 0.55)',
          fontFamily: MONO,
          fontSize: 9,
          formatter: (v: number) => `${v}t`,
        },
      },
      yAxis: {
        type: 'category',
        data: names,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: 'rgba(240, 240, 250, 0.85)',
          fontFamily: DISPLAY,
          fontSize: 11,
          fontWeight: 'bold',
        },
      },
      series: [
        {
          name: '承接吨数',
          type: 'bar',
          data: values.map((val, idx) => ({
            value: val,
            itemStyle: {
              color: colors[idx % colors.length],
              borderRadius: [0, 3, 3, 0],
            },
          })),
          barWidth: 12,
          label: {
            show: true,
            position: 'right',
            color: '#f0f0fa',
            fontFamily: MONO,
            fontSize: 10,
            fontWeight: 'bold',
            formatter: '{c} 吨',
          },
        },
      ],
    };
  }, [positioning]);
  const currentGoldPrice = parseFloat(String(displayNum).replace(/[^0-9.]/g, '')) || 4140.52;

  // 溢价区域样式 class
  const premZoneClass = (livePrem?.zone || 'NORMAL').toLowerCase();

  return (
    <article>
      <header className="hero">
        <img className="hero-bg" src={heroGold} alt="金条堆叠" />
        <span className="hero-scrim" aria-hidden="true" />
        <div className="hero-inner">
          <div className="hero-main">
            <div className="kicker">THEME 03 · GOLD</div>
            <h1>黄金</h1>
            <p className="hero-lead">以伦敦金现货为核心，对照纽约 COMEX 与上海金：跨市场比价、持仓资金与东西方实物需求。</p>
          </div>
          <div className="hero-aside">
            <span className="hero-meta"><b>最后更新：{snapDate}</b></span>
          </div>
        </div>
      </header>

      <div className="content">
        {/* ==================== 1. 终端宏观交易时钟、四柱双轨报价与走势图表一体化系统 ==================== */}
        <section className="terminal-macro-viewport">
          {/* A. 全球黄金交易时钟条 */}
          <div className="terminal-clock-bar">
            <div className="terminal-clock-title">
              <span className="live-pulse-dot" aria-hidden="true" />
              <span className="clock-phase-label">
                {clockInfo.tradingPhase.headline}
              </span>
              <span className="clock-phase-window mono">
                {clockInfo.tradingPhase.window}
              </span>
            </div>
            <div className="terminal-mode-toggles">
              <button
                type="button"
                className={`terminal-mode-btn ${chartMode === 'kline' ? 'active' : ''}`}
                onClick={() => setChartMode('kline')}
              >
                日K形态
              </button>
              <button
                type="button"
                className={`terminal-mode-btn ${chartMode === 'overlay' ? 'active' : ''}`}
                onClick={() => setChartMode('overlay')}
              >
                跨市比价
              </button>
            </div>
          </div>

          {/* B. 四柱核心双轨行情与内外盘溢价栏 */}
          <div className="terminal-index-tabs-bar quad-tabs" role="tablist">
            {/* 1. 伦敦金现货 */}
            <button
              type="button"
              className={`index-tab-button londonSpot ${activeTabKey === 'londonSpot' ? 'active' : ''}`}
              onClick={() => setActiveTabKey('londonSpot')}
            >
              <div className="index-tab-head-row">
                <div className="index-tab-name-box">
                  <span className="index-tab-name">{activeBm.londonSpot.name}</span>
                  <span className="index-tab-sym">{activeBm.londonSpot.symbol}</span>
                </div>
                <span className={`index-tab-status ${clockInfo.sessions.lbma.status.toLowerCase()}`}>
                  {clockInfo.sessions.lbma.statusLabel}
                </span>
              </div>
              <div className="index-tab-data-row">
                <span className="index-tab-price">${activeBm.londonSpot.price.toFixed(2)}</span>
                <span className={`index-tab-chg ${chgCls(activeBm.londonSpot.chgClass)}`}>{activeBm.londonSpot.chg}</span>
              </div>
            </button>

            {/* 2. COMEX 期金主力 */}
            <button
              type="button"
              className={`index-tab-button comexGold ${activeTabKey === 'comexGold' ? 'active' : ''}`}
              onClick={() => setActiveTabKey('comexGold')}
            >
              <div className="index-tab-head-row">
                <div className="index-tab-name-box">
                  <span className="index-tab-name">{activeBm.comexGold.name}</span>
                  <span className="index-tab-sym">{activeBm.comexGold.symbol}</span>
                </div>
                <span className={`index-tab-status ${clockInfo.sessions.comex.status.toLowerCase()}`}>
                  {clockInfo.sessions.comex.statusLabel}
                </span>
              </div>
              <div className="index-tab-data-row">
                <span className="index-tab-price">${activeBm.comexGold.price.toFixed(2)}</span>
                <span className={`index-tab-chg ${chgCls(activeBm.comexGold.chgClass)}`}>{activeBm.comexGold.chg}</span>
              </div>
            </button>

            {/* 3. 上海金现货 (Au99.99) */}
            <button
              type="button"
              className={`index-tab-button shau ${activeTabKey === 'shau' ? 'active' : ''}`}
              onClick={() => setActiveTabKey('shau')}
            >
              <div className="index-tab-head-row">
                <div className="index-tab-name-box">
                  <span className="index-tab-name">{activeBm.shau.name}</span>
                  <span className="index-tab-sym">{activeBm.shau.symbol}</span>
                </div>
                <span className={`index-tab-status ${clockInfo.sessions.sge.status.toLowerCase()}`}>
                  {clockInfo.sessions.sge.statusLabel}
                </span>
              </div>
              <div className="index-tab-data-row">
                <span className="index-tab-price">¥{activeBm.shau.price.toFixed(2)}</span>
                <span className={`index-tab-chg ${chgCls(activeBm.shau.chgClass)}`}>{activeBm.shau.chg}</span>
              </div>
            </button>

            {/* 4. 实时内外盘溢价 (SGE-London) */}
            <button
              type="button"
              className={`index-tab-button premium ${activeTabKey === 'premium' ? 'active' : ''}`}
              onClick={() => setActiveTabKey('premium')}
            >
              <div className="index-tab-head-row">
                <div className="index-tab-name-box">
                  <span className="index-tab-name">内外盘溢价</span>
                  <span className="index-tab-sym">SGE-LONDON</span>
                </div>
                <span className={`premium-zone-tag ${premZoneClass}`}>
                  {livePrem.zoneLabel}
                </span>
              </div>
              <div className="index-tab-data-row">
                <span className="index-tab-price">
                  {livePrem.spreadUsd >= 0 ? '+' : ''}${livePrem.spreadUsd.toFixed(2)}/oz
                </span>
                <span className={`index-tab-chg ${livePrem.spreadUsd >= 0 ? 'up' : 'down'}`}>
                  {livePrem.premiumRate}
                </span>
              </div>
            </button>
          </div>

          {/* C. 图表展示区 */}
          <div className="terminal-chart-viewport" style={{ padding: '12px 14px 16px' }}>
            {chartMode === 'overlay' ? (
              <>
                <div className="terminal-chart-caption-bar" style={{ padding: '0 4px 8px' }}>
                  <div className="terminal-chart-title">
                    <span className="terminal-chart-indicator" style={{ background: GOLD }} />
                    <span>跨市场比价叠加走势（伦敦金 vs 汇率折算沪金 vs 美债实际利率 vs 美元指数 · 基准点 100）</span>
                  </div>
                </div>
                <ReactECharts key="overlay-chart" option={overlayOpt} style={{ height: 380, width: '100%' }} notMerge />
                <div className="terminal-chart-stats" style={{ marginTop: 8 }}>
                  <div className="stat-item">
                    <span className="stat-label">阶段起点:</span>
                    <span className="stat-val">{normData?.dates[0] ?? '--'} (0%)</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">内外盘溢价:</span>
                    <span className="stat-val" style={{ color: livePrem.spreadUsd >= 0 ? 'var(--up)' : 'var(--down)' }}>
                      {livePrem.spreadUsd >= 0 ? '+' : ''}${livePrem.spreadUsd.toFixed(2)}/oz
                    </span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">历史分位:</span>
                    <span className="stat-val" style={{ color: 'var(--amber)' }}>
                      {livePrem.percentile}% 分位
                    </span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">中性死区:</span>
                    <span className="stat-val" style={{ color: 'var(--text-faint)' }}>
                      [{livePrem.deadband[0]}, +{livePrem.deadband[1]}] $/oz
                    </span>
                  </div>
                </div>
              </>
            ) : activeTabKey === 'premium' ? (
              <>
                <div className="kline-head" style={{ padding: '0 4px 10px' }}>
                  <div className="chart-title">
                    {rangeLabel} · 内外盘溢价历史利差走势（SGE vs London · $/oz 与 溢价率）
                  </div>
                  <div className="kline-tabs">
                    {([['5d', '5日K'], ['30d', '30日K'], ['90d', '90日K']] as const).map(([k, lbl]) => (
                      <button
                        key={k}
                        type="button"
                        className={range === k ? 'active' : ''}
                        onClick={() => setRange(k)}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="legend" style={{ margin: '0 4px 6px' }}>
                  <span><i style={{ background: 'rgba(255,107,107,0.85)' }} />境内溢价 (&gt;+$8/oz HOT)</span>
                  <span><i style={{ background: 'rgba(245,197,66,0.65)' }} />死区震荡 ([-$5, +$8])</span>
                  <span><i style={{ background: 'rgba(74,222,128,0.85)' }} />境外溢价 (&lt;-$5/oz COLD)</span>
                  <span><i style={{ background: CYAN }} />溢价率 (%)</span>
                </div>
                <ReactECharts key={`premium-${range}`} option={premiumOpt} style={{ height: 380, width: '100%' }} notMerge />
                <div className="terminal-chart-stats" style={{ marginTop: 8 }}>
                  <div className="stat-item">
                    <span className="stat-label">实时溢价:</span>
                    <span className="stat-val" style={{ color: livePrem.spreadUsd >= 0 ? 'var(--up)' : 'var(--down)' }}>
                      {livePrem.spreadUsd >= 0 ? '+' : ''}${livePrem.spreadUsd.toFixed(2)}/oz ({livePrem.premiumRate})
                    </span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">人民币折价:</span>
                    <span className="stat-val" style={{ color: 'var(--amber)' }}>
                      {livePrem.spreadRmb >= 0 ? '+' : ''}¥{livePrem.spreadRmb.toFixed(2)}/克
                    </span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">当前状态:</span>
                    <span className={`stat-val ${livePrem.spreadUsd >= 8 ? 'up' : 'neutral'}`}>
                      {livePrem.zoneLabel}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="kline-head" style={{ padding: '0 4px 10px' }}>
                  <div className="chart-title">
                    {rangeLabel} · {currentInst.name}日K（{currentInst.symbol} · {currentInst.unitLabel}）· 成交量（手）
                  </div>
                  <div className="kline-tabs">
                    {([['5d', '5日K'], ['30d', '30日K'], ['90d', '90日K']] as const).map(([k, lbl]) => (
                      <button
                        key={k}
                        type="button"
                        className={range === k ? 'active' : ''}
                        onClick={() => setRange(k)}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="legend" style={{ margin: '0 4px 6px' }}>
                  <span><i style={{ background: UP }} />阳线（涨）</span>
                  <span><i style={{ background: DOWN }} />阴线（跌）</span>
                  <span><i style={{ background: AMBER }} />MA20（月线/波段）</span>
                  <span><i style={{ background: CYAN }} />MA60（季线/生命线）</span>
                  <span><i style={{ background: 'rgba(245,197,66,0.5)' }} />支撑带 ({currentInst.support[0]}-{currentInst.support[1]})</span>
                  <span><i style={{ background: 'rgba(255,107,107,0.5)' }} />压力带 ({currentInst.resistance[0]}-{currentInst.resistance[1]})</span>
                </div>
                <ReactECharts key={`kline-${activeTabKey}-${range}`} option={klineOpt} style={{ height: 380, width: '100%' }} notMerge />
              </>
            )}
          </div>
        </section>

        {/* 趋势生命线与跟踪防守体系条 */}
        <div className="card trend-lifeline-strip">
          <div className="trend-badge-group">
            <span className="trend-badge-lbl">趋势定性</span>
            <span className="trend-status-tag correction">多头高位宽幅蓄势</span>
          </div>
          <div className="trend-points">
            <span className="tp-item">
              波段强弱线 (MA20) <b>{currentMA20} {currentInst.unit}</b>
              <small>反弹强压/收复确立</small>
            </span>
            <span className="tp-item">
              季线生命线 (MA60) <b>{currentMA60} {currentInst.unit}</b>
              <small>中长线牛熊分界</small>
            </span>
            <span className="tp-item" style={{ borderLeft: '2px solid rgba(255,255,255,0.6)' }}>
              周线大白线 <b>{((positioning as unknown as { macroLifeline?: { level?: number } }).macroLifeline?.level ?? 4145)} {currentInst.unit}</b>
              <small>1W宏观趋势生命线</small>
            </span>
            <span className="tp-item tp-stop">
              结构破位底线 <b>{currentInst.support[0]} {currentInst.unit}</b>
              <em>跌破则波段失效·严格止损</em>
            </span>
            <span className="tp-item tp-entry">
              右侧突破确认 <b>{currentInst.resistance[0]} {currentInst.unit}</b>
              <small>放量站稳重新开启主升</small>
            </span>
          </div>
        </div>

        {/* 技术走势判定与依据 */}
        <div className="tech-grid">
          <div className="t-item t-full"><b>走势判定</b><span>{tech.trend}</span></div>
          <div className="t-item"><b>支撑带依据</b><span>{tech.supportDesc}</span></div>
          <div className="t-item"><b>压力带依据</b><span>{tech.resistanceDesc}</span></div>
        </div>

        {/* ==================== 3. 系统性量化资金持仓与微观流动性吸收矩阵 ==================== */}
        <h2 className="sec-title">{positioning.secTitle}</h2>
        <div className="systematic-pos-viewport">
          <div className="systematic-grid">
            {/* 卡片 1: CTA 趋势追踪资金与抛压枯竭雷达 (全宽单行 · ECharts 极值仪表盘) */}
            {((positioning as unknown as { ctaMonitor?: Record<string, unknown> }).ctaMonitor) && (
              <div className="sys-card highlight-cta">
                <div className="sys-head">
                  <div className="sys-title-box">
                    <span className="sys-dot" />
                    <span className="sys-title">{(positioning as unknown as { ctaMonitor: { title: string } }).ctaMonitor.title}</span>
                  </div>
                  <span className="sys-badge near-max">{(positioning as unknown as { ctaMonitor: { statusLabel: string } }).ctaMonitor.statusLabel}</span>
                </div>
                <div className="sys-card-row-layout">
                  {/* 左侧：指标大数与价格冲击 */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div className="sys-stat-row">
                      <span className="stat-large" style={{ whiteSpace: 'nowrap' }}>{(positioning as unknown as { ctaMonitor: { nominalSelling30dOz: string } }).ctaMonitor.nominalSelling30dOz}</span>
                      <span className="stat-sub">30日名义抛压 (~{(positioning as unknown as { ctaMonitor: { nominalSelling30dTons: number } }).ctaMonitor.nominalSelling30dTons} 吨)</span>
                      <span className="stat-tag">已耗尽 {(positioning as unknown as { ctaMonitor: { shortCapacityUsedPct: number } }).ctaMonitor.shortCapacityUsedPct}%</span>
                    </div>
                    <div className="price-impact-box">
                      <span className="pi-title">{(positioning as unknown as { ctaMonitor: { priceImpactTitle: string } }).ctaMonitor.priceImpactTitle}</span>
                      <span className="pi-desc">{(positioning as unknown as { ctaMonitor: { priceImpactDesc: string } }).ctaMonitor.priceImpactDesc}</span>
                    </div>
                  </div>
                  {/* 右侧：ECharts 极值量规仪与窗口推演 */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ height: 140, width: '100%', margin: '-8px 0 0' }}>
                      <ReactECharts key="cta-gauge" option={ctaGaugeOpt} style={{ height: 140, width: '100%' }} notMerge />
                    </div>
                    <div className="gauge-hint mono" style={{ textAlign: 'center', marginTop: -4 }}>
                      {(positioning as unknown as { ctaMonitor: { maxShortCapWindow: string } }).ctaMonitor.maxShortCapWindow}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 卡片 2: 微观流动性承接矩阵 (全宽单行 · ECharts 横向渠道分解图) */}
            {((positioning as unknown as { absorptionMatrix?: Record<string, unknown> }).absorptionMatrix) && (
              <div className="sys-card highlight-absorption">
                <div className="sys-head">
                  <div className="sys-title-box">
                    <span className="sys-dot cyan-pulse" />
                    <span className="sys-title">{(positioning as unknown as { absorptionMatrix: { title: string } }).absorptionMatrix.title}</span>
                  </div>
                  <span className="sys-badge absorbed">
                    已承接 {(positioning as unknown as { absorptionMatrix: { absorbedTons: number; absorbedPct: number } }).absorptionMatrix.absorbedTons} 吨 ({(positioning as unknown as { absorptionMatrix: { absorbedPct: number } }).absorptionMatrix.absorbedPct}%)
                  </span>
                </div>
                <div className="sys-card-row-layout">
                  {/* 左侧：核心吸收规模与机制评语 */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div className="sys-stat-row">
                      <span className="stat-large" style={{ whiteSpace: 'nowrap' }}>{(positioning as unknown as { absorptionMatrix: { absorbedTons: number } }).absorptionMatrix.absorbedTons} 吨</span>
                      <span className="stat-sub">深层吸收 / 总流出 {(positioning as unknown as { absorptionMatrix: { totalOutflowTons: number } }).absorptionMatrix.totalOutflowTons} 吨</span>
                    </div>
                    <div className="price-impact-box" style={{ borderColor: 'rgba(56, 189, 248, 0.25)', background: 'rgba(56, 189, 248, 0.05)' }}>
                      <span className="pi-title" style={{ color: 'var(--cyan)' }}>吸收机制评语</span>
                      <span className="pi-desc">{(positioning as unknown as { absorptionMatrix: { summary: string } }).absorptionMatrix.summary}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontFamily: MONO, color: 'var(--text-faint)', padding: '0 2px' }}>
                      <span>EFP期转现 42.5t (55.2%)</span>
                      <span>内外盘套利 21.0t (27.3%)</span>
                      <span>自主/主权 13.5t (17.5%)</span>
                    </div>
                  </div>
                  {/* 右侧：ECharts 横向多渠道对比条形图 */}
                  <div style={{ height: 140, width: '100%' }}>
                    <ReactECharts key="absorption-bar" option={absorptionOpt} style={{ height: 140, width: '100%' }} notMerge />
                  </div>
                </div>
              </div>
            )}

            {/* 卡片 3: 周线大级别上升趋势线 (全宽单行 · 白线生命线三列全景轨道) */}
            {((positioning as unknown as { macroLifeline?: Record<string, unknown> }).macroLifeline) && (
              <div className="sys-card highlight-lifeline">
                <div className="sys-head">
                  <div className="sys-title-box">
                    <span className="sys-dot white-pulse" />
                    <span className="sys-title">{(positioning as unknown as { macroLifeline: { title: string } }).macroLifeline.title}</span>
                  </div>
                  <span className="sys-badge lifeline-test">{(positioning as unknown as { macroLifeline: { statusLabel: string } }).macroLifeline.statusLabel}</span>
                </div>
                <div className="sys-card-trio-layout">
                  {/* 列 1: 标称位与周期状态 */}
                  <div className="lifeline-hero-box" style={{ height: '100%' }}>
                    <div>
                      <div className="lh-val">${((positioning as unknown as { macroLifeline: { level: number } }).macroLifeline.level).toFixed(1)}</div>
                      <div className="lh-range mono">缓冲死区: ${((positioning as unknown as { macroLifeline: { level: number; buffer: number } }).macroLifeline.level - (positioning as unknown as { macroLifeline: { buffer: number } }).macroLifeline.buffer)} ~ ${((positioning as unknown as { macroLifeline: { level: number; buffer: number } }).macroLifeline.level + (positioning as unknown as { macroLifeline: { buffer: number } }).macroLifeline.buffer)}</div>
                    </div>
                    <div className="stat-sub mono" style={{ textAlign: 'right' }}>
                      周期: {(positioning as unknown as { macroLifeline: { timeframe: string } }).macroLifeline.timeframe}<br />
                      状态: <b>测试有效性</b>
                    </div>
                  </div>

                  {/* 列 2: 图形化多空防守距离轨道 */}
                  <div style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 2,
                    padding: '10px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: MONO, fontSize: 10, color: 'var(--text-faint)' }}>
                      <span style={{ color: '#FF6B6B' }}>失效红线 $4,130</span>
                      <span style={{ color: '#FFFFFF', fontWeight: 'bold' }}>白线支撑 $4,145</span>
                      <span style={{ color: 'var(--amber)' }}>反弹目标 $4,250+</span>
                    </div>
                    <div style={{ height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, position: 'relative' }}>
                      <div style={{
                        position: 'absolute',
                        left: '8%',
                        width: '28%',
                        height: '100%',
                        background: 'rgba(255, 255, 255, 0.35)',
                        borderRadius: 3
                      }} />
                      <div style={{
                        position: 'absolute',
                        left: `${Math.min(95, Math.max(5, ((currentGoldPrice - 4130) / (4250 - 4130)) * 100))}%`,
                        width: 8,
                        height: 8,
                        top: -1,
                        borderRadius: '50%',
                        background: '#FFD700',
                        boxShadow: '0 0 6px #FFD700'
                      }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, fontFamily: MONO }}>
                      <span style={{ color: 'var(--text-dim)' }}>现价 ${currentGoldPrice.toFixed(1)} 处于死区</span>
                      <span style={{ color: 'var(--amber)' }}>防守空间 -${(currentGoldPrice - 4130).toFixed(1)}</span>
                    </div>
                  </div>

                  {/* 列 3: 确定性风控与凸性规则 */}
                  <div className="lifeline-rules" style={{ justifyContent: 'center' }}>
                    <div className="rule-stop">
                      <b>◆ 结构失效底线：</b>{(positioning as unknown as { macroLifeline: { invalidationRule: string } }).macroLifeline.invalidationRule}
                    </div>
                    <div className="rule-upside">
                      <b>◆ 向上非对称弹性：</b>{(positioning as unknown as { macroLifeline: { upsideConvexity: string } }).macroLifeline.upsideConvexity}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 紧凑期现基差与交割库存表 (保持高频自动化对接) */}
          <div className="card pos-table" style={{ width: '100%', margin: '0' }}>
            <div className="legend"><span>{positioning.tableTitle}</span></div>
            {positioning.table.map((row, i) => (
              <div className="pos-row" key={i}>
                <span className="k">{row.k}</span>
                <span className="v">{row.v}</span>
                <span className={`wk ${row.dir}`}>
                  <i className={`arrow ${row.dir}`} aria-hidden="true" />
                  {row.wk}
                </span>
                <span className="g-src">{row.src}</span>
              </div>
            ))}
          </div>
          <div className="pos-note">{positioning.note}</div>
        </div>

        {/* 宏观驱动因子：多空信号标签 */}
        <h2 className="sec-title">{macro.secTitle}</h2>
        <div className="card grow">
          {macro.items.map((it, i) => (
            <div className="grow-row" key={i}>
              <span className="k">{it.k}</span>
              {it.signal && <span className={`sig-tag ${it.signal}`}>{it.signalText}</span>}
              {it.dim && <span className="dim">{dimOf(it.dim)}</span>}
              {macroQuoteText('quote' in it ? it.quote : undefined) && (
                <span className="qnum">{macroQuoteText('quote' in it ? it.quote : undefined)}</span>
              )}
              <span className="v">{it.v}</span>
              <span className="g-src">{it.src}</span>
            </div>
          ))}
        </div>

        {/* ==================== 4. 东西方需求侧双轨监测看板 (Demand Dynamics) ==================== */}
        <h2 className="sec-title">ETF 与实物需求 · 东西方双轨监测</h2>
        <div className="demand-matrix-grid">
          {/* 西方机构流动需求 (SPDR GLD) */}
          <div className="demand-card">
            <div className="demand-head">
              <span className="d-title">{demandDynamics?.westernEtf?.name ?? etf.spdrTitle}</span>
              <span className="d-role">{demandDynamics?.westernEtf?.role ?? '欧美机构与杠杆资金风向标'}</span>
            </div>
            <div className="demand-main-stat">
              <span className="stat-num">{demandDynamics?.westernEtf?.holdingsTons ?? 875.4}</span>
              <span className="stat-unit">吨 持仓</span>
              <span className={`stat-chg ${(demandDynamics?.westernEtf?.dailyChgTons ?? -1.45) >= 0 ? 'up' : 'down'}`}>
                {(demandDynamics?.westernEtf?.dailyChgTons ?? -1.45) >= 0 ? '+' : ''}{demandDynamics?.westernEtf?.dailyChgTons ?? -1.45} 吨/日
              </span>
            </div>
            <p className="demand-desc">
              海外最大黄金信托 SPDR (GLD) 反映纽约与伦敦离岸资管机构的配置与赎回力度，是观测西方纸黄金与机构避险的核心窗口。
            </p>
            <div className="demand-src">State Street Global Advisors · 近15日净变动序列见下方柱状图</div>
          </div>

          {/* 东方实物与场内配置 (国内华安 518880) */}
          <div className="demand-card">
            <div className="demand-head">
              <span className="d-title">{demandDynamics?.easternEtf?.name ?? '国内华安黄金 ETF (518880)'}</span>
              <span className="d-role">{demandDynamics?.easternEtf?.role ?? '东方场内无杠杆资产配置资金'}</span>
            </div>
            <div className="demand-main-stat">
              <span className="stat-num">{demandDynamics?.easternEtf?.holdingsTons ?? 52.8}</span>
              <span className="stat-unit">吨 持仓</span>
              <span className={`stat-chg ${(demandDynamics?.easternEtf?.dailyChgTons ?? 0.35) >= 0 ? 'up' : 'down'}`}>
                +0.35 吨/日
              </span>
            </div>
            <p className="demand-desc">
              中国境内规模最大的场内黄金现货 ETF，紧密跟踪上海金现货（Au99.99），直接反映国内公募基金与居民财富的实体资产配置需求。
            </p>
            <div className="demand-src">上海证券交易所 · 每日盘后申赎份额折算吨数</div>
          </div>

          {/* 慢变量底仓锚 1: 中国央行官方储备 */}
          <div className="demand-card">
            <div className="demand-head">
              <span className="d-title">中国央行官方黄金储备 (PBOC)</span>
              <span className="d-role">月度中枢锚</span>
            </div>
            <div className="demand-main-stat">
              <span className="stat-num">7,280</span>
              <span className="stat-unit">万盎司 (~2,264 吨)</span>
              <span className="stat-chg" style={{ color: 'var(--amber)' }}>稳固底仓</span>
            </div>
            <p className="demand-desc">
              主权外汇储备多元化与去美元化进程的核心定海神针。尽管单月增持节奏受金价高位影响阶段性放缓，但长期储备占比仍具提升空间，封死深度下行边界。
            </p>
            <div className="demand-src">中国国家外汇管理局 · 官方储备资产表（每月7日更新）</div>
          </div>

          {/* 慢变量底仓锚 2: SGE 上海黄金交易所出库量 */}
          <div className="demand-card">
            <div className="demand-head">
              <span className="d-title">上海黄金交易所 (SGE) 黄金出库量</span>
              <span className="d-role">月度实物交割</span>
            </div>
            <div className="demand-main-stat">
              <span className="stat-num">142.3</span>
              <span className="stat-unit">吨 / 月</span>
              <span className="stat-chg" style={{ color: 'var(--amber)' }}>72% 历史高位</span>
            </div>
            <p className="demand-desc">
              经由 SGE 金库交付给国内商业银行、金币公司与加工厂商的真实物理提货吨数，是检验全球最大实物消费国“真实实物饥渴度”的最高频官方指标。
            </p>
            <div className="demand-src">上海黄金交易所月度运行报告 · 世界黄金协会引用</div>
          </div>
        </div>



        {/* 宏观非对称赔率与趋势防守纪律 */}
        <h2 className="sec-title">宏观非对称赔率与趋势防守纪律</h2>
        <div className="sent-grid">
          <div className="card sent-card">
            <div className="sent-h">宏观非对称赔率与目标空间 (Macro Convexity)</div>
            <div className="rr-metrics">
              <div className="rr-cell">
                <b style={{ color: 'var(--up)' }}>-$10~50</b>
                <span>下行防守空间<br />现价 {currentGoldPrice.toFixed(1)} → 白线底线 4,130 (-0.25%)</span>
              </div>
              <div className="rr-cell">
                <b style={{ color: 'var(--amber)' }}>+$350~1300</b>
                <span>上行宏观目标<br />空头回补重测 4,500 ~ 5,444+</span>
              </div>
              <div className="rr-cell rr-ratio">
                <b>1 : 10+</b>
                <span>凸性赔率比<br />潜在上行 ÷ 白线防守回撤</span>
              </div>
            </div>
            <p className="sent-hint">
              宏观趋势投资核心在于“大级别非对称赔率”。CTA 抛压已近极限（下周料达最大空仓），且 77 吨被 EFP/现货微观结构深层吸收。依托周线白线趋势线（4,130~4,145）防守空间极小，一旦企稳，向上空头回补弹性极高。
            </p>
            <div className="src">MarketTracker 宏观期权模型 · 彭博终端大宗商品估值体系</div>
          </div>
          <div className="card sent-card">
            <div className="sent-h">趋势生命线与跟踪止损原则 (Trailing Stop Discipline)</div>
            <div className="rr-metrics">
              <div className="rr-cell">
                <b style={{ color: '#FFFFFF' }}>白线 4,145</b>
                <span>周线大趋势线<br />1W 通道下轨 (容差 ±15)</span>
              </div>
              <div className="rr-cell">
                <b style={{ color: 'var(--amber)' }}>MA20</b>
                <span>短期波段压制<br />收复 $4,258 视为修正结束</span>
              </div>
              <div className="rr-cell">
                <b style={{ color: 'var(--up)' }}>4,130</b>
                <span>关键失效底线<br />周K实体跌破白线触发止损</span>
              </div>
            </div>
            <p className="sent-hint">
              趋势交易纪律：截断亏损，让利润奔跑。只要未收盘有效跌破周线白线（4,130）关键结构底线，不因短期量化假摔交出核心筹码；若右侧放量突破 4,220 并收复 MA20，顺势加仓顺应大级别主升。
            </p>
            <div className="src">趋势跟踪纪律体系 · 华尔街宏观对冲基金风控标准</div>
          </div>
        </div>

        {/* 当前行动准则（Action Plan）与次日推演警戒 */}
        <h2 className="sec-title">{action.secTitle}</h2>
        <div className="card verdict">
          <div className="v-main">{action.summary}</div>
        </div>
        <div className="plan-grid">
          {action.plans.map((p, i) => (
            <div className="card plan-card" key={i}>
              <div className="plan-h">
                <span>{p.who}</span>
                <em className={p.stance.includes('等待') || p.stance.includes('按兵不动') || p.stance.includes('防守') ? 'wait' : 'probe'}>{p.stance}</em>
              </div>
              <p>{p.action}</p>
            </div>
          ))}
        </div>

        {/* 次日推演与关键阈值警戒 (Next-Day Watch) */}
        {nextDayWatch && nextDayWatch.length > 0 && (
          <>
            <h3 className="sec-title" style={{ marginTop: 20, fontSize: 13 }}>次日推演与触发警戒（Next-Day Watch）</h3>
            <div className="gold-watch-grid">
              {nextDayWatch.map((w, i) => (
                <div className={`gold-watch-card ${(w.priority || 'medium').toLowerCase()}`} key={i}>
                  <div className="watch-head">
                    <span className="target">{w.target}</span>
                    <span className={`priority-tag ${(w.priority || 'medium').toLowerCase()}`}>
                      {w.priority}
                    </span>
                  </div>
                  <div className="watch-threshold">{w.threshold}</div>
                  <p className="watch-logic">{w.logic}</p>
                </div>
              ))}
            </div>
          </>
        )}

        <footer className="src">{footer}</footer>
      </div>
    </article>
  );
}
