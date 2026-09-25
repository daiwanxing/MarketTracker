import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import heroSemi from '../assets/hero-semi.jpg';
import techSemiData from '../data/techSemiData.json';
import { useReveal } from '../hooks/useReveal';

const MONO = "ui-monospace, 'SF Mono', Consolas, monospace";
const DISPLAY = "'Barlow Condensed', 'Arial Narrow', Arial, sans-serif";
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

export default function TechSemiPanel() {
  const tlRef = useReveal<HTMLDivElement>();
  const newsRef = useReveal<HTMLDivElement>();
  const riskRef = useReveal<HTMLDivElement>();

  const data = techSemiData as typeof techSemiData & {
    anomalies?: { note: string; items: Anomaly[] };
    leverage?: {
      note: string;
      marginBuyShare: Anomaly & {
        value?: number;
        asOf?: string;
        buyYi?: number;
        marketAmountYi?: number;
      };
    };
    fundamental?: { note: string; items: Anomaly[] };
  };
  const { head, benchmarks, crowding, signal, charts, timeline, news, risks, footer, snapshot } = data;
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
                <span className={`crowd-badge ${item.zone}`}>{item.v}</span>
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
          {data.leverage && (
            <div className="card real-crowd-card">
              <div className="real-crowd-head">
                <span className="real-crowd-title">{data.leverage.marginBuyShare.k}</span>
                <span className={`crowd-badge ${data.leverage.marginBuyShare.zone}`}>{data.leverage.marginBuyShare.v}</span>
              </div>
              {typeof data.leverage.marginBuyShare.value === 'number' ? (
                <>
                  <div className="real-crowd-num-row">
                    <span className="real-crowd-val num">{data.leverage.marginBuyShare.value}</span>
                    <span className="real-crowd-unit">%</span>
                  </div>
                  <div className="gauge-track" aria-hidden="true">
                    <div
                      className={`gauge-fill ${data.leverage.marginBuyShare.zone}`}
                      style={{ width: `${Math.max(4, Math.min(100, (data.leverage.marginBuyShare.value / 15) * 100))}%` }}
                    />
                  </div>
                  <div className="gauge-marks">
                    <span>7 平常起</span>
                    <span>9 平常上沿</span>
                  </div>
                  <div className="real-crowd-detail">
                    融资买入 {data.leverage.marginBuyShare.buyYi?.toLocaleString()} 亿 / 两市 {data.leverage.marginBuyShare.marketAmountYi?.toLocaleString()} 亿 · 截至 {data.leverage.marginBuyShare.asOf}
                  </div>
                </>
              ) : (
                <div className="real-crowd-desc">{data.leverage.marginBuyShare.metric}</div>
              )}
              <div className="real-crowd-detail">{data.leverage.marginBuyShare.watch}</div>
            </div>
          )}
        </div>
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
          产业底座
          <span className="hint">季度和月度。没有核实过的 Capex、交期和盈利修订不填数字</span>
        </h2>
        <div className="base-grid">
          {(data.fundamental?.items ?? []).map((item) => (
            <div className="card real-crowd-card" key={item.k}>
              <div className="real-crowd-head">
                <span className="real-crowd-title">{item.k}</span>
                <span className={`crowd-badge ${item.zone}`}>{item.v}</span>
              </div>
              <div className="real-crowd-desc">{item.metric}</div>
              <div className="real-crowd-detail">{item.watch}</div>
            </div>
          ))}
        </div>
        {data.fundamental?.note && <div className="sec-note">{data.fundamental.note}</div>}

        <h2 className="sec-title" style={{ marginTop: 28 }}>
          {signal.secTitle}
          <span className="hint">{signal.secHint}</span>
        </h2>
        <div className="card signal">
          <div className="sig-verdict">
            <div className="v-main">{signal.verdict}</div>
            <div className="v-sub">{signal.sub}</div>
          </div>
          <div className="sig-cols">
            <div className="sig-col">
              <div className="col-h up"><i aria-hidden="true" />{signal.bullTitle}</div>
              {signal.bull.map((b) => (
                <div className="sig-item up" key={b.k}>
                  <i aria-hidden="true" />
                  <span className="k">{b.k}</span>
                  <span className="v">{b.v}</span>
                </div>
              ))}
            </div>
            <div className="sig-col">
              <div className="col-h down"><i aria-hidden="true" />{signal.bearTitle}</div>
              {signal.bear.map((b) => (
                <div className="sig-item down" key={b.k}>
                  <i aria-hidden="true" />
                  <span className="k">{b.k}</span>
                  <span className="v">{b.v}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="sig-watch"><b>跟踪重点 · </b>{signal.watch}</div>
        </div>

        <h2 className="sec-title" style={{ marginTop: 28 }}>产业与事件时间轴</h2>
        <div className="tl" ref={tlRef}>
          {timeline.map((n) => (
            <div className={n.hot ? 'node hot' : 'node'} key={`${n.date}-${n.t}`}>
              <div className="dot" />
              <div className="tags">
                <span className="date">{n.date}</span>
                <span className="tag">{n.tag}</span>
              </div>
              <div className="t">{n.t}</div>
              <div className="d">{n.d}</div>
              <div className="src">{n.src}</div>
            </div>
          ))}
        </div>

        <h2 className="sec-title" style={{ marginTop: 28 }}>行业前沿要闻</h2>
        <div className="card news" ref={newsRef}>
          {news.map((n) => (
            <a className="nrow" key={n.url} href={n.url} target="_blank" rel="noopener noreferrer">
              <span className="n-src">{n.src}</span>
              <span className="n-t">{n.title}</span>
              <span className="n-date">{n.date}</span>
              <span className="n-go">↗</span>
            </a>
          ))}
        </div>

        <h2 className="sec-title" style={{ marginTop: 28 }}>产业周期与宏观风险</h2>
        <div className="risks" ref={riskRef}>
          {risks.map((r) => (
            <div className="card rcard" key={r.k}>
              <div className="rk"><i className={r.level} aria-hidden="true" />{r.k}</div>
              <p>{r.desc}</p>
              <div className="src">{r.src}</div>
            </div>
          ))}
        </div>

        <footer className="src">{footer}</footer>
      </div>
    </article>
  );
}
