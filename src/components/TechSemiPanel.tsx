import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { ArrowUpRight } from 'lucide-react';
import heroSemi from '../assets/hero-semi.jpg';
import techSemiData from '../data/techSemiData.json';

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

const BENCH_KEYS = ['sox', 'star50', 'chip_etf'] as const;
const CHART_SERIES = [
  { key: 'sox', name: 'SOX 费半', color: '#38bdf8', width: 2.2 },
  { key: 'star50', name: '科创50', color: '#facc15', width: 1.8 },
  { key: 'chip_etf', name: '中证半导体ETF', color: '#4ade80', width: 1.8 },
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
    'anomalies' | 'leverage' | 'fundamental' | 'signal' | 'timeline' | 'risks'
  > & {
    anomalies?: { note: string; items: Anomaly[] };
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

  const [yy, mm, dd] = snapshot.slice(0, 10).split('-');
  const snapDate = `${yy}年${mm}月${dd}日 ${snapshot.slice(11, 16)}`;
  const chgCls = (c: string) => (c === 'up' ? ' up' : c === 'down' ? ' down' : '');

  const benches = BENCH_KEYS.map((key) => benchMap[key]).filter((item): item is Bench => Boolean(item));
  const share = crowding?.turnoverShare?.value ?? 0;
  const chipDown = benchMap.chip_etf?.chgClass === 'down';
  const tone = crowdTone(share, chipDown);
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
        <h2 className="sec-title">
          先行异动雷达
          <span className="hint">大跌前要看的足迹。没有核实过的数，这里留空</span>
        </h2>
        <div className="anomaly-grid">
          {(data.anomalies?.items ?? []).map((item) => (
            <div className="card real-crowd-card" key={item.k}>
              <div className="real-crowd-head">
                <span className="real-crowd-title">{item.k}</span>
                <span className={`crowd-badge ${item.zone}`}>{item.status === 'pending' ? '未接入 · 还没有可引用的披露' : item.v}</span>
              </div>
              <div className="real-crowd-desc">{item.metric}</div>
              <div className="real-crowd-detail">{item.watch}</div>
            </div>
          ))}
        </div>
        {data.anomalies?.note && <div className="sec-note">{data.anomalies.note}</div>}

        <h2 className="sec-title" style={{ marginTop: 28 }}>
          拥挤度与杠杆
          <span className="hint">TMT 成交占比，以及全市场融资买入占比</span>
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
              全市场融资买入占比
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
          <span className="hint">费半、科创50、中证半导体 ETF</span>
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
          <div className="chart-title">费半、科创50、中证半导体 ETF（近半年累计涨跌，起点为 0）</div>
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
                <div className="sig-item up" key={b.k || i}>
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
                <div className="sig-item down" key={b.k || i}>
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
                        <ArrowUpRight size={15} strokeWidth={1.75} />
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
                    <i className={r.level === 'high' ? 'r' : r.level === 'med' ? 'y' : 'n'} />
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
