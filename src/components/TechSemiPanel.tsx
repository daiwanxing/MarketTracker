import { useState, useEffect, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { ArrowUpRight } from 'lucide-react';
import heroSemi from '../assets/hero-semi.jpg';
import techSemiData from '../data/techSemiData.json';
import { resolveMarketClock } from '../utils/marketClock';

const MONO = "ui-monospace, 'SF Mono', Consolas, monospace";
const DISPLAY = "'Barlow Condensed', 'Arial Narrow', Arial, sans-serif";
const AMBER = '#F5C542';

type Bench = {
  name: string;
  symbol: string;
  price: number;
  chg: string;
  chgClass: string;
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

type SignalItem = {
  dim: string;
  k: string;
  v: string;
};

type Signal = {
  secTitle?: string;
  secHint?: string;
  verdict?: string;
  sub?: string;
  bullTitle?: string;
  bullHint?: string;
  bull?: SignalItem[];
  bearTitle?: string;
  bearHint?: string;
  bear?: SignalItem[];
  watch?: string;
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

type RiskItem = {
  k: string;
  desc: string;
  level: string;
  src: string;
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

const BENCH_KEYS = ['sox', 'kospi', 'star50'] as const;
const CHART_SERIES = [
  { key: 'sox', name: 'SOX 费半', color: '#38bdf8', width: 2.2 },
  { key: 'kospi', name: '韩国 KOSPI', color: '#f43f5e', width: 2.0 },
  { key: 'star50', name: '科创50', color: '#facc15', width: 1.8 },
] as const;

const SEMI_DIM: Record<string, string> = {
  capex: '资本开支',
  foundry: '先进制程',
  substitute: '国产替代',
  mature: '成熟制程',
  geo: '地缘管制',
  memory: '存储周期',
};

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
    'closingReview' | 'leverage' | 'fundamental' | 'signal' | 'timeline' | 'risks'
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
    fundamental?: { note: string; items: Anomaly[] };
    signal?: Signal;
    timeline?: TimelineItem[];
    risks?: RiskItem[];
  };
  const { head, benchmarks, crowding, charts, footer, snapshot } = data;
  const benchMap = benchmarks as Record<string, Bench | undefined>;

  // 实时市场时钟更新（每 30 秒自动校准一次客户端当前状态）
  const [currentTime, setCurrentTime] = useState(() => new Date());
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

  const [yy, mm, dd] = snapshot.slice(0, 10).split('-');
  const snapDate = `${yy}年${mm}月${dd}日 ${snapshot.slice(11, 16)}`;
  const chgCls = (c: string) => (c === 'up' ? ' up' : c === 'down' ? ' down' : '');

  const benches = BENCH_KEYS.map((key) => benchMap[key]).filter((item): item is Bench => Boolean(item));
  const share = crowding?.turnoverShare?.value ?? 0;
  const starDown = benchMap.star50?.chgClass === 'down';
  const tone = crowdTone(share, starDown);
  const crowdZone = crowding?.zone || tone.zone;
  const crowdLabel = crowding?.label || tone.label;
  const norm = charts.normalized as Record<string, number[] | string[]>;
  const dates = (norm.dates as string[]) || [];

  const normalizedOpt: EChartsOption = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(0,0,0,0.92)',
      borderColor: 'rgba(240,240,250,0.35)',
      borderWidth: 1,
      textStyle: { color: '#f0f0fa', fontFamily: DISPLAY, fontSize: 12 },
    },
    legend: {
      top: 0,
      itemWidth: 14,
      itemHeight: 3,
      textStyle: { color: 'rgba(240,240,250,0.85)', fontFamily: DISPLAY, fontSize: 11 },
    },
    grid: { left: 48, right: 16, top: 36, bottom: 26 },
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
    series: CHART_SERIES.map((item) => ({
      name: item.name,
      type: 'line',
      data: (norm[item.key] as number[]) || [],
      showSymbol: false,
      lineStyle: { color: item.color, width: item.width },
      itemStyle: { color: item.color },
    })),
  };

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
            <span className="hero-meta"><b>最后更新：{snapDate}</b></span>
          </div>
        </div>
      </header>

      <div className="content">
        {/* ==================== 盘后深度归因与收盘复盘 (Post-Market Attribution) ==================== */}
        {data.closingReview && (
          <section className="closing-review-section">
            {/* 1. 彭博终端时钟状态条 */}
            <div className="terminal-clock-bar">
              <div className="terminal-clock-title">
                <span className="live-pulse-dot" aria-hidden="true" />
                <span className="clock-phase-label">
                  {dynamicClock?.tradingPhase.headline ?? data.closingReview.tradingPhase.headline}
                </span>
                <span className="clock-phase-window mono">
                  {dynamicClock?.tradingPhase.window ?? data.closingReview.tradingPhase.window}
                </span>
              </div>
              <div className="clock-market-pills">
                {(dynamicClock?.marketClock ?? data.closingReview.marketClock).map((m) => (
                  <div className={`clock-pill ${m.status.toLowerCase()}`} key={m.symbol}>
                    <span className="pill-name">{m.name}</span>
                    <span className={`pill-chg num ${m.chgClass}`}>{m.chg}</span>
                    <span className="pill-status">{m.statusLabel}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 2. 收盘总定调巨幕卡片 */}
            <div className="card closing-verdict-card">
              <div className="verdict-header">
                <div className="verdict-tag-group">
                  <span className="kicker-tag">EXECUTIVE POST-MARKET ATTRIBUTION</span>
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

            {/* 3. 四大多因子归因支柱矩阵 */}
            <div className="attribution-grid">
              {data.closingReview.pillars.map((pillar) => (
                <div className={`card pillar-card ${pillar.impact}`} key={pillar.id}>
                  <div className="pillar-head">
                    <div className="pillar-meta">
                      <span className="pillar-weight mono">WEIGHT {pillar.weight}%</span>
                      <span className={`pillar-tag ${pillar.impact}`}>{pillar.factorTag}</span>
                    </div>
                    <h3 className="pillar-title">{pillar.pillarName}</h3>
                    <span className="pillar-en mono">{pillar.pillarNameEn}</span>
                  </div>

                  {/* 硬指标快照 */}
                  <div className="pillar-metrics">
                    {pillar.metrics.map((m, idx) => (
                      <div className="pm-item" key={idx}>
                        <span className="pm-label">{m.label}</span>
                        <span className="pm-val mono">{m.value}</span>
                        {m.sub && <span className="pm-sub">{m.sub}</span>}
                      </div>
                    ))}
                  </div>

                  {/* 深度因果传导链条 */}
                  <div className="transmission-flow">
                    <div className="flow-step trigger">
                      <span className="step-tag">诱发源</span>
                      <p className="step-text">{pillar.transmission.trigger}</p>
                    </div>
                    <div className="flow-arrow" aria-hidden="true">↓</div>
                    <div className="flow-step mechanism">
                      <span className="step-tag">资金机制</span>
                      <p className="step-text">{pillar.transmission.mechanism}</p>
                    </div>
                    <div className="flow-arrow" aria-hidden="true">↓</div>
                    <div className="flow-step outcome">
                      <span className="step-tag">盘面结果</span>
                      <p className="step-text">{pillar.transmission.outcome}</p>
                    </div>
                  </div>

                  {/* 研报级叙述阐述 */}
                  <div className="pillar-narrative">{pillar.narrative}</div>
                </div>
              ))}
            </div>

            {/* 4. 次日博弈核心哨兵变量 */}
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

        <h2 className="sec-title" style={{ marginTop: 28 }}>
          拥挤度与杠杆
          <span className="hint">TMT 成交占比，以及沪深两市融资买入占比</span>
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

        <h2 className="sec-title" style={{ marginTop: 28 }}>
          核心基准
          <span className="hint">费半、韩国KOSPI、科创50</span>
        </h2>
        <div className="benchmarks-grid">
          {benches.map((bm) => (
            <div className="card bm-card" key={bm.symbol}>
              <div className="bm-header">
                <span className="bm-name">{bm.name}</span>
                <span className="bm-sym">{bm.symbol}</span>
              </div>
              <div className="bm-price-row">
                <span className="bm-price num">{bm.price.toLocaleString()}</span>
                <span className={`bm-chg ${chgCls(bm.chgClass)}`}>{bm.chg || '--'}</span>
              </div>
              <div className="bm-src">{bm.src}</div>
            </div>
          ))}
        </div>

        <div className="card chart-panel" style={{ marginTop: 16 }}>
          <div className="chart-title">费半、韩国KOSPI、科创50（近半年累计涨跌，起点为 0）</div>
          <ReactECharts option={normalizedOpt} style={{ height: 320, width: '100%' }} notMerge lazyUpdate />
        </div>

        <h2 className="sec-title" style={{ marginTop: 28 }}>
          云厂商开支与基本面
          <span className="hint">最近一季是加速、持平还是下调。没有已发布材料就不填</span>
        </h2>
        <div className="base-grid">
          {(data.fundamental?.items ?? []).map((item) => (
            <div className="card real-crowd-card" key={item.k}>
              <div className="real-crowd-head">
                <span className="real-crowd-title">{item.k}</span>
                <span className={`crowd-badge ${item.zone}`}>
                  {item.status === 'pending' ? '未接入 · 还没有可引用的披露' : item.v}
                </span>
              </div>
              <div className="real-crowd-desc">{item.metric}</div>
              <div className="real-crowd-detail">{item.watch}</div>
            </div>
          ))}
        </div>
        {data.fundamental?.note && <div className="sec-note">{data.fundamental.note}</div>}

        <h2 className="sec-title" style={{ marginTop: 28 }}>
          {data.signal?.secTitle || '产业与市场信号'}
          <span className="hint">{data.signal?.secHint || '只根据已经对上的价格和成交占比。未接入的指标不下结论'}</span>
        </h2>
        <div className="card signal">
          <div className="sig-verdict">
            <div className="v-main">{data.signal?.verdict}</div>
            {data.signal?.sub && <div className="v-sub">{data.signal.sub}</div>}
          </div>
          <div className="sig-cols">
            <div className="sig-col">
              <div className="col-h up">
                <i aria-hidden="true" />
                {data.signal?.bullTitle || '利多支撑'}
                <span>{data.signal?.bullHint || '结构性景气驱动'}</span>
              </div>
              {data.signal?.bull?.map((b, i) => (
                <div className="sig-item up" key={`${b.dim}-${i}`}>
                  <i aria-hidden="true" />
                  <span className="k">{b.k}</span>
                  {(SEMI_DIM[b.dim] || b.dim) && <span className="dim">{SEMI_DIM[b.dim] || b.dim}</span>}
                  <span className="v">{b.v}</span>
                </div>
              ))}
            </div>
            <div className="sig-col">
              <div className="col-h down">
                <i aria-hidden="true" />
                {data.signal?.bearTitle || '潜在风险'}
                <span>{data.signal?.bearHint || '抑制估值与斜率'}</span>
              </div>
              {data.signal?.bear?.map((b, i) => (
                <div className="sig-item down" key={`${b.dim}-${i}`}>
                  <i aria-hidden="true" />
                  <span className="k">{b.k}</span>
                  {(SEMI_DIM[b.dim] || b.dim) && <span className="dim">{SEMI_DIM[b.dim] || b.dim}</span>}
                  <span className="v">{b.v}</span>
                </div>
              ))}
            </div>
          </div>
          {data.signal?.watch && (
            <div className="sig-watch">
              <b>中性 / 待观察 ·</b> {data.signal.watch}
            </div>
          )}
        </div>

        {data.timeline && data.timeline.length > 0 && (
          <>
            <h2 className="sec-title" style={{ marginTop: 28 }}>
              半导体与产业链重大事件
              <span className="hint">过去 30 天内对供给、制程良率、地缘政策及资本开支有实质影响的事实</span>
            </h2>
            <div className="tl">
              {data.timeline.map((n, i) => (
                <div className={n.hot ? 'node hot' : 'node'} key={`${n.date}-${n.t}-${i}`}>
                  <div className="dot" />
                  <div className="tags">
                    <span className="date">{n.date}</span>
                    <span className="tag">{n.tag}</span>
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

        {data.risks && data.risks.length > 0 && (
          <>
            <h2 className="sec-title" style={{ marginTop: 28 }}>
              产业核心风险雷达
              <span className="hint">关注宏观流动性、出口管制政策与终端 ROI 变现节奏</span>
            </h2>
            <div className="risks">
              {data.risks.map((r, i) => (
                <div className="card rcard" key={r.k || i}>
                  <div className="rk">
                    <i className={r.level === 'high' ? 'r' : r.level === 'med' ? 'y' : 'n'} aria-hidden="true" />
                    {r.k}
                  </div>
                  <p>{r.desc}</p>
                  <div className="src">{r.src}</div>
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
