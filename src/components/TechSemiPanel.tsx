import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
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

const BENCH_KEYS = ['sox', 'star50', 'chip_etf'] as const;
const CHART_SERIES = [
  { key: 'sox', name: 'SOX 费半', color: '#38bdf8', width: 2.2 },
  { key: 'star50', name: '科创50', color: '#facc15', width: 1.8 },
  { key: 'chip_etf', name: '中证半导体ETF', color: '#4ade80', width: 1.8 },
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

function macroVerdict(
  benches: Bench[],
  paths: { name: string; last: number }[],
  share: number,
  tone: { label: string; note: string },
  margin: { value?: number; v?: string } | undefined,
  capex: string | undefined,
) {
  const parts: string[] = [];
  if (benches.length) parts.push(`当天${benches.map((b) => `${b.name} ${b.chg}`).join('，')}。`);
  if (paths.length) {
    parts.push(
      `近半年累计（起点为 0）：${paths
        .map((p) => `${p.name}${p.last >= 0 ? '还在起点上方' : '已经跌回起点下方'}（${p.last > 0 ? '+' : ''}${p.last.toFixed(1)}%）`)
        .join('，')}。`,
    );
  }
  if (share) parts.push(`成交占比 ${share.toFixed(2)}%，${tone.label}。${tone.note}`);
  if (typeof margin?.value === 'number') parts.push(`全市场融资买入占比 ${margin.value.toFixed(2)}%，${margin.v ?? ''}。`);
  if (capex) parts.push(`四大云厂商资本开支：${capex}。`);
  return parts.join('');
}

export default function TechSemiPanel() {
  const data = techSemiData as typeof techSemiData & {
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
        <img className="hero-bg" src={heroSemi} alt="12 英寸微电子硅晶圆 · 现代芯片制造（DrHughManning / CC BY-SA 4.0）" />
        <span className="hero-scrim" aria-hidden="true" />
        <div className="hero-inner">
          <div className="hero-main">
            <div className="kicker">{head.kicker}</div>
            <h1>{head.title}</h1>
            <p className="hero-lead">{head.sub}</p>
          </div>
          <div className="hero-aside">
            <span className="hero-chip">SEMIS · AI COMPUTE</span>
            <span className="hero-meta"><b>最后更新：{snapDate}</b></span>
            <span className="hero-credit">影像 · DrHughManning / 12 英寸微电子硅晶圆 / CC BY-SA 4.0 / 维基共享资源</span>
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
          {crowding && (
            <div className="card real-crowd-card">
              <div className="real-crowd-head">
                <span className="real-crowd-title">{crowding.turnoverShare.label}</span>
                <span className={`crowd-badge ${tone.zone}`}>{tone.label}</span>
              </div>
              <div className="real-crowd-num-row">
                <span className="real-crowd-val num">{crowding.turnoverShare.value}</span>
                <span className="real-crowd-unit">%</span>
              </div>
              <div className="gauge-track" aria-hidden="true">
                <div className={`gauge-fill ${tone.zone}`} style={{ width: `${Math.max(4, Math.min(100, (share / 50) * 100))}%` }} />
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
          云厂商开支
          <span className="hint">最近一季是加速、持平还是下调。没有已发布材料就不填</span>
        </h2>
        <div className="base-grid">
          {(data.fundamental?.items ?? [])
            .filter((item) => item.k === '四大 CSP 资本开支')
            .map((item) => (
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

        <h2 className="sec-title" style={{ marginTop: 28 }}>
          研判
          <span className="hint">只引用本页已经展示的报价、累计涨跌、成交占比和融资买入</span>
        </h2>
        <div className="card signal">
          <div className="sig-verdict">
            <div className="v-main">
              {macroVerdict(
                benches,
                CHART_SERIES.flatMap((series) => {
                  const values = norm[series.key];
                  const last = Array.isArray(values) ? values[values.length - 1] : undefined;
                  return typeof last === 'number' ? [{ name: series.name, last }] : [];
                }),
                share,
                tone,
                data.leverage?.marginBuyShare,
                (data.fundamental?.items ?? []).find((item) => item.k === '四大 CSP 资本开支' && item.status !== 'pending')?.v,
              )}
            </div>
          </div>
        </div>

        <footer className="src">{footer}</footer>
      </div>
    </article>
  );
}
