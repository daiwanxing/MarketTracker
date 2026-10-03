import { useState, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { ArrowUpRight } from 'lucide-react';
import { clamp, max, min, orderBy } from 'lodash-es';
import { useInterval } from 'ahooks';
import heroRobot from '../assets/hero-robot.jpg';
import robotData from '../data/robotData.json';
import { useReveal } from '../hooks/useReveal';
import { useLiveQuotes } from '../hooks/useLiveQuotes';
import { getBeijingTime, isUSDaylightSaving, getStar50Status, getSoxStatus } from '../utils/marketClock';

const MONO = "ui-monospace, 'SF Mono', Consolas, monospace";
const DISPLAY = "'Barlow Condensed', 'Arial Narrow', Arial, sans-serif";

const UP = '#FF6B6B';
const DOWN = '#4ADE80';
const AMBER = '#F5C542';
const CYAN = '#38bdf8';

const BENCH_SERIES = [
  { key: 'csRobot', name: '中证机器人 ETF', symbol: '562500.SH', color: '#38bdf8' },
  { key: 'robo', name: 'ROBO 机器人自动化 ETF', symbol: 'ROBO', color: '#f59e0b' },
] as const;

type BenchKey = (typeof BENCH_SERIES)[number]['key'];

interface TechInstrument {
  name: string;
  symbol: string;
  currency: string;
  unit: string;
  support: [number, number];
  resistance: [number, number];
  trend: string;
  trendStatus: string;
  trendStatusLabel: string;
  supportDesc: string;
  resistanceDesc: string;
  stopLoss: string;
  breakoutTarget: string;
  discipline: string;
  candles: Array<{ d: string; o: number; c: number; h: number; l: number }>;
  volume: number[];
}

export default function RobotPanel() {
  const { head, benchmarks, charts, crowding, catalysts, anchor, dimensions, timelineTitle, timelineHint, timeline, footer } = robotData;
  const tech = (robotData as unknown as { tech?: Record<string, TechInstrument> })?.tech;
  const tlRef = useReveal<HTMLDivElement>();
  const { liveQuotes } = useLiveQuotes();
  const robotQuotes = liveQuotes?.robot;

  const [currentTime, setCurrentTime] = useState(() => new Date());
  useInterval(() => {
    setCurrentTime(new Date());
  }, 30000);

  const clockInfo = useMemo(() => {
    const bj = getBeijingTime(currentTime);
    const isDst = isUSDaylightSaving(currentTime);
    return {
      csRobot: getStar50Status(bj),
      robo: getSoxStatus(bj, isDst),
      tsla: getSoxStatus(bj, isDst),
    };
  }, [currentTime]);

  const [activeTab, setActiveTab] = useState<BenchKey>('csRobot');
  const [viewMode, setViewMode] = useState<'trend' | 'spread'>('trend');
  const [range, setRange] = useState<'30d' | '60d' | '125d'>('60d');
  const isOverlay = true;

  const rangeLen = range === '30d' ? 30 : range === '60d' ? 60 : 125;
  const rangeLabel = range === '30d' ? '近 30 交易日' : range === '60d' ? '近 60 交易日' : '近 125 交易日（半年）';

  const currentInst: TechInstrument = useMemo(() => {
    if (tech && tech[activeTab]) {
      return tech[activeTab];
    }
    return tech?.csRobot || {
      name: benchmarks.csRobot.name,
      symbol: benchmarks.csRobot.symbol,
      currency: '¥',
      unit: '元',
      support: [0.885, 0.895],
      resistance: [0.930, 0.945],
      trend: '趋势筑底蓄势',
      trendStatus: 'correction',
      trendStatusLabel: '弱势筑底 · 考验防守',
      supportDesc: '0.885-0.895 历史平台支撑',
      resistanceDesc: '0.930-0.945 均线密集压力',
      stopLoss: '0.885',
      breakoutTarget: '0.930',
      discipline: '量化技术面观察：关注关键支撑防守与右侧放量突破确认',
      candles: [],
      volume: [],
    };
  }, [tech, activeTab, benchmarks.csRobot]);

  const sliceCandles = useMemo(() => (currentInst.candles || []).slice(-rangeLen), [currentInst.candles, rangeLen]);
  const candleDates = useMemo(() => sliceCandles.map((c) => c.d), [sliceCandles]);
  const candleData = useMemo(() => sliceCandles.map((c) => [c.o, c.c, c.l, c.h] as number[]), [sliceCandles]);
  const volData = useMemo(() => {
    const vols = (currentInst.volume || []).slice(-rangeLen);
    return vols.map((v, i) => {
      const c = sliceCandles[i];
      if (!c) return { value: v, itemStyle: { color: UP, opacity: 0.75 } };
      return {
        value: v,
        itemStyle: { color: c.c >= c.o ? UP : DOWN, opacity: 0.75 },
      };
    });
  }, [currentInst.volume, sliceCandles, rangeLen]);

  const fullCloses = useMemo(() => (currentInst.candles || []).map((c) => c.c), [currentInst.candles]);

  const sliceMA20 = useMemo(() => {
    return fullCloses.map((_, i) => {
      if (i < 19) return null;
      let sum = 0;
      for (let j = 0; j < 20; j++) sum += fullCloses[i - j];
      return parseFloat((sum / 20).toFixed(3));
    }).slice(-rangeLen);
  }, [fullCloses, rangeLen]);

  const sliceMA60 = useMemo(() => {
    return fullCloses.map((_, i) => {
      if (i < 59) return null;
      let sum = 0;
      for (let j = 0; j < 60; j++) sum += fullCloses[i - j];
      return parseFloat((sum / 60).toFixed(3));
    }).slice(-rangeLen);
  }, [fullCloses, rangeLen]);

  const currentMA20 = useMemo(() => {
    if (fullCloses.length >= 20) {
      return (fullCloses.slice(-20).reduce((a, b) => a + b, 0) / 20).toFixed(3);
    }
    return (fullCloses[fullCloses.length - 1] ?? 0).toFixed(3);
  }, [fullCloses]);

  const currentMA60 = useMemo(() => {
    if (fullCloses.length >= 60) {
      return (fullCloses.slice(-60).reduce((a, b) => a + b, 0) / 60).toFixed(3);
    }
    return currentMA20;
  }, [fullCloses, currentMA20]);

  const latestPrice = fullCloses.length ? fullCloses[fullCloses.length - 1] : 0;
  const pMA20 = parseFloat(currentMA20) || latestPrice || 1;
  const pMA60 = parseFloat(currentMA60) || latestPrice || 1;
  const biasMA20 = ((latestPrice / pMA20) - 1) * 100;
  const biasMA60 = ((latestPrice / pMA60) - 1) * 100;

  const klineOpt: EChartsOption = useMemo(() => {
    if (!currentInst || candleDates.length === 0) return {};
    const currSym = currentInst.currency || '¥';
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
              + `<b style="color:${color}">收 ${currSym}${c.toFixed(3)}（${pct}）</b>`
              + `<span style="color:rgba(240,240,250,0.65)">　开 ${currSym}${o.toFixed(3)}　高 ${currSym}${h.toFixed(3)}　低 ${currSym}${l.toFixed(3)}</span>`;
          }
          const ma20 = list.find((p) => p.seriesName === 'MA20')?.value;
          const ma60 = list.find((p) => p.seriesName === 'MA60')?.value;
          const maTxt = [
            typeof ma20 === 'number' ? `<span style="color:${AMBER}">MA20: ${currSym}${ma20.toFixed(3)}</span>` : '',
            typeof ma60 === 'number' ? `<span style="color:${CYAN}">MA60: ${currSym}${ma60.toFixed(3)}</span>` : '',
          ].filter(Boolean).join('　');
          const vol = list.find((p) => p.seriesName === '成交量');
          const volTxt = vol && typeof vol.value === 'number' ? `<span style="color:rgba(240,240,250,0.55)">量 ${Number(vol.value).toLocaleString()} 手/份</span>` : '';
          return `${kline}${maTxt ? `<br/>${maTxt}` : ''}<br/>${volTxt}`;
        },
      },
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      grid: [
        { left: 54, right: 18, top: 26, height: '56%' },
        { left: 54, right: 18, top: '72%', height: '16%' },
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
            formatter: (v: number) => `${currSym}${v.toFixed(3)}`,
          },
        },
        {
          type: 'value',
          gridIndex: 1,
          scale: true,
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
                  name: `支撑防守 ${currentInst.support[0]}-${currentInst.support[1]}`,
                  yAxis: currentInst.support[0],
                  itemStyle: { color: 'rgba(245,197,66,0.10)' },
                  label: {
                    show: true,
                    position: 'insideTop',
                    color: AMBER,
                    fontFamily: MONO,
                    fontSize: 9,
                    formatter: `支撑带 ${currentInst.support[0]}-${currentInst.support[1]} ${currSym}`,
                  },
                },
                { yAxis: currentInst.support[1] },
              ],
              [
                {
                  name: `压力颈线 ${currentInst.resistance[0]}-${currentInst.resistance[1]}`,
                  yAxis: currentInst.resistance[0],
                  itemStyle: { color: 'rgba(255,107,107,0.07)' },
                  label: {
                    show: true,
                    position: 'insideTop',
                    color: 'rgba(255,107,107,0.95)',
                    fontFamily: MONO,
                    fontSize: 9,
                    formatter: `压力区 ${currentInst.resistance[0]}-${currentInst.resistance[1]} ${currSym}`,
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
          lineStyle: { color: AMBER, width: 1.6, opacity: 0.95 },
          itemStyle: { color: AMBER },
        },
        {
          name: 'MA60',
          type: 'line',
          data: sliceMA60,
          showSymbol: false,
          lineStyle: { color: CYAN, width: 1.6, opacity: 0.95 },
          itemStyle: { color: CYAN },
        },
      ],
    };
  }, [candleDates, candleData, volData, sliceMA20, sliceMA60, currentInst]);

  const dates = useMemo(() => charts?.normalized?.dates || [], [charts?.normalized?.dates]);
  const norm = useMemo(() => charts?.normalized || { csRobot: [], robo: [] }, [charts?.normalized]);

  const activeColor = BENCH_SERIES.find((s) => s.key === activeTab)?.color ?? '#38bdf8';
  const activeSeriesMeta = BENCH_SERIES.find((s) => s.key === activeTab) ?? BENCH_SERIES[0];

  const normalizedOpt: EChartsOption = useMemo(() => {
    let seriesList;
    if (isOverlay) {
      seriesList = BENCH_SERIES.map((item) => {
        const isCurrent = item.key === activeTab;
        return {
          name: item.name,
          type: 'line' as const,
          data: (norm[item.key] as number[]) || [],
          showSymbol: false,
          z: isCurrent ? 4 : 2,
          lineStyle: {
            color: item.color,
            width: isCurrent ? 2.5 : 1.5,
            opacity: isCurrent ? 1 : 0.45,
          },
          itemStyle: { color: item.color },
        };
      });
    } else {
      seriesList = [
        {
          name: activeSeriesMeta.name,
          type: 'line' as const,
          data: (norm[activeTab] as number[]) || [],
          showSymbol: false,
          lineStyle: { color: activeColor, width: 2.2 },
          itemStyle: { color: activeColor },
          areaStyle: {
            color: {
              type: 'linear' as const,
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `${activeColor}33` },
                { offset: 1, color: `${activeColor}00` },
              ],
            },
          },
        },
      ];
    }

    return {
      backgroundColor: 'transparent',
      animationDuration: 300,
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(0,0,0,0.92)',
        borderColor: 'rgba(240,240,250,0.35)',
        borderWidth: 1,
        textStyle: { color: '#f0f0fa', fontFamily: DISPLAY, fontSize: 12 },
        valueFormatter: (v) => (v == null ? '--' : `${(v as number) >= 0 ? '+' : ''}${v}%`),
      },
      legend: isOverlay
        ? {
            top: 0,
            right: 16,
            itemWidth: 14,
            itemHeight: 3,
            textStyle: { color: 'rgba(240,240,250,0.85)', fontFamily: DISPLAY, fontSize: 11 },
          }
        : { show: false },
      grid: { left: 46, right: 16, top: isOverlay ? 30 : 16, bottom: 24 },
      xAxis: {
        type: 'category',
        data: dates,
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
          formatter: (v: number) => `${v >= 0 ? '+' : ''}${v}%`,
        },
      },
      series: seriesList,
    };
  }, [activeTab, isOverlay, norm, dates, activeColor, activeSeriesMeta]);

  const activeSeriesData = (norm[activeTab] as number[]) || [];
  const statMax = max(activeSeriesData) ?? 0;
  const statMin = min(activeSeriesData) ?? 0;
  const statLatest = activeSeriesData.length ? activeSeriesData[activeSeriesData.length - 1] : 0;
  const csLatest = (norm.csRobot as number[])?.[dates.length - 1] ?? 0;
  const roboLatest = (norm.robo as number[])?.[dates.length - 1] ?? 0;
  const spreadUsChina = roboLatest - csLatest;

  const tabConfigs = [
    {
      key: 'csRobot' as const,
      name: benchmarks.csRobot.name,
      symbol: benchmarks.csRobot.symbol,
      bench: {
        ...benchmarks.csRobot,
        price: robotQuotes?.csRobot?.price ?? benchmarks.csRobot.price,
        chg: robotQuotes?.csRobot?.chg || benchmarks.csRobot.chg,
        chgClass: robotQuotes?.csRobot?.chgClass || benchmarks.csRobot.chgClass,
      },
      clock: clockInfo.csRobot,
    },
    {
      key: 'robo' as const,
      name: benchmarks.robo.name,
      symbol: benchmarks.robo.symbol,
      bench: {
        ...benchmarks.robo,
        price: robotQuotes?.robo?.price ?? benchmarks.robo.price,
        chg: robotQuotes?.robo?.chg || benchmarks.robo.chg,
        chgClass: robotQuotes?.robo?.chgClass || benchmarks.robo.chgClass,
      },
      clock: clockInfo.robo,
    },
  ];

  const sortedTimeline = useMemo(() => {
    return orderBy(timeline || [], ['date'], ['desc']);
  }, [timeline]);

  const liveRobotCrowd = robotQuotes?.crowding;
  const effectiveCrowding = useMemo(() => {
    if (liveRobotCrowd) {
      const liveVal = liveRobotCrowd.value;
      const liveRobot = liveRobotCrowd.robotAmountYi;
      const liveMarket = liveRobotCrowd.marketAmountYi;
      return {
        ...crowding,
        zone: liveRobotCrowd.zone || crowding?.zone,
        label: liveRobotCrowd.label || crowding?.label,
        turnoverShare: {
          ...crowding.turnoverShare,
          value: typeof liveVal === 'number' ? liveVal : crowding.turnoverShare?.value ?? 0,
          robotAmountYi: typeof liveRobot === 'number' ? liveRobot : crowding.turnoverShare?.robotAmountYi ?? 0,
          marketAmountYi: typeof liveMarket === 'number' ? liveMarket : crowding.turnoverShare?.marketAmountYi ?? 0,
        },
      };
    }
    return crowding;
  }, [crowding, liveRobotCrowd]);

  const crowdZone = effectiveCrowding.zone || 'neutral';
  const crowdLabel = effectiveCrowding.label || '温和活跃';

  const tslaPriceVal = robotQuotes?.tsla?.price ?? robotData.optionSentinel?.tsla?.price ?? null;
  const tslaPriceDisplay = typeof tslaPriceVal === 'number' ? tslaPriceVal.toFixed(2) : '--';
  const tslaChg = robotQuotes?.tsla?.chg || robotData.optionSentinel?.tsla?.chg || '--';
  const tslaChgIsUp = tslaChg.startsWith('+');

  return (
    <article>
      {/* 1. 英雄主视觉区 */}
      <header className="hero">
        <img className="hero-bg" src={heroRobot} alt="具身智能人形机器人 · 精密机械臂与关节传感器" />
        <span className="hero-scrim" aria-hidden="true" />
        <div className="hero-inner">
          <div className="hero-main">
            <div className="kicker">{head.kicker}</div>
            <h1>{head.title}</h1>
            <p className="hero-lead">{head.sub}</p>
          </div>
          <div className="hero-aside">
            <span className="hero-meta"><b>数据截至：{head.asOf}</b></span>
            <span className="hero-meta" style={{ opacity: 0.8 }}>{head.framework}</span>
          </div>
        </div>
      </header>

      <div className="content">
        {/* 2. 终端宏观时钟、Tab切换栏与走势图表一体化系统 */}
        <section className="terminal-macro-viewport">
          {/* A. 定价时钟条与模式切换 */}
          <div className="terminal-clock-bar">
            <div className="terminal-clock-title">
              <span className="clock-phase-label">
                {viewMode === 'trend' ? '量价趋势与均线生命线' : '中美核心装备定价基准'}
              </span>
              <span className="clock-phase-window mono">
                {viewMode === 'trend'
                  ? '量价技术位 · 均线系统与波段支撑阻力'
                  : '纯双指数宏观基准（A 股 / 美股）'}
              </span>
            </div>
            <div className="terminal-mode-toggles">
              <button
                type="button"
                className={`terminal-mode-btn ${viewMode === 'trend' ? 'active' : ''}`}
                onClick={() => setViewMode('trend')}
              >
                量价趋势与均线 (K线/MA)
              </button>
              <button
                type="button"
                className={`terminal-mode-btn ${viewMode === 'spread' ? 'active' : ''}`}
                onClick={() => setViewMode('spread')}
              >
                中美全景收益率 (%)
              </button>
            </div>
          </div>

          {/* B. 纯双指数无框 Tab 切换栏 */}
          <div className="terminal-index-tabs-bar dual-tabs" role="tablist">
            {tabConfigs.map((tc) => {
              const isActive = activeTab === tc.key;
              const priceDisplay = typeof tc.bench.price === 'number'
                ? tc.bench.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 })
                : tc.bench.price;
              const chgClass = tc.bench.chgClass || (tc.bench.chg?.startsWith('+') ? 'up' : (tc.bench.chg?.startsWith('-') ? 'down' : ''));
              const statusClass = tc.clock.status.toLowerCase();
              const statusLabel = tc.clock.statusLabel;

              return (
                <button
                  key={tc.key}
                  type="button"
                  className={`index-tab-button ${tc.key} ${isActive ? 'active' : ''}`}
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveTab(tc.key)}
                >
                  <div className="index-tab-head-row">
                    <div className="index-tab-name-box">
                      <span className="index-tab-name">{tc.name}</span>
                      <span className="index-tab-sym">{tc.symbol}</span>
                    </div>
                    <span className={`index-tab-status ${statusClass}`}>{statusLabel}</span>
                  </div>
                  <div className="index-tab-data-row">
                    <span className="index-tab-price">{priceDisplay}</span>
                    <span className={`index-tab-chg ${chgClass}`}>{tc.bench.chg}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* C. 紧随其后的走势图表 */}
          <div className="terminal-chart-viewport">
            {viewMode === 'trend' ? (
              <>
                <div className="robot-kline-caption-bar">
                  <div className="robot-kline-title">
                    <span className="terminal-chart-indicator" style={{ background: activeColor }} />
                    <span>
                      {rangeLabel} · {currentInst.name}（{currentInst.symbol}）日K与成交量
                    </span>
                  </div>
                  <div className="robot-range-tabs">
                    {([['30d', '30日K'], ['60d', '60日K (季线)'], ['125d', '半年K (125日)']] as const).map(([k, lbl]) => (
                      <button
                        key={k}
                        type="button"
                        className={`robot-range-btn ${range === k ? 'active' : ''}`}
                        onClick={() => setRange(k)}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="robot-kline-legend">
                  <span><i style={{ background: UP }} />阳线（涨）</span>
                  <span><i style={{ background: DOWN }} />阴线（跌）</span>
                  <span><i style={{ background: AMBER }} />MA20（月线/波段）</span>
                  <span><i style={{ background: CYAN }} />MA60（季线/生命线）</span>
                  <span><i style={{ background: 'rgba(245,197,66,0.6)' }} />支撑带 ({currentInst.support[0]}-{currentInst.support[1]})</span>
                  <span><i style={{ background: 'rgba(255,107,107,0.6)' }} />压力带 ({currentInst.resistance[0]}-{currentInst.resistance[1]})</span>
                </div>

                <ReactECharts key={`kline-${activeTab}-${range}`} option={klineOpt} style={{ height: 350, width: '100%' }} notMerge />

                {/* 趋势生命线与跟踪防守体系条 */}
                <div className="card trend-lifeline-strip" style={{ margin: '10px 14px 14px' }}>
                  <div className="trend-badge-group">
                    <span className="trend-badge-lbl">趋势定性</span>
                    <span className={`trend-status-tag ${currentInst.trendStatus || 'correction'}`}>
                      {currentInst.trendStatusLabel || '弱势筑底 · 考验防守'}
                    </span>
                  </div>
                  <div className="trend-points">
                    <span className="tp-item">
                      波段强弱线 (MA20) <b>{currentInst.currency}{currentMA20} {currentInst.unit}</b>
                      <small>偏离 {biasMA20 >= 0 ? '+' : ''}{biasMA20.toFixed(2)}% · 站稳确立右侧</small>
                    </span>
                    <span className="tp-item">
                      季线生命线 (MA60) <b>{currentInst.currency}{currentMA60} {currentInst.unit}</b>
                      <small>偏离 {biasMA60 >= 0 ? '+' : ''}{biasMA60.toFixed(2)}% · 中长线趋势强弱分水岭</small>
                    </span>
                    <span className="tp-item tp-stop">
                      结构破位底线 <b>{currentInst.currency}{currentInst.stopLoss} {currentInst.unit}</b>
                      <em>跌破确认结构破位 · 下行风险敞口扩大</em>
                    </span>
                    <span className="tp-item tp-entry">
                      右侧突破确认 <b>{currentInst.currency}{currentInst.breakoutTarget} {currentInst.unit}</b>
                      <small>放量突破颈线 · 形态确立右侧走强</small>
                    </span>
                  </div>
                </div>

                {/* 实战研判与交易纪律卡片 */}
                <div className="tech-grid" style={{ margin: '0 14px 14px' }}>
                  <div className="t-item t-full">
                    <b>走势判定</b>
                    <span>{currentInst.trend}</span>
                  </div>
                  <div className="t-item">
                    <b>支撑带依据</b>
                    <span>{currentInst.supportDesc}</span>
                  </div>
                  <div className="t-item">
                    <b>压力带依据</b>
                    <span>{currentInst.resistanceDesc}</span>
                  </div>
                  <div className="t-item t-full" style={{ borderLeft: '3px solid var(--amber)' }}>
                    <b style={{ color: 'var(--amber)' }}>中期趋势技术面特征与量化风控参考</b>
                    <span>{currentInst.discipline}</span>
                  </div>
                </div>

                {/* 模块级就地免责声明 */}
                <div style={{ margin: '0 16px 14px', fontSize: 11, color: 'var(--text-faint)', lineHeight: 1.5 }}>
                  * 免责声明：上述均线偏离度、静态支撑带与阻力位基于历史量价指标测算，仅供客观技术形态与风险敞口跟踪参考，不构成任何投资咨询或买卖操作建议。
                </div>
              </>
            ) : (
              <>
                <div className="terminal-chart-caption-bar">
                  <div className="terminal-chart-title">
                    <span className="terminal-chart-indicator" style={{ background: activeColor }} />
                    <span>
                      {activeSeriesMeta.name} · 近 125 交易日基准累计收益 ({isOverlay ? '纯双指数对冲 (ROBO vs 562500)' : '单指数聚焦'})
                    </span>
                  </div>
                </div>

                <ReactECharts option={normalizedOpt} style={{ height: 280, width: '100%' }} notMerge lazyUpdate />

                {/* 底部技术位统计速览条 */}
                <div className="terminal-chart-stats">
                  <div className="stat-item">
                    <span className="stat-label">阶段起点:</span>
                    <span className="stat-val">{dates.length > 0 ? `${dates[0]} (0%)` : '--'}</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">期间高位:</span>
                    <span className="stat-val" style={{ color: 'var(--up)' }}>
                      {statMax >= 0 ? '+' : ''}{statMax.toFixed(2)}%
                    </span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">期间低位:</span>
                    <span className="stat-val" style={{ color: 'var(--down)' }}>
                      {statMin >= 0 ? '+' : ''}{statMin.toFixed(2)}%
                    </span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">当前累计收益:</span>
                    <span className="stat-val" style={{ color: statLatest >= 0 ? 'var(--up)' : 'var(--down)' }}>
                      {statLatest >= 0 ? '+' : ''}{statLatest.toFixed(2)}%
                    </span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">中美装备裂口 (ROBO vs 562500):</span>
                    <span className="stat-val" style={{ color: spreadUsChina >= 0 ? 'var(--up)' : 'var(--down)' }}>
                      {spreadUsChina >= 0 ? '+' : ''}{spreadUsChina.toFixed(2)}%
                    </span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">基准对齐:</span>
                    <span className="stat-val">{dates.length} 交易日</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>

        {/* 3. 资金面与微观筹码哨兵 */}
        <h2 className="sec-title" style={{ marginTop: 28 }}>
          资金面与微观筹码哨兵
          <span className="hint">成交额占比衡量板块拥挤度，ETF 份额跟踪主力申赎，前瞻雷达锚定预期差验证</span>
        </h2>
        <div className="anomaly-grid">
          {/* A. 板块成交额占比仪表 */}
          <div className="card real-crowd-card">
            <div className="real-crowd-head">
              <span className="real-crowd-title">{effectiveCrowding.turnoverShare.label}</span>
              <span className={`crowd-badge ${crowdZone}`}>{crowdLabel}</span>
            </div>
            <div className="real-crowd-num-row">
              <span className="real-crowd-val num">{effectiveCrowding.turnoverShare.value}</span>
              <span className="real-crowd-unit">{effectiveCrowding.turnoverShare.unit || '%'}</span>
            </div>
            <div className="gauge-track" aria-hidden="true">
              <div
                className={`gauge-fill ${crowdZone}`}
                style={{ width: `${clamp((effectiveCrowding.turnoverShare.value / 4.5) * 100, 4, 100)}%` }}
              />
            </div>
            <div className="gauge-marks">
              <span>0.8 冰点</span>
              <span>1.5 活跃</span>
              <span>2.8 偏热</span>
              <span>3.8 极端</span>
            </div>
            <div className="real-crowd-detail">
              机器人 {typeof effectiveCrowding.turnoverShare.robotAmountYi === 'number' ? effectiveCrowding.turnoverShare.robotAmountYi.toLocaleString() : '--'} 亿 / 两市 {typeof effectiveCrowding.turnoverShare.marketAmountYi === 'number' ? effectiveCrowding.turnoverShare.marketAmountYi.toLocaleString() : '--'} 亿。{effectiveCrowding.methodNote}。
            </div>
          </div>

          {/* B. ETF 份额净申赎 */}
          <div className="card real-crowd-card">
            <div className="real-crowd-head">
              <span className="real-crowd-title">代表性 ETF 份额动向</span>
              <span className="crowd-badge neutral">{crowding.etfFlow.label}</span>
            </div>
            <div className="real-crowd-num-row">
              <span className="real-crowd-val num">{crowding.etfFlow.unitsTotal}</span>
              <span className="real-crowd-unit" style={{ fontSize: 13, color: 'var(--up)' }}>
                {crowding.etfFlow.unitsChange}
              </span>
            </div>
            <div className="real-crowd-detail" style={{ marginTop: 12 }}>
              562500.SH 跟踪：{crowding.etfFlow.signal}（截至 {crowding.etfFlow.asOf}）
            </div>
          </div>

          {/* C. 特斯拉前瞻期权与订单发包雷达 */}
          <div className="card real-crowd-card">
            <div className="real-crowd-head">
              <span className="real-crowd-title">前瞻期权与发包雷达 (TSLA)</span>
              <span className="crowd-badge danger">高噪声期权标的</span>
            </div>
            <div className="real-crowd-num-row">
              <span className="real-crowd-val num">${tslaPriceDisplay}</span>
              <span
                className="real-crowd-unit"
                style={{
                  fontSize: 13,
                  color: tslaChgIsUp ? 'var(--up)' : 'var(--down)',
                }}
              >
                {tslaChg}
              </span>
              <span className={`index-tab-status ${clockInfo.tsla.status.toLowerCase()}`} style={{ marginLeft: 'auto', fontSize: 10 }}>
                {clockInfo.tsla.statusLabel}
              </span>
            </div>
            <div style={{ margin: '8px 0 6px', fontSize: 11, color: 'var(--amber)', lineHeight: 1.45 }}>
              【投研警示】：85%+ 主营为汽车/储能，短期定价受电车价格战主导，不参与主图纯制造 Beta 计算。
            </div>
            <div className="real-crowd-detail" style={{ fontSize: 11, lineHeight: 1.45 }}>
              <b>长三角定点跟踪：</b>{robotData.optionSentinel?.tsla?.supplyChainAudit?.screwStatus || '暂无供应链审计披露'}
            </div>
          </div>
        </div>

        {/* 前瞻催化剂与预期差雷达 */}
        <div className="card chart-panel" style={{ marginTop: 16 }}>
          <div className="chart-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>前瞻催化剂与预期差雷达 (Forward-looking Catalyst Calendar)</span>
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)', textTransform: 'none' }}>
              锁定关键技术与商业化验证排期
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginTop: 14 }}>
            {catalysts.map((cat, i) => (
              <div
                key={i}
                style={{
                  background: 'rgba(240, 240, 250, 0.03)',
                  border: '1px solid rgba(240, 240, 250, 0.08)',
                  borderRadius: 4,
                  padding: '12px 14px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--amber)', fontWeight: 700 }}>
                    {cat.date}
                  </span>
                  <span className="crowd-badge cold" style={{ fontSize: 10, padding: '1px 5px' }}>
                    {cat.tag}
                  </span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>{cat.title}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>{cat.watch}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 4. 顶层判断锚点与核心 KPI */}
        <h2 className="sec-title" style={{ marginTop: 36 }}>
          产业落地核心判断锚点
          <span className="hint">制造场景渗透与单位经济性</span>
        </h2>
        <div className="card robot-anchor-card">
          <div className="robot-anchor-header">
            <div className="robot-anchor-title">核心判断锚点 · 工业与商业规模化落地标准</div>
            <span className="crowd-badge cold" style={{ fontSize: '11px' }}>
              严格遵循机构验证准则
            </span>
          </div>
          <div className="robot-anchor-thesis">{anchor.thesis}</div>

          <div className="robot-kpi-grid">
            {anchor.kpis.map((kpi) => (
              <div className="robot-kpi-item" key={kpi.id}>
                <div className="robot-kpi-label">{kpi.label}</div>
                <div className="robot-kpi-val-row">
                  <span className="robot-kpi-val num">{kpi.value}</span>
                  <span className="robot-kpi-chg num">{kpi.chg}</span>
                </div>
                <div className="robot-kpi-sub">{kpi.sub}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 5. 六维核心观察矩阵 */}
        <h2 className="sec-title">
          六维产业验证矩阵
          <span className="hint">半导体周期框架迁移 · 紧扣出货、订单、成本、产能、良率与财务闭环</span>
        </h2>

        <div className="robot-six-grid">
          {dimensions.map((dim) => (
            <div className="card robot-dim-card" key={dim.id}>
              <div>
                {/* 维度头部 */}
                <div className="robot-dim-head">
                  <span className="robot-dim-name">{dim.name}</span>
                  <span className="robot-analogy-tag">对照：{dim.analogy}</span>
                </div>
                <div className="robot-dim-metric">指标：{dim.metrics}</div>

                {/* 维度专属内联可视化图表 */}
                <div className="robot-chart-box">
                  {dim.id === 'volume' && dim.penetration && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-dim)', marginBottom: 6, flexWrap: 'wrap', gap: '4px' }}>
                        <span>场景渗透率结构</span>
                        <span>生产场景合计 <b>{((dim.penetration.manufacturing || 0) + (dim.penetration.logistics || 0)).toFixed(1)}%</b>（阈值 {dim.penetration.target}%）</span>
                      </div>
                      <div style={{ height: 18, background: 'rgba(240, 240, 250, 0.08)', borderRadius: 2, display: 'flex', position: 'relative', overflow: 'hidden' }}>
                        <div style={{ width: `${dim.penetration.manufacturing}%`, background: '#ff6b6b' }} title={`智能制造 ${dim.penetration.manufacturing}%`} />
                        <div style={{ width: `${dim.penetration.logistics}%`, background: '#38bdf8' }} title={`仓储物流 ${dim.penetration.logistics}%`} />
                        <div style={{ width: `${dim.penetration.other}%`, background: 'rgba(240, 240, 250, 0.15)' }} title={`文娱科研及其他 ${dim.penetration.other}%`} />
                        <div
                          style={{
                            position: 'absolute',
                            left: `${dim.penetration.target}%`,
                            top: 0,
                            bottom: 0,
                            width: 2,
                            background: '#f5c542',
                            boxShadow: '0 0 6px #f5c542',
                          }}
                        />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-faint)', marginTop: 6, fontFamily: 'var(--font-mono)', flexWrap: 'wrap', gap: '4px 8px' }}>
                        <span style={{ color: '#ff6b6b' }}>■ 智能制造 {dim.penetration.manufacturing}%</span>
                        <span style={{ color: '#38bdf8' }}>■ 仓储物流 {dim.penetration.logistics}%</span>
                        <span style={{ color: 'var(--amber)' }}>▲ 爆发观察线 {dim.penetration.target}%</span>
                        <span>□ 文娱商演等 {dim.penetration.other}%</span>
                      </div>
                    </div>
                  )}

                  {dim.id === 'orders' && dim.procurement && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-dim)', marginBottom: 8 }}>
                        <span>国网规划采购结构（设备 58 亿元 / 8500 台）</span>
                        <span style={{ color: 'var(--text-faint)' }}>非公开招标公告口径</span>
                      </div>
                      {dim.procurement.map((p) => (
                        <div key={p.name} style={{ marginBottom: 6 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: 2, flexWrap: 'wrap', gap: '4px' }}>
                            <span style={{ color: 'var(--text)' }}>{p.name}</span>
                            <span className="mono" style={{ color: 'var(--text-dim)' }}>
                              {p.units} 台 / <b>{p.budget} 亿元</b> ({p.unitPrice})
                            </span>
                          </div>
                          <div style={{ height: 6, background: 'rgba(240, 240, 250, 0.08)', borderRadius: 2 }}>
                            <div
                              style={{
                                height: '100%',
                                width: `${(p.budget / 25) * 100}%`,
                                background: p.name.includes('人形') ? '#ff6b6b' : 'rgba(240, 240, 250, 0.45)',
                                borderRadius: 2,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {dim.id === 'price' && dim.aspHistory && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-dim)', marginBottom: 8 }}>
                        <span>宇树人形机器人出货均价 ASP 下探</span>
                        <span style={{ color: 'var(--down)' }}>3 年累计 -72.0%</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, textAlign: 'center' }}>
                        {dim.aspHistory.map((h) => (
                          <div key={h.year} style={{ padding: '6px 4px', background: 'rgba(240, 240, 250, 0.04)', borderRadius: 2 }}>
                            <div style={{ fontSize: '10px', color: 'var(--text-faint)' }}>{h.year}</div>
                            <div className="num" style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text)', margin: '2px 0' }}>
                              {h.asp} <span style={{ fontSize: '10px', fontWeight: 400 }}>万</span>
                            </div>
                            <div style={{ fontSize: '9.5px', color: 'var(--text-dim)' }}>毛利 {h.grossMargin}%</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ marginTop: 8, fontSize: '10.5px', color: 'var(--text-faint)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px' }}>
                        <span>入门标杆：R1-Air 标价 2.99 万元</span>
                        <span>特斯拉目标：$20,000–$30,000</span>
                      </div>
                    </div>
                  )}

                  {dim.id === 'capacity' && dim.capacitySteps && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-dim)', marginBottom: 8 }}>
                        <span>产线节拍爬坡阶梯 vs 远期规划</span>
                        <span style={{ color: 'var(--amber)' }}>当前处于量产鸿沟期</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {dim.capacitySteps.map((s) => (
                          <div key={s.stage} style={{ display: 'flex', alignItems: 'center', fontSize: '11px', flexWrap: 'wrap', gap: '4px' }}>
                            <span style={{ width: 'auto', minWidth: 70, color: 'var(--text-dim)', flexShrink: 0 }}>{s.stage}</span>
                            <div style={{ flex: 1, minWidth: 80, height: 6, background: 'rgba(240, 240, 250, 0.08)', borderRadius: 2, margin: '0 6px' }}>
                              <div
                                style={{
                                  height: '100%',
                                  width: `${clamp(Math.log10(s.val + 1) * 23, 0, 100)}%`,
                                  background: s.stage.includes('实际') ? '#4ade80' : s.stage.includes('目标') ? '#f5c542' : 'rgba(240, 240, 250, 0.35)',
                                  borderRadius: 2,
                                }}
                              />
                            </div>
                            <span className="mono" style={{ width: 'auto', textAlign: 'right', color: 'var(--text)', fontSize: '10.5px', marginLeft: 'auto' }}>
                              {s.val} {s.unit}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {dim.id === 'reliability' && dim.reliabilityStats && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-dim)', marginBottom: 8 }}>
                        <span>工业连续运行工时进展 (Figure 宝马工位)</span>
                        <span className="mono" style={{ color: '#4ade80' }}>
                          {dim.reliabilityStats.bmwHours}h / {dim.reliabilityStats.targetMtbf}h
                        </span>
                      </div>
                      <div style={{ height: 8, background: 'rgba(240, 240, 250, 0.08)', borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
                        <div
                          style={{
                            height: '100%',
                            width: `${(dim.reliabilityStats.bmwHours / dim.reliabilityStats.targetMtbf) * 100}%`,
                            background: '#4ade80',
                            borderRadius: 2,
                          }}
                        />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10.5px', color: 'var(--text-faint)', flexWrap: 'wrap', gap: '4px' }}>
                        <span>{(dim.reliabilityStats as { stampedPartsText?: string }).stampedPartsText || '工位装载测试中'}</span>
                        <span style={{ color: '#ff6b6b' }}>{(dim.reliabilityStats as { assemblyBottleneckText?: string }).assemblyBottleneckText || '产线装配良率攻关中'}</span>
                      </div>
                    </div>
                  )}

                  {dim.id === 'financials' && dim.peers && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-dim)', marginBottom: 8 }}>
                        <span>整机龙头财务报表检验（2025 全年 · 亿元）</span>
                        <span style={{ color: 'var(--text-faint)' }}>
                          <span style={{ color: '#ff6b6b' }}>■ 宇树</span> vs <span style={{ color: '#38bdf8' }}>■ 优必选</span>
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {dim.peers.map((p) => (
                          <div key={p.metric} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', background: 'rgba(240, 240, 250, 0.02)', padding: '3px 6px', borderRadius: 2, flexWrap: 'wrap', gap: '4px' }}>
                            <span style={{ color: 'var(--text-dim)', minWidth: 70 }}>{p.metric}</span>
                            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                              <span className="mono" style={{ color: p.unitree >= 0 ? '#ff6b6b' : '#4ade80', fontWeight: 600 }}>
                                宇: {p.unitree > 0 ? `+${p.unitree}` : p.unitree}
                              </span>
                              <span className="mono" style={{ color: p.ubtech >= 0 ? '#38bdf8' : '#f5c542', fontWeight: 600 }}>
                                优: {p.ubtech > 0 ? `+${p.ubtech}` : p.ubtech}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* 披露事实阅读 */}
                <div className="robot-reading-text">{dim.reading}</div>
                <div className="robot-source-label">数据来源：{dim.source}</div>
              </div>

              {/* 观察触发条件 */}
              <div className="robot-signal-box">
                <span className="robot-signal-tag">观察条件</span>
                <span className="robot-signal-text">{dim.signal}</span>
              </div>
            </div>
          ))}
        </div>

        {/* 6. 具身智能与人形机器人产业大事记 */}
        {sortedTimeline.length > 0 && (
          <>
            <h2 className="sec-title" style={{ marginTop: 36 }}>
              {timelineTitle || '产业大事记与动态追踪'}
              <span className="hint">{timelineHint}</span>
            </h2>
            <div className="tl" ref={tlRef}>
              {sortedTimeline.map((n, i) => (
                <div className={`node ${i === 0 ? 'latest' : ''} ${n.hot ? 'hot' : ''}`} key={`${n.date}-${n.t}-${i}`}>
                  <div className="dot" />
                  <div className="tags">
                    <span className="date">{n.date}</span>
                    <span className="tag">{n.tag}</span>
                    {n.hot && <span className="tag hot-tag">重大事件</span>}
                  </div>
                  <div className="t">
                    {n.url ? (
                      <a href={n.url} target="_blank" rel="noopener noreferrer">
                        {n.t}
                        <ArrowUpRight size={15} strokeWidth={1.75} aria-hidden="true" />
                      </a>
                    ) : (
                      n.t
                    )}
                  </div>
                  <div className="d">{n.d}</div>
                  <div className="src">{n.src}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* 8. 底部来源与说明 */}
        <footer className="src">
          {footer}
        </footer>
      </div>
    </article>
  );
}
