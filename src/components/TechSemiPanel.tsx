import { useState, useEffect, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { ArrowUpRight } from 'lucide-react';
import heroSemi from '../assets/hero-semi.jpg';
import techSemiData from '../data/techSemiData.json';
import { resolveMarketClock } from '../utils/marketClock';
import { useLiveQuotes } from '../hooks/useLiveQuotes';

const MONO = "ui-monospace, 'SF Mono', Consolas, monospace";
const DISPLAY = "'Barlow Condensed', 'Arial Narrow', Arial, sans-serif";
const AMBER = '#F5C542';

type Bench = {
  name: string;
  symbol: string;
  price: number;
  chg: string;
  chgClass: string;
  previousClose?: number;
  src: string;
};

type Anomaly = {
  k: string;
  metric: string;
  status: string;
  zone: string;
  v: string;
  watch: string;
};

type TimelineItem = {
  date: string;
  tag: string;
  t: string;
  d: string;
  src: string;
  hot?: boolean;
  url?: string;
};

type MarketClockItem = {
  symbol: string;
  name: string;
  status: string;
  statusLabel: string;
  price: number;
  chg: string;
  chgClass: string;
  role: string;
};

type AttributionMetric = {
  label: string;
  value: string;
  sub?: string;
};

type AttributionTransmission = {
  trigger: string;
  mechanism: string;
  outcome: string;
};

type AttributionPillar = {
  id: string;
  pillarName: string;
  pillarNameEn: string;
  weight: number;
  impact: string;
  impactLabel: string;
  factorTag: string;
  metrics: AttributionMetric[];
  transmission: AttributionTransmission;
  narrative: string;
};

type NextDayWatch = {
  target: string;
  threshold: string;
  logic: string;
  priority: string;
};

type ClosingReview = {
  asOf: string;
  tradingPhase: {
    phase: string;
    headline: string;
    window: string;
  };
  verdict: {
    headline: string;
    coreSummary: string;
    riskTone: string;
    primaryDriver: string;
  };
  marketClock: MarketClockItem[];
  pillars: AttributionPillar[];
  crossMarket: {
    spreadMetric: string;
    spreadStatus: string;
    divergenceLogic: string;
    leadLagSignal: string;
  };
  nextDayWatch: NextDayWatch[];
};

const CHART_SERIES = [
  { key: 'sox', name: 'SOX 费半', color: '#38bdf8', width: 2.2 },
  { key: 'kospi', name: '韩国 KOSPI', color: '#f43f5e', width: 2.0 },
  { key: 'star50', name: '科创50', color: '#F5C542', width: 2.0 },
] as const;

function crowdTone(share: number, priceDown: boolean) {
  if (share >= 38) {
    return {
      zone: 'danger',
      label: priceDown ? '极端过热 · 下跌放量' : '极端过热',
      note: priceDown ? '高占比出现在下跌日，更像恐慌放量，不是主升。' : '上涨中的高占比，是主升拥挤。',
    };
  }
  if (share >= 32) {
    return { zone: 'warning', label: '拥挤偏热', note: '筹码开始拥挤，连同当天涨跌一起看。' };
  }
  if (share >= 20) {
    return { zone: 'neutral', label: '主线活跃', note: '成交占比处在主线区间。' };
  }
  return { zone: 'cold', label: '低位冰点', note: '成交占比偏低，主题并不拥挤。' };
}

export default function TechSemiPanel() {
  const data = techSemiData as unknown as Omit<
    typeof techSemiData,
    'closingReview' | 'leverage' | 'timeline'
  > & {
    closingReview?: ClosingReview;
    leverage?: {
      note: string;
      marginBuyShare: Anomaly & {
        value?: number;
        asOf?: string;
        buyYi?: number;
        marketAmountYi?: number;
        dates?: string[];
        shares?: number[];
      };
    };
    timeline?: TimelineItem[];
  };
  const { head, benchmarks, crowding, charts, footer, snapshot } = data;
  const rawBenchMap = benchmarks as Record<string, Bench | undefined>;
  const { liveQuotes, isLive } = useLiveQuotes();

  // 融合 Vercel Serverless / Edge API 实时行情
  const benchMap = useMemo(() => {
    if (!liveQuotes?.techSemi) return rawBenchMap;
    const lSemi = liveQuotes.techSemi;
    return {
      ...rawBenchMap,
      sox: rawBenchMap.sox ? {
        ...rawBenchMap.sox,
        price: lSemi.sox.price,
        chg: lSemi.sox.chg,
        chgClass: lSemi.sox.chgClass,
        previousClose: lSemi.sox.previousClose ?? rawBenchMap.sox.previousClose,
        src: `${rawBenchMap.sox.symbol} · Vercel 边缘实时 · Yahoo Finance`,
      } : undefined,
      star50: rawBenchMap.star50 ? {
        ...rawBenchMap.star50,
        price: lSemi.star50.price,
        chg: lSemi.star50.chg,
        chgClass: lSemi.star50.chgClass,
        previousClose: lSemi.star50.previousClose ?? rawBenchMap.star50.previousClose,
        src: `${rawBenchMap.star50.symbol} · Vercel 边缘实时 · Yahoo Finance`,
      } : undefined,
      kospi: rawBenchMap.kospi ? {
        ...rawBenchMap.kospi,
        price: lSemi.kospi.price,
        chg: lSemi.kospi.chg,
        chgClass: lSemi.kospi.chgClass,
        previousClose: lSemi.kospi.previousClose ?? rawBenchMap.kospi.previousClose,
        src: `${rawBenchMap.kospi.symbol} · Vercel 边缘实时 · Yahoo Finance`,
      } : undefined,
    };
  }, [rawBenchMap, liveQuotes]);

  // 实时市场时钟更新（每 30 秒自动校准一次客户端当前状态）
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [activeTab, setActiveTab] = useState<'star50' | 'sox' | 'kospi'>('star50');
  const [isOverlay, setIsOverlay] = useState<boolean>(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  // 动态解析三大核心市场与全球宏观阶段实时状态机
  const dynamicClock = useMemo(() => {
    if (!data.closingReview?.marketClock) return null;
    return resolveMarketClock(
      data.closingReview.marketClock as unknown as Parameters<typeof resolveMarketClock>[0],
      benchMap,
      currentTime
    );
  }, [data.closingReview, benchMap, currentTime]);

  const clockMap = useMemo(() => {
    const list = dynamicClock?.marketClock ?? data.closingReview?.marketClock ?? [];
    const map: Record<'star50' | 'sox' | 'kospi', (typeof list)[0] | undefined> = {
      star50: undefined,
      sox: undefined,
      kospi: undefined,
    };
    for (const item of list) {
      if (item.symbol === '000688.SS') map.star50 = item;
      else if (item.symbol === '^SOX') map.sox = item;
      else if (item.symbol === '^KS11') map.kospi = item;
    }
    return map;
  }, [dynamicClock, data.closingReview]);

  const [yy, mm, dd] = snapshot.slice(0, 10).split('-');
  const snapDate = `${yy}年${mm}月${dd}日 ${snapshot.slice(11, 16)}`;
  const chgCls = (c: string) => (c === 'up' ? ' up' : c === 'down' ? ' down' : '');

  const share = crowding?.turnoverShare?.value ?? 0;
  const starDown = (benchMap.star50?.chgClass === 'down') || (benchMap.star50?.chg.startsWith('-') ?? false);
  const tone = crowdTone(share, starDown);
  const crowdZone = crowding?.zone || tone.zone;
  const crowdLabel = crowding?.label || tone.label;
  const norm = useMemo(() => charts.normalized as Record<string, number[] | string[]>, [charts.normalized]);
  const dates = useMemo(() => (norm.dates as string[]) || [], [norm]);

  // 新闻动态：统一按日期降序排序，并严格截取前 10 条
  const sortedTimeline = useMemo(() => {
    return [...(data.timeline || [])]
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .slice(0, 10);
  }, [data.timeline]);

  const activeColor = activeTab === 'star50' ? '#F5C542' : (activeTab === 'sox' ? '#38bdf8' : '#f43f5e');
  const activeSeriesMeta = CHART_SERIES.find((s) => s.key === activeTab) ?? CHART_SERIES[2];

  const normalizedOpt: EChartsOption = useMemo(() => {
    let seriesList;
    if (isOverlay) {
      seriesList = CHART_SERIES.map((item) => {
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
      legend: isOverlay ? {
        top: 0,
        right: 16,
        itemWidth: 14,
        itemHeight: 3,
        textStyle: { color: 'rgba(240,240,250,0.85)', fontFamily: DISPLAY, fontSize: 11 },
      } : { show: false },
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
  const statMax = activeSeriesData.length ? Math.max(...activeSeriesData) : 0;
  const statMin = activeSeriesData.length ? Math.min(...activeSeriesData) : 0;
  const statLatest = activeSeriesData.length ? activeSeriesData[activeSeriesData.length - 1] : 0;

  const tabConfigs: Array<{
    key: 'star50' | 'sox' | 'kospi';
    name: string;
    symbol: string;
    bench: Bench | undefined;
    clock: (typeof clockMap)['star50'];
  }> = [
    {
      key: 'star50',
      name: '科创50指数',
      symbol: '000688.SS',
      bench: benchMap.star50,
      clock: clockMap.star50,
    },
    {
      key: 'sox',
      name: '费城半导体',
      symbol: '^SOX',
      bench: benchMap.sox,
      clock: clockMap.sox,
    },
    {
      key: 'kospi',
      name: '韩国KOSPI综合',
      symbol: '^KS11',
      bench: benchMap.kospi,
      clock: clockMap.kospi,
    },
  ];

  const margin = data.leverage?.marginBuyShare;
  const marginDates = margin?.dates ?? [];
  const marginShares = margin?.shares ?? [];
  const marginOpt: EChartsOption = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(0,0,0,0.92)',
      borderColor: 'rgba(240,240,250,0.35)',
      borderWidth: 1,
      textStyle: { color: '#f0f0fa', fontFamily: DISPLAY, fontSize: 12 },
    },
    grid: { left: 42, right: 16, top: 16, bottom: 26 },
    xAxis: {
      type: 'category',
      data: marginDates,
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
        formatter: (v: number) => `${v}%`,
      },
    },
    series: [
      {
        name: '融资买入占比',
        type: 'line',
        data: marginShares,
        showSymbol: false,
        lineStyle: { color: AMBER, width: 2 },
        itemStyle: { color: AMBER },
        markLine: {
          symbol: 'none',
          label: { color: 'rgba(240,240,250,0.55)', fontFamily: MONO, fontSize: 10 },
          lineStyle: { type: 'dashed', color: 'rgba(245,197,66,0.55)' },
          data: [
            { yAxis: 7, label: { formatter: '7% 平常起' } },
            { yAxis: 9, label: { formatter: '9% 平常上沿' } },
          ],
        },
      },
    ],
  };

  return (
    <article>
      <header className="hero">
        <img className="hero-bg" src={heroSemi} alt="12 英寸微电子硅晶圆 · 现代芯片制造" />
        <span className="hero-scrim" aria-hidden="true" />
        <div className="hero-inner">
          <div className="hero-main">
            <div className="kicker">{head.kicker}</div>
            <h1>{head.title}</h1>
            <p className="hero-lead">{head.sub}</p>
          </div>
          <div className="hero-aside">
            <span className="hero-meta">
              <b>最后更新：{snapDate}</b>
              {isLive && <span style={{ marginLeft: 8, color: '#38bdf8', fontSize: '11px' }}>● 边缘实时连线</span>}
            </span>
          </div>
        </div>
      </header>

      <div className="content">
        {/* ==================== 1. 终端宏观交易时钟、Tab切换栏与走势图表一体化系统 ==================== */}
        <section className="terminal-macro-viewport">
          {/* A. 彭博终端宏观时钟与模式切换条 */}
          <div className="terminal-clock-bar">
            <div className="terminal-clock-title">
              <span className="live-pulse-dot" aria-hidden="true" />
              <span className="clock-phase-label">
                {dynamicClock?.tradingPhase.headline ?? data.closingReview?.tradingPhase?.headline ?? '全球半导体核心行情'}
              </span>
              <span className="clock-phase-window mono">
                {dynamicClock?.tradingPhase.window ?? data.closingReview?.tradingPhase?.window}
              </span>
            </div>
            <div className="terminal-mode-toggles">
              <button
                type="button"
                className={`terminal-mode-btn ${!isOverlay ? 'active' : ''}`}
                onClick={() => setIsOverlay(false)}
              >
                单指聚焦
              </button>
              <button
                type="button"
                className={`terminal-mode-btn ${isOverlay ? 'active' : ''}`}
                onClick={() => setIsOverlay(true)}
              >
                全景对比
              </button>
            </div>
          </div>

          {/* B. 三大指数无框 Tab 切换栏 */}
          <div className="terminal-index-tabs-bar" role="tablist">
            {tabConfigs.map((tc) => {
              const isActive = activeTab === tc.key;
              const priceDisplay = typeof tc.bench?.price === 'number'
                ? tc.bench.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                : (tc.bench?.price ?? '--');
              const chgClass = tc.bench?.chgClass || (tc.bench?.chg?.startsWith('+') ? 'up' : (tc.bench?.chg?.startsWith('-') ? 'down' : ''));
              const statusClass = tc.clock?.status.toLowerCase() ?? 'closed';
              const statusLabel = tc.clock?.statusLabel ?? '已收盘';

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
                    <span className={`index-tab-chg ${chgCls(chgClass)}`}>{tc.bench?.chg || '--'}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* C. 紧随其后的走势图表 */}
          <div className="terminal-chart-viewport">
            <div className="terminal-chart-caption-bar">
              <div className="terminal-chart-title">
                <span className="terminal-chart-indicator" style={{ background: activeColor }} />
                <span>
                  {activeSeriesMeta.name} · 近 125 交易日基准累计收益 ({isOverlay ? '叠加对照' : '单指聚焦'})
                </span>
              </div>
            </div>

            <ReactECharts option={normalizedOpt} style={{ height: 280, width: '100%' }} notMerge lazyUpdate />

            {/* 底部技术位统计速览条 */}
            <div className="terminal-chart-stats">
              <div className="stat-item">
                <span className="stat-label">阶段起点:</span>
                <span className="stat-val">{dates[0] || '04-02'} (0%)</span>
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
                <span className="stat-label">基准对齐:</span>
                <span className="stat-val">{dates.length} 交易日</span>
              </div>
            </div>
          </div>
        </section>

        {/* ==================== 2. 资金面与杠杆量化哨兵 (Capital & Leverage Sentinel · 🔑2) ==================== */}
        <h2 className="sec-title" style={{ marginTop: 28 }}>
          资金面与杠杆量化哨兵
          <span className="hint">TMT 成交占比衡量微观拥挤，沪深两市融资买入强度反映场内杠杆攻防</span>
        </h2>
        <div className="anomaly-grid">
          {crowding?.turnoverShare && (
            <div className="card real-crowd-card">
              <div className="real-crowd-head">
                <span className="real-crowd-title">{crowding.turnoverShare.label}</span>
                <span className={`crowd-badge ${crowdZone}`}>{crowdLabel}</span>
              </div>
              <div className="real-crowd-num-row">
                <span className="real-crowd-val num">{crowding.turnoverShare.value}</span>
                <span className="real-crowd-unit">{crowding.turnoverShare.unit || '%'}</span>
              </div>
              <div className="gauge-track" aria-hidden="true">
                <div className={`gauge-fill ${crowdZone}`} style={{ width: `${Math.max(4, Math.min(100, (share / 50) * 100))}%` }} />
              </div>
              <div className="gauge-marks">
                <span>20 冰点外</span>
                <span>32 偏热</span>
                <span>38 极端</span>
              </div>
              <div className="real-crowd-detail">
                TMT {crowding.turnoverShare.tmtAmountYi.toLocaleString()} 亿 / 两市 {crowding.turnoverShare.marketAmountYi.toLocaleString()} 亿。{tone.note}
              </div>
            </div>
          )}
        </div>
        {marginShares.length > 0 && (
          <div className="card chart-panel" style={{ marginTop: 16 }}>
            <div className="chart-title">
              两市融资买入占比
              {typeof margin?.value === 'number' && (
                <> · 最新 {margin.value}% · 截至 {margin.asOf} · {margin.v}</>
              )}
            </div>
            <ReactECharts option={marginOpt} style={{ height: 260, width: '100%' }} notMerge lazyUpdate />
            {margin?.watch && <div className="real-crowd-detail">{margin.watch}</div>}
          </div>
        )}
        {data.leverage?.note && <div className="sec-note">{data.leverage.note}</div>}

        {/* ==================== 3. 盘后深度归因与次日博弈 (Post-Market Attribution · ⬇️4 & ⭐1) ==================== */}
        {data.closingReview && (
          <section className="closing-review-section">
            <h2 className="sec-title" style={{ marginTop: 28 }}>
              宏观因果归因与次日博弈
              <span className="hint">微观筹码、资金避险、宏观利率与产业景气多因子传导</span>
            </h2>

            {/* 收盘总定调巨幕卡片 */}
            <div className="card closing-verdict-card">
              <div className="verdict-header">
                <div className="verdict-tag-group">
                  <span className="kicker-tag">
                    {dynamicClock?.tradingPhase.phase === 'APAC_POST_MARKET'
                      ? 'EXECUTIVE POST-MARKET ATTRIBUTION'
                      : 'PREVIOUS CLOSE ATTRIBUTION // 前一交易日收盘定型'}
                  </span>
                  <span className="driver-badge">{data.closingReview.verdict.primaryDriver}</span>
                </div>
                <span className="verdict-asof mono">{data.closingReview.asOf} 发布</span>
              </div>

              <h2 className="verdict-title">{data.closingReview.verdict.headline}</h2>
              <p className="verdict-summary">{data.closingReview.verdict.coreSummary}</p>

              {/* 跨市场分化与比价条 */}
              <div className="cross-market-strip">
                <div className="strip-metric mono">
                  <span className="metric-label">跨市场溢价裂口</span>
                  <span className="metric-val">{data.closingReview.crossMarket.spreadMetric}</span>
                </div>
                <div className="strip-logic">
                  <span className="logic-badge">分化归因</span>
                  <span className="logic-text">{data.closingReview.crossMarket.divergenceLogic}</span>
                </div>
                <div className="strip-leadlag">
                  <span className="logic-badge warn">外盘先导映射</span>
                  <span className="logic-text">{data.closingReview.crossMarket.leadLagSignal}</span>
                </div>
              </div>
            </div>

            {/* 因子影响力全景光谱条 (Cockpit Factor Spectrum) */}
            <div className="attribution-spectrum-deck">
              <div className="spectrum-header">
                <span className="spectrum-title mono">FACTOR INFLUENCE SPECTRUM // 多因子影响力权重全景</span>
                <span className="spectrum-total mono">TOTAL 100%</span>
              </div>
              <div className="spectrum-bar">
                {data.closingReview.pillars.map((pillar) => (
                  <div
                    key={pillar.id}
                    className={`spectrum-segment ${pillar.impact}`}
                    style={{ width: `${pillar.weight}%` }}
                    title={`${pillar.pillarName}: 权重 ${pillar.weight}% (${pillar.factorTag})`}
                  >
                    <span className="seg-name">{pillar.pillarName}</span>
                    <span className="seg-pct mono">{pillar.weight}%</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 四大多因子归因驾驶舱矩阵 (Cockpit Matrix) */}
            <div className="attribution-grid">
              {data.closingReview.pillars.map((pillar) => (
                <div className={`card pillar-card ${pillar.impact}`} key={pillar.id}>
                  {/* 1. 头部标题与因子状态 */}
                  <div className="pillar-head">
                    <div className="pillar-meta">
                      <span className="pillar-weight mono">WEIGHT {pillar.weight}%</span>
                      <div className="pillar-tags-group">
                        <span className={`pillar-tag ${pillar.impact}`}>{pillar.factorTag}</span>
                        {pillar.impactLabel && (
                          <span className={`pillar-impact-badge ${pillar.impact}`}>{pillar.impactLabel}</span>
                        )}
                      </div>
                    </div>
                    <div className="pillar-title-box">
                      <h3 className="pillar-title">{pillar.pillarName}</h3>
                      <span className="pillar-en mono">{pillar.pillarNameEn}</span>
                    </div>
                  </div>

                  {/* 2. 核心量化 KPI 磁贴面板 (Hero Metric Deck) */}
                  <div className="pillar-kpi-deck">
                    {pillar.metrics.map((m, idx) => (
                      <div className="kpi-cell" key={idx}>
                        <div className="kpi-val-row">
                          <span className="kpi-num mono">{m.value}</span>
                          {m.sub && <span className="kpi-sub-badge mono">{m.sub}</span>}
                        </div>
                        <span className="kpi-label">{m.label}</span>
                      </div>
                    ))}
                  </div>

                  {/* 3. 横向因果传导管线 (Horizontal Transmission Pipeline) */}
                  <div className="transmission-pipeline">
                    <div className="pipe-node trigger">
                      <span className="pipe-tag">1. 诱发源</span>
                      <p className="pipe-desc">{pillar.transmission.trigger}</p>
                    </div>
                    <div className="pipe-arrow" aria-hidden="true">➔</div>
                    <div className="pipe-node mechanism">
                      <span className="pipe-tag">2. 资金机制</span>
                      <p className="pipe-desc">{pillar.transmission.mechanism}</p>
                    </div>
                    <div className="pipe-arrow" aria-hidden="true">➔</div>
                    <div className="pipe-node outcome">
                      <span className="pipe-tag">3. 盘面映射</span>
                      <p className="pipe-desc">{pillar.transmission.outcome}</p>
                    </div>
                  </div>

                  {/* 4. 机构研报级定调简评 (Analyst Briefing Callout) */}
                  <div className="pillar-briefing">
                    <span className="briefing-prefix mono" aria-hidden="true">INSIGHT //</span>
                    <p className="briefing-text">{pillar.narrative}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* 次日博弈核心哨兵变量 */}
            <div className="next-watch-deck">
              <div className="deck-header">
                <div className="deck-header-left">
                  <span className="deck-badge mono">SENTINELS</span>
                  <span className="deck-title">次日博弈核心哨兵与开盘临界</span>
                </div>
                <span className="deck-sub-hint">关注开盘承接力与多空分水岭</span>
              </div>
              <div className="deck-grid">
                {data.closingReview.nextDayWatch.map((item, idx) => (
                  <div className={`deck-item ${item.priority}`} key={idx}>
                    <div className="item-top">
                      <span className="item-target">{item.target}</span>
                      <span className={`item-badge ${item.priority} mono`}>
                        {item.priority === 'critical' ? 'CRITICAL // 核心观察' : 'WATCH // 观察变量'}
                      </span>
                    </div>
                    <div className="item-threshold-box">
                      <span className="threshold-label mono">临界触发</span>
                      <span className="threshold-val">{item.threshold}</span>
                    </div>
                    <div className="item-logic-box">
                      <span className="logic-prefix mono" aria-hidden="true">↳</span>
                      <p className="item-logic">{item.logic}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ==================== 4. 市场动态与催化事实 (Market Dynamics · 🚩3) ==================== */}
        {sortedTimeline.length > 0 && (
          <>
            <h2 className="sec-title" style={{ marginTop: 28 }}>
              市场动态
            </h2>
            <div className="tl">
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

        <footer className="src">{footer}</footer>
      </div>
    </article>
  );
}
