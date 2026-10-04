import { useMemo } from 'react';
import { orderBy } from 'lodash-es';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import ensoData from '../data/ensoData.json';
import heroEnso from '../assets/hero-enso.jpg';
import { useReveal } from '../hooks/useReveal';

const MONO = "ui-monospace, 'SF Mono', Consolas, monospace";
const DISPLAY = "'Barlow Condensed', 'Arial Narrow', Arial, sans-serif";

function signed(value: number, digits: number): string {
  const text = value.toFixed(digits);
  return `${value > 0 ? '+' : ''}${text}°C`;
}

function fileName(url: string): string {
  const name = url.split('/').pop();
  return name || url;
}

function CpcNumbers() {
  const { cpc } = ensoData;
  const trad = cpc.traditional;
  const rel = cpc.relative;
  return (
    <>
      <div className="cpc-grid">
        <div className="card cpc-card trad">
          <div className="family">传统指标 traditional (NOAA)</div>
          <div className="cpc-row">
            <span className="k">周 Niño3.4</span>
            <span className="num">{signed(trad.weekly.nino34, 1)}</span>
            <span className="meta">中心日 {trad.weekly.centerDate} · 海温 {trad.weekly.nino34Sst.toFixed(1)}°C · {fileName(trad.weekly.sourceUrl)}</span>
          </div>
          <div className="cpc-row">
            <span className="k">月 Niño3.4</span>
            <span className="num">{signed(trad.monthly.nino34, 2)}</span>
            <span className="meta">{trad.monthly.year}年{trad.monthly.month}月 · {fileName(trad.monthly.sourceUrl)}</span>
          </div>
          <div className="cpc-row">
            <span className="k">ONI 海温距平</span>
            <span className="num">{signed(trad.oni.value, 2)}</span>
            <span className="meta">{trad.oni.season} {trad.oni.year} · {fileName(trad.oni.sourceUrl)}</span>
          </div>
        </div>
        <div className="card cpc-card rel">
          <div className="family">相对动力 relative (剔除背景变暖)</div>
          <div className="cpc-row">
            <span className="k">周 Niño3.4</span>
            <span className="num">{signed(rel.weekly.nino34, 1)}</span>
            <span className="meta">中心日 {rel.weekly.centerDate} · {fileName(rel.weekly.sourceUrl)}</span>
          </div>
          <div className="cpc-row">
            <span className="k">月 Niño3.4</span>
            <span className="num">{signed(rel.monthly.nino34, 2)}</span>
            <span className="meta">{rel.monthly.year}年{rel.monthly.month}月 · {fileName(rel.monthly.sourceUrl)}</span>
          </div>
          <div className="cpc-row">
            <span className="k">Rnino34</span>
            <span className="num">{signed(rel.rnino34.value, 2)}</span>
            <span className="meta">{rel.rnino34.year}年{rel.rnino34.month}月 · {fileName(rel.rnino34.sourceUrl)}</span>
          </div>
          <div className="cpc-row">
            <span className="k">RONI 相对距平</span>
            <span className="num">{signed(rel.roni.value, 2)}</span>
            <span className="meta">{rel.roni.season} {rel.roni.year} · {fileName(rel.roni.sourceUrl)}</span>
          </div>
        </div>
      </div>
      <p className="cpc-asof">CPC 遥测截至 {cpc.asOf}。传统与相对指数分属不同物理动力模型，不可直接相减。</p>
    </>
  );
}

