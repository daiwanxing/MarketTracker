import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import oilData from '../data/oilData.json';
import heroOil from '../assets/hero-oil.jpg';
import { useReveal } from '../hooks/useReveal';

const MONO = "ui-monospace, 'SF Mono', Consolas, monospace";
const DISPLAY = "'Barlow Condensed', 'Arial Narrow', Arial, sans-serif";

function oilQuoteLine(quotes: { wti?: number; dxy?: number } | undefined): string {
  if (!quotes) return '';
  const parts: string[] = [];
  if (typeof quotes.wti === 'number') parts.push(`WTI ${quotes.wti.toFixed(2)}`);
  if (typeof quotes.dxy === 'number') parts.push(`DXY ${quotes.dxy.toFixed(2)}`);
  return parts.join(' · ');
}

export default function OilPanel() {
  const tlRef = useReveal<HTMLDivElement>();
  const newsRef = useReveal<HTMLDivElement>();
  const riskRef = useReveal<HTMLDivElement>();
  const { metrics, signal, charts, timeline, news, risks, footer, snapshot, timelineTitle, newsTitle, risksTitle } = oilData;
  const [yy, mm, dd] = snapshot.slice(0, 10).split('-');
  const snapDate = `${yy}年${mm}月${dd}日 ${snapshot.slice(11, 16)}`; // 2026-09-22 15:15 → 2026年09月22日 15:15

  const mainOpt: EChartsOption = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(0,0,0,0.88)',
      borderColor: 'rgba(240,240,250,0.35)',
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: '#f0f0fa', fontFamily: DISPLAY, fontSize: 12 },
    },
    legend: {
      top: 2,
      itemWidth: 16,
      itemHeight: 3,
      textStyle: { color: 'rgba(240,240,250,0.85)', fontFamily: DISPLAY, fontSize: 12 },
    },
    grid: { left: 52, right: 16, top: 44, bottom: 30 },
    xAxis: {
      type: 'category',
      data: charts.dates,
      axisLine: { lineStyle: { color: 'rgba(240,240,250,0.25)' } },
      axisTick: { show: false },
      axisLabel: { color: 'rgba(240,240,250,0.6)', fontFamily: MONO, fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      scale: true,
      splitLine: { lineStyle: { color: 'rgba(240,240,250,0.12)' } },
      axisLabel: { color: 'rgba(240,240,250,0.6)', fontFamily: MONO, fontSize: 11 },
    },
    series: [
      {
        name: 'WTI',
        type: 'line',
        data: charts.wti,
        showSymbol: false,
        lineStyle: { color: '#f0f0fa', width: 1.8 },
        itemStyle: { color: '#f0f0fa' },
        emphasis: { focus: 'series' },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: 'rgba(240,240,250,0.35)', type: 'dashed' },
          label: {
            color: 'rgba(240,240,250,0.55)',
            fontFamily: MONO,
            fontSize: 10,
            formatter: `HIGH {c} · ${charts.wtiHigh}`,
          },
          data: [{ yAxis: charts.wtiHigh }],
        },
      },
      {
        name: '布伦特',
        type: 'line',
        data: charts.brent,
        showSymbol: false,
        connectNulls: true,
        lineStyle: { color: '#FF6B6B', width: 1.8 },
        itemStyle: { color: '#FF6B6B' },
        emphasis: { focus: 'series' },
      },
    ],
  };

  const quoteLine = oilQuoteLine(metrics.main.quotes);
  const chgCls = (c: string) => (c === 'up' ? ' up' : c === 'down' ? ' down' : '');
  const DIM: Record<string, string> = {
    supply: '供需',
    stocks: '库存',
    demand: '需求',
    macro: '宏观',
    geo: '地缘',
    freight: '运费',
  };
  const dimOf = (dim?: string) => (dim && DIM[dim] ? DIM[dim] : '');

  return (
    <article>
      <header className="hero">
        <img className="hero-bg" src={heroOil} alt="Preemraff 炼油厂 · 蓝调时刻（W.carter / CC BY-SA 4.0）" />
        <span className="hero-scrim" aria-hidden="true" />
        <div className="hero-inner">
          <div className="hero-main">
            <div className="kicker">THEME 01 · CRUDE OIL</div>
            <h1>原油行情</h1>
            <p className="hero-lead">以 ICE Brent 布伦特原油为核心：供需、库存、宏观金融与地缘事件驱动的行情信号与热点新闻。</p>
          </div>
          <div className="hero-aside">
            <span className="hero-chip">CRUDE · ICE BRENT</span>
            <span className="hero-meta"><b>最后更新：{snapDate}</b></span>
            <span className="hero-credit">影像 · W.carter / Preemraff 炼油厂（布罗峡湾）/ CC BY-SA 4.0 / 维基共享资源</span>
          </div>
        </div>
      </header>

      <div className="content">
      {/* 核心指标 */}
      <h2 className="sec-title">
        {metrics.secTitle}
      </h2>
      <div className="card metrics">
        <div className="metric-main">
          <div className="price-row">
            <div className="num">{metrics.main.num.startsWith('$') ? metrics.main.num : `$${metrics.main.num}`}</div>
            {metrics.main.chg && (
              <span className={`chg ${chgCls(metrics.main.chgClass)}`}>
                {metrics.main.chg}
              </span>
            )}
          </div>
          <div className="lbl">{metrics.main.label}</div>
          <div className="src-lbl">{metrics.main.src}</div>
          {(quoteLine || metrics.main.refs) && (
            <div className="refs">
              {quoteLine && <span className="quote-slots">{quoteLine}</span>}
              {metrics.main.refs && <span className="refs-note">{metrics.main.refs}</span>}
            </div>
          )}
        </div>
      </div>

      {/* 方向信号 */}
      <h2 className="sec-title">
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
            <div className="col-h up">
              <i aria-hidden="true" />
              {signal.bullTitle}
              <span>{signal.bullHint}</span>
            </div>
            {signal.bull.slice(0, 3).map((b, i) => (
              <div className="sig-item up" key={i}>
                <i aria-hidden="true" />
                <span className="k">{b.k}</span>
                {dimOf(b.dim) && <span className="dim">{dimOf(b.dim)}</span>}
                <span className="v">{b.v}</span>
              </div>
            ))}
          </div>
          <div className="sig-col">
            <div className="col-h down">
              <i aria-hidden="true" />
              {signal.bearTitle}
              <span>{signal.bearHint}</span>
            </div>
            {signal.bear.slice(0, 3).map((b, i) => (
              <div className="sig-item down" key={i}>
                <i aria-hidden="true" />
                <span className="k">{b.k}</span>
                {dimOf(b.dim) && <span className="dim">{dimOf(b.dim)}</span>}
                <span className="v">{b.v}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="sig-watch">
          <b>中性 / 待观察 ·</b> {signal.watch}
        </div>
      </div>

      {/* 价格走势 */}
      <h2 className="sec-title">
        {charts.secTitle}
        <span className="hint">{charts.secHint}</span>
      </h2>
      <div className="charts">
        <div className="card chart-panel">
          <div className="legend">
            <span>
              <i style={{ background: '#f0f0fa' }} />WTI
            </span>
            <span>
              <i style={{ background: '#FF6B6B' }} />布伦特
            </span>
          </div>
          <ReactECharts option={mainOpt} style={{ height: 320, width: '100%' }} notMerge lazyUpdate />
        </div>
      </div>

      {/* 时间轴 */}
      <h2 className="sec-title">
        {timelineTitle}
      </h2>
      <div className="tl" ref={tlRef}>
        {timeline.slice(0, 10).map((n, i) => (
          <div className={n.hot ? 'node hot' : 'node'} key={i}>
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

      {/* 最新要闻 */}
      <h2 className="sec-title">
        {newsTitle}
      </h2>
      <div className="card news" ref={newsRef}>
        {news.slice(0, 5).map((n, i) => (
          <a className="nrow" key={i} href={n.url} target="_blank" rel="noopener noreferrer">
            <span className="n-src">{n.src}</span>
            <span className="n-t">{n.title}</span>
            <span className="n-date">{n.date}</span>
            <span className="n-go">↗</span>
          </a>
        ))}
      </div>

      {/* 供应风险 */}
      <h2 className="sec-title">
        {risksTitle}
      </h2>
      <div className="risks" ref={riskRef}>
        {risks.map((r, i) => (
          <div className="card rcard" key={i}>
            <div className="rk">
              <i className={r.level} aria-hidden="true" />
              {r.k}
            </div>
            <p>{r.desc}</p>
            <div className="src">{r.src}</div>
          </div>
        ))}
      </div>

      <footer className="src">
        {footer}
      </footer>
      </div>
    </article>
  );
}
