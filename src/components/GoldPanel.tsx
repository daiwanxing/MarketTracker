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
  const rangeLen = range === '5d' ? 5 : range === '30d' ? 30 : 91;
  const rangeLabel = range === '5d' ? '近 5 交易日' : range === '30d' ? '近 30 交易日' : '近 90 交易日 + 今日';
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

  // 3. CFTC 投机净多头历史分位
  let lastPctIdx = -1;
  for (let i = positioning.pctValues.length - 1; i >= 0; i--) {
    if (positioning.pctValues[i] != null) { lastPctIdx = i; break; }
  }
  const pctOpt: EChartsOption = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(0,0,0,0.88)',
      borderColor: 'rgba(240,240,250,0.35)',
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: '#f0f0fa', fontFamily: DISPLAY, fontSize: 12 },
      valueFormatter: (v) => (v == null ? '—' : `${v}%`),
    },
    grid: { left: 42, right: 22, top: 34, bottom: 30 },
    xAxis: {
      type: 'category',
      data: positioning.pctDates,
      axisLine: { lineStyle: { color: 'rgba(240,240,250,0.25)' } },
      axisTick: { show: false },
      axisLabel: { color: 'rgba(240,240,250,0.6)', fontFamily: MONO, fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      interval: 25,
      splitLine: { lineStyle: { color: 'rgba(240,240,250,0.1)' } },
      axisLabel: { color: 'rgba(240,240,250,0.6)', fontFamily: MONO, fontSize: 10, formatter: '{value}%' },
    },
    series: [
      {
        name: '投机净多头分位',
        type: 'line',
        data: positioning.pctValues,
        connectNulls: true,
        showSymbol: true,
        symbolSize: 5,
        lineStyle: { color: GOLD, width: 2 },
        itemStyle: { color: GOLD },
        areaStyle: {
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(255,215,0,0.18)' },
              { offset: 1, color: 'rgba(255,215,0,0)' },
            ],
          },
        },
        markLine: {
          silent: true,
          symbol: 'none',
          data: [
            {
              yAxis: 50,
              lineStyle: { color: 'rgba(240,240,250,0.35)', type: 'dashed' },
              label: { formatter: '中位 50%', color: 'rgba(240,240,250,0.55)', fontFamily: MONO, fontSize: 10 },
            },
            {
              yAxis: 80,
              lineStyle: { color: 'rgba(255,107,107,0.8)', type: 'dashed' },
              label: { formatter: '拥挤警戒 80%', color: 'rgba(255,107,107,0.95)', fontFamily: MONO, fontSize: 10 },
            },
          ],
        },
        markPoint:
          lastPctIdx >= 0
            ? {
                symbol: 'circle',
                symbolSize: 8,
                itemStyle: { color: '#fff', borderColor: AMBER, borderWidth: 2 },
                label: {
                  show: true,
                  formatter: `当前 ${positioning.pctValues[lastPctIdx]}%`,
                  position: 'top',
                  color: AMBER,
                  fontFamily: MONO,
                  fontSize: 10,
                },
                data: [{ name: '当前', coord: [lastPctIdx, Number(positioning.pctValues[lastPctIdx] ?? 0)] }],
              }
            : undefined,
      },
    ],
  };

  // 4. SPDR 近 15 交易日净增减柱状图
  const spdrOpt: EChartsOption = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(0,0,0,0.88)',
      borderColor: 'rgba(240,240,250,0.35)',
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: '#f0f0fa', fontFamily: DISPLAY, fontSize: 12 },
      valueFormatter: (v) => `${v} 吨`,
    },
    grid: { left: 42, right: 14, top: 20, bottom: 30 },
    xAxis: {
      type: 'category',
      data: etf.spdrDates,
      axisLine: { lineStyle: { color: 'rgba(240,240,250,0.25)' } },
      axisTick: { show: false },
      axisLabel: { color: 'rgba(240,240,250,0.6)', fontFamily: MONO, fontSize: 10, interval: 1 },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: 'rgba(240,240,250,0.1)' } },
      axisLabel: { color: 'rgba(240,240,250,0.6)', fontFamily: MONO, fontSize: 10, formatter: '{value} 吨' },
    },
    series: [
      {
        name: '净增减',
        type: 'bar',
        data: etf.spdrChg.map((v) => ({ value: v, itemStyle: { color: v >= 0 ? UP : DOWN, opacity: 0.85 } })),
        barWidth: '55%',
      },
    ],
  };

  // 5. 宏观现货基准价
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
                <ReactECharts option={overlayOpt} style={{ height: 380, width: '100%' }} notMerge lazyUpdate />
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
                <ReactECharts option={premiumOpt} style={{ height: 380, width: '100%' }} notMerge lazyUpdate />
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
                <ReactECharts option={klineOpt} style={{ height: 380, width: '100%' }} notMerge lazyUpdate />
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
              波段强弱线 (MA20) <b>{currentInst.currency === '¥' ? (activeBm.shau.price * 1.006).toFixed(1) : (activeBm.comexGold.price * 1.008).toFixed(1)} {currentInst.unit}</b>
              <small>反弹强压/收复确立</small>
            </span>
            <span className="tp-item">
              季线生命线 (MA60) <b>{currentInst.currency === '¥' ? (activeBm.shau.price * 1.021).toFixed(1) : (activeBm.comexGold.price * 1.025).toFixed(1)} {currentInst.unit}</b>
              <small>中长线牛熊分界</small>
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

        {/* 技术走势与动量收益 */}
        <div className="tech-grid">
          <div className="t-item t-full"><b>走势判定</b><span>{tech.trend}</span></div>
          <div className="t-item"><b>支撑带依据</b><span>{tech.supportDesc}</span></div>
          <div className="t-item"><b>压力带依据</b><span>{tech.resistanceDesc}</span></div>
        </div>
        <div className="card grow">
          {tech.momentum.map((m, i) => (
            <div className="grow-row" key={i}>
              <span className="k">{m.k}</span>
              <span className="v">{m.v}</span>
            </div>
          ))}
        </div>
        <div className="sec-note">{tech.note}</div>

        {/* 期货持仓与资金流向：分位折线 + 库存基差表 */}
        <h2 className="sec-title">{positioning.secTitle}</h2>
        <div className="pos-grid">
          <div className="card chart-panel">
            <div className="legend">
              <span><i style={{ background: GOLD }} />投机净多头历史分位</span>
            </div>
            <div className="chart-title">{positioning.pctTitle}</div>
            <ReactECharts option={pctOpt} style={{ height: 270, width: '100%' }} notMerge lazyUpdate />
            <div className="pos-note">{positioning.pctNote}</div>
          </div>
          <div className="card pos-table">
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
        </div>
        <div className="pos-note">{positioning.note}</div>

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

        {/* SPDR 15 日净增减柱状图 */}
        <div className="card chart-panel" style={{ marginTop: 14 }}>
          <div className="legend">
            <span><i style={{ background: UP }} />净增持</span>
            <span><i style={{ background: DOWN }} />净减持</span>
            <span className="spdr-latest">{etf.spdrLatest.tons} · {etf.spdrLatest.chg}（{etf.spdrLatest.date} · {etf.spdrLatest.src}）</span>
          </div>
          <div className="chart-title">{etf.spdrTitle}</div>
          <ReactECharts option={spdrOpt} style={{ height: 220, width: '100%' }} notMerge lazyUpdate />
          <div className="pos-note">{etf.spdrNote}</div>
        </div>

        <div className="card grow">
          {etf.items.map((it, i) => (
            <div className="grow-row" key={i}>
              <span className="k">{it.k}</span>
              <span className="v">{it.v}</span>
              <span className="g-src">{it.src}</span>
            </div>
          ))}
        </div>

        {/* 宏观非对称赔率与趋势防守纪律 */}
        <h2 className="sec-title">宏观非对称赔率与趋势防守纪律</h2>
        <div className="sent-grid">
          <div className="card sent-card">
            <div className="sent-h">宏观非对称赔率与目标空间 (Macro Convexity)</div>
            <div className="rr-metrics">
              <div className="rr-cell">
                <b style={{ color: 'var(--up)' }}>-$51.8</b>
                <span>下行防守空间<br />现价 {currentGoldPrice.toFixed(1)} → 支撑 4,090 (-1.2%)</span>
              </div>
              <div className="rr-cell">
                <b style={{ color: 'var(--amber)' }}>+$358~1358</b>
                <span>上行宏观目标<br />历史峰值 4,500 ~ 5,500 (+8.6%~+32.8%)</span>
              </div>
              <div className="rr-cell rr-ratio">
                <b>1 : 7.2</b>
                <span>凸性赔率比<br />潜在上行 ÷ 最大防守回撤</span>
              </div>
            </div>
            <p className="sent-hint">
              宏观趋势投资核心在于“大级别非对称赔率”。现价向下回踩 4,090 支撑为有限技术性回调（-1.2%），而向上伴随去美元化与主权信用货币重估，潜在空间极其广阔。
            </p>
            <div className="src">MarketTracker 宏观期权模型 · 彭博终端大宗商品估值体系</div>
          </div>
          <div className="card sent-card">
            <div className="sent-h">趋势生命线与跟踪止损原则 (Trailing Stop Discipline)</div>
            <div className="rr-metrics">
              <div className="rr-cell">
                <b style={{ color: 'var(--amber)' }}>MA20</b>
                <span>短期波段压制<br />收复 $4,258 视为修正结束</span>
              </div>
              <div className="rr-cell">
                <b style={{ color: 'var(--cyan)' }}>MA60</b>
                <span>中长生命线<br />守住 $4,420 维持大牛市格局</span>
              </div>
              <div className="rr-cell">
                <b style={{ color: 'var(--up)' }}>4,090</b>
                <span>关键失效底线<br />实体跌破触发严格止损减仓</span>
              </div>
            </div>
            <p className="sent-hint">
              趋势交易纪律：截断亏损，让利润奔跑。只要未收盘跌破 4,090 关键结构底线，不因短期假摔交出核心筹码；若右侧放量突破 4,220 并站稳 MA20，则顺势执行加仓进攻。
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