export default function EnsoPanel() {
  const chartRef = useReveal<HTMLDivElement>();
  const chokepointRef = useReveal<HTMLDivElement>();
  const crossAssetRef = useReveal<HTMLDivElement>();
  const softRef = useReveal<HTMLDivElement>();
  const lagRef = useReveal<HTMLDivElement>();
  const tlRef = useReveal<HTMLDivElement>();

  const {
    head, metrics, physicalRadar, chokepoints, crossAsset,
    softCommodities, transmissionLag, timeline, timelineTitle,
    timelineHint, footer, lastUpdated,
  } = ensoData;

  const sortedTimeline = useMemo(() => {
    return orderBy(timeline || [], ['date'], ['desc']).slice(0, 10);
  }, [timeline]);

  // ECharts Option: Multi-Cycle Super El Niño Comparison
  const superElNinoOpt: EChartsOption = useMemo(() => {
    return {
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
        itemWidth: 14,
        itemHeight: 3,
        textStyle: { color: 'rgba(240,240,250,0.85)', fontFamily: DISPLAY, fontSize: 11 },
        data: ['1997/98 超级周期', '2015/16 历史峰值', '2023/24 强厄尔尼诺', '2026/27 当前轨迹'],
      },
      grid: { left: 44, right: 16, top: 40, bottom: 28 },
      xAxis: {
        type: 'category',
        data: physicalRadar.months,
        axisLine: { lineStyle: { color: 'rgba(240,240,250,0.25)' } },
        axisTick: { show: false },
        axisLabel: { color: 'rgba(240,240,250,0.6)', fontFamily: MONO, fontSize: 10.5 },
      },
      yAxis: {
        type: 'value',
        scale: true,
        splitLine: { lineStyle: { color: 'rgba(240,240,250,0.1)' } },
        axisLabel: {
          color: 'rgba(240,240,250,0.6)',
          fontFamily: MONO,
          fontSize: 10.5,
          formatter: (v: number) => `+${v.toFixed(1)}°`,
        },
      },
      series: [
        {
          name: '1997/98 超级周期',
          type: 'line',
          data: physicalRadar.cycles.cycle1997,
          showSymbol: false,
          lineStyle: { color: '#9b59b6', width: 1.5, type: 'dashed' },
          itemStyle: { color: '#9b59b6' },
        },
        {
          name: '2015/16 历史峰值',
          type: 'line',
          data: physicalRadar.cycles.cycle2015,
          showSymbol: false,
          lineStyle: { color: '#f39c12', width: 1.5, type: 'dashed' },
          itemStyle: { color: '#f39c12' },
        },
        {
          name: '2023/24 强厄尔尼诺',
          type: 'line',
          data: physicalRadar.cycles.cycle2023,
          showSymbol: false,
          lineStyle: { color: '#3498db', width: 1.5 },
          itemStyle: { color: '#3498db' },
        },
        {
          name: '2026/27 当前轨迹',
          type: 'line',
          data: physicalRadar.cycles.cycle2026,
          showSymbol: true,
          symbolSize: 6,
          lineStyle: { color: '#ff6b6b', width: 2.8 },
          itemStyle: { color: '#ff6b6b' },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: 'rgba(255, 107, 107, 0.45)', type: 'dashed' },
            label: {
              color: 'rgba(240,240,250,0.65)',
              fontFamily: MONO,
              fontSize: 10,
              formatter: '极强红线 +2.0°C',
            },
            data: [{ yAxis: 2.0 }],
          },
        },
      ],
    };
  }, [physicalRadar]);

  return (
    <article>
      {/* 1. Header / Hero */}
      <header className="hero">
        <img className="hero-bg" src={heroEnso} alt="赤道太平洋海温距平遥测" />
        <span className="hero-scrim" aria-hidden="true" />
        <div className="hero-inner">
          <div className="hero-main">
            <div className="kicker">{head.kicker}</div>
            <h1>{head.title}</h1>
            <p className="hero-lead">{head.sub}</p>
          </div>
          <div className="hero-aside">
            <span className="hero-meta"><b>最后更新：{lastUpdated}</b></span>
          </div>
        </div>
      </header>

      <div className="content">
        {/* 2. Key Metrics Grid */}
        <div className="enso-metrics-grid">
          {metrics.map((m) => (
            <div className="enso-m-item" key={m.label}>
              <div className="m-lbl">{m.label}</div>
              <div className={`m-val ${m.tone}`}>{m.val}</div>
              <div className="m-meta">{m.meta}</div>
            </div>
          ))}
        </div>

        {/* 3. Module 1: Physical Climate Engine & Super El Nino Overlay */}
        <h2 className="sec-title">
          {physicalRadar.secTitle}
          <span className="hint">{physicalRadar.hint}</span>
        </h2>
        <div className="chart-split-grid" ref={chartRef}>
          <div className="card" style={{ padding: '16px 18px' }}>
            <ReactECharts
              option={superElNinoOpt}
              style={{ height: '310px', width: '100%' }}
              opts={{ renderer: 'canvas' }}
            />
          </div>
          <div className="telemetry-list">
            {physicalRadar.telemetry.map((t) => (
              <div className="telemetry-item" key={t.name}>
                <div className="t-head">
                  <span className="name">{t.name}</span>
                  <span className="val">{t.value}</span>
                </div>
                <p className="desc">{t.desc}</p>
              </div>
            ))}
          </div>
        </div>
        <CpcNumbers />

        {/* 4. Module 2: Panama Canal Chokepoint Sentinel */}
        <h2 className="sec-title">
          {chokepoints.secTitle}
          <span className="hint">{chokepoints.hint}</span>
        </h2>
        <div className="chokepoint-container" ref={chokepointRef}>
          <div className="gauge-bar-wrapper">
            <div className="gauge-labels">
              <span>当前加通湖水位: <b>{chokepoints.gatunLevel} ft</b></span>
              <span>干旱严重警戒线: <b>{chokepoints.alertLevel} ft</b></span>
              <span>正常航运标准: <b>{chokepoints.normalLevel} ft</b></span>
            </div>
            <div className="gauge-track">
              <div
                className="gauge-fill"
                style={{
                  width: `${Math.min(100, Math.max(0, ((chokepoints.gatunLevel - 70) / (chokepoints.normalLevel - 70)) * 100))}%`,
                }}
              />
            </div>
          </div>
          <div className="chokepoint-grid">
            {chokepoints.indicators.map((ind) => (
              <div className="cp-col" key={ind.label}>
                <div className="k">{ind.label}</div>
                <div className="v">{ind.value}</div>
                <div className="s">{ind.sub}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 5. Module 3: 4D Cross-Asset Transmission Matrix */}
        <h2 className="sec-title">
          {crossAsset.secTitle}
          <span className="hint">{crossAsset.hint}</span>
        </h2>
        <div className="tech-grid" ref={crossAssetRef}>
          {crossAsset.sectors.map((sec) => (
            <div className="t-item" key={sec.category} style={{ borderLeft: `3px solid var(--${sec.tone === 'r' ? 'red' : sec.tone === 'g' ? 'green' : 'amber'})` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
                <b style={{ fontSize: '15px' }}>{sec.category}</b>
                <span style={{ fontFamily: MONO, fontSize: '11px', color: `var(--${sec.tone === 'r' ? 'red' : sec.tone === 'g' ? 'green' : 'amber'})` }}>
                  {sec.tag}
                </span>
              </div>
              <span style={{ fontSize: '13px', lineHeight: '1.65', color: 'var(--text-dim)', marginBottom: '10px' }}>
                {sec.summary}
              </span>
              <div className="src" style={{ marginTop: 'auto', borderTop: '1px solid var(--line)', paddingTop: '8px' }}>
                <b>监测核心标的：</b>{sec.assets}
              </div>
            </div>
          ))}
        </div>

        {/* 6. Module 4: Soft Commodities & Industrial Ag Specialties */}
        <h2 className="sec-title">
          {softCommodities.secTitle}
          <span className="hint">{softCommodities.hint}</span>
        </h2>
        <div className="soft-cards-grid" ref={softRef}>
          {softCommodities.cards.map((c) => (
            <div className="soft-card" key={c.name}>
              <div className="sc-top">
                <div className="sc-title-row">
                  <h4>{c.name}</h4>
                  <span className="sc-bias">{c.bias}</span>
                </div>
                <div className="sc-concentration">{c.concentration}</div>
                {'balance' in c && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px', margin: '8px 0 10px', background: 'color-mix(in oklch, var(--text) 3%, transparent)', padding: '8px 12px', border: '1px solid var(--line)' }}>
                    <div>
                      <span style={{ fontSize: '10.5px', color: 'var(--text-faint)', display: 'block' }}>26/27 供需平衡表缺口</span>
                      <b style={{ fontFamily: MONO, fontSize: '11.5px', color: 'var(--red)' }}>{(c as Record<string, string>).balance}</b>
                    </div>
                    <div>
                      <span style={{ fontSize: '10.5px', color: 'var(--text-faint)', display: 'block' }}>全球库存分位</span>
                      <b style={{ fontFamily: MONO, fontSize: '11.5px', color: 'var(--amber)' }}>{(c as Record<string, string>).stocks}</b>
                    </div>
                  </div>
                )}
                {'market' in c && (
                  <div style={{ marginBottom: '8px', fontFamily: MONO, fontSize: '11px', color: 'var(--text-dim)' }}>
                    <b>盘面行情与区间：</b>{(c as Record<string, string>).market}
                  </div>
                )}
                <p className="sc-dynamics">{c.dynamics}</p>
              </div>
              <div className="sc-catalyst">
                <b>关键催化观测：</b>{c.catalyst}
              </div>
            </div>
          ))}
        </div>

        {/* 7. Module 5: Biological & Logistics Lag Timeline */}
        <h2 className="sec-title">
          {transmissionLag.secTitle}
          <span className="hint">{transmissionLag.hint}</span>
        </h2>
        <div className="lag-timeline-stepper" ref={lagRef}>
          {transmissionLag.phases.map((p) => (
            <div className="lag-step" key={p.stage}>
              <div className="step-badge">{p.stage}</div>
              <div className="step-name">{p.name}</div>
              <p className="step-desc">{p.detail}</p>
            </div>
          ))}
        </div>

        {/* 8. Module 6: Global Frontline Supply Chain & News Feed */}
        <h2 className="sec-title">
          {timelineTitle}
          <span className="hint">{timelineHint}</span>
        </h2>
        <div className="tl" ref={tlRef}>
          {sortedTimeline.map((n, i) => (
            <div className={`node ${i === 0 ? 'latest' : ''}`} key={`${n.date}-${n.tag}-${i}`}>
              <div className="dot" />
              <div className="tags">
                <span className="date">{n.date}</span>
                <span className="tag">{n.tag}</span>
              </div>
              <div className="d">{n.body}</div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <footer className="src">{footer}</footer>
      </div>
    </article>
  );
}
