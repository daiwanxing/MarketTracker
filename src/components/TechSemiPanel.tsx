import { useState } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import techSemiData from '../data/techSemiData.json';
import { useReveal } from '../hooks/useReveal';

const MONO = "ui-monospace, 'SF Mono', Consolas, monospace";
const DISPLAY = "'Barlow Condensed', 'Arial Narrow', Arial, sans-serif";

const UP = '#FF6B6B';
const DOWN = '#4ADE80';
const AMBER = '#F5C542';

export default function TechSemiPanel() {
  const tlRef = useReveal<HTMLDivElement>();
  const newsRef = useReveal<HTMLDivElement>();
  const riskRef = useReveal<HTMLDivElement>();

  const { head, benchmarks, crowdingProxy, crowding, signal, charts, roadmap, timeline, news, risks, footer, snapshot } = techSemiData;

  const [yy, mm, dd] = snapshot.slice(0, 10).split('-');
  const snapDate = `${yy}年${mm}月${dd}日 ${snapshot.slice(11, 16)}`;

  // Tab for ratio chart
  const [ratioTab, setRatioTab] = useState<'star50_csi300' | 'chip_sox'>('star50_csi300');

  const chgCls = (c: string) => (c === 'up' ? ' up' : c === 'down' ? ' down' : '');

  /* ============ 1) 全球半导体归一化对比图 (近 6 个月 % 收益) ============ */
  const normDates = charts.normalized.dates || [];
  const normalizedOpt: EChartsOption = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(0,0,0,0.92)',
      borderColor: 'rgba(240,240,250,0.35)',
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: '#f0f0fa', fontFamily: DISPLAY, fontSize: 12 },
      formatter: (params: unknown) => {
        const list = params as { seriesName?: string; axisValue?: string; value?: number; color?: string }[];
        if (!Array.isArray(list) || list.length === 0) return '';
        const date = list[0].axisValue ?? '';
        let html = `<span style="font-family:${MONO};font-size:11px;color:#f0f0fa">${date}（自基准累计涨跌）</span><br/>`;
        for (const item of list) {
          const val = typeof item.value === 'number' ? `${item.value >= 0 ? '+' : ''}${item.value.toFixed(2)}%` : '--';
          html += `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${item.color};margin-right:6px"></span>`
            + `<span style="font-family:${DISPLAY};color:rgba(240,240,250,0.7);font-size:12px">${item.seriesName}：</span>`
            + `<b style="font-family:${MONO};color:#f0f0fa;font-size:12px"> ${val}</b><br/>`;
        }
        return html;
      },
    },
    legend: {
      top: 0,
      itemWidth: 14,
      itemHeight: 3,
      textStyle: { color: 'rgba(240,240,250,0.85)', fontFamily: DISPLAY, fontSize: 11 },
    },
    grid: { left: 48, right: 16, top: 40, bottom: 26 },
    xAxis: {
      type: 'category',
      data: normDates,
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
    series: [
      {
        name: 'SOX 费半',
        type: 'line',
        data: charts.normalized.sox,
        showSymbol: false,
        lineStyle: { color: '#38bdf8', width: 2 },
        itemStyle: { color: '#38bdf8' },
      },
      {
        name: 'NDX 纳指100',
        type: 'line',
        data: charts.normalized.ndx,
        showSymbol: false,
        lineStyle: { color: '#818cf8', width: 1.5, type: 'dashed' },
        itemStyle: { color: '#818cf8' },
      },
      {
        name: 'TSM 台积电',
        type: 'line',
        data: charts.normalized.tsm,
        showSymbol: false,
        lineStyle: { color: '#fb923c', width: 1.8 },
        itemStyle: { color: '#fb923c' },
      },
      {
        name: '恒生科技(3033)',
        type: 'line',
        data: charts.normalized.hstech,
        showSymbol: false,
        lineStyle: { color: '#f43f5e', width: 1.5 },
        itemStyle: { color: '#f43f5e' },
      },
      {
        name: '科创50(588000)',
        type: 'line',
        data: charts.normalized.star50,
        showSymbol: false,
        lineStyle: { color: '#facc15', width: 1.8 },
        itemStyle: { color: '#facc15' },
      },
      {
        name: '芯片ETF(512480)',
        type: 'line',
        data: charts.normalized.chip_etf,
        showSymbol: false,
        lineStyle: { color: '#4ade80', width: 1.8 },
        itemStyle: { color: '#4ade80' },
      },
    ],
  };

  /* ============ 2) 跨市场比值走势图 (Ratio Chart) ============ */
  const activeRatioConfig = charts.ratios[ratioTab];
  const ratioDates = charts.ratios.dates || [];
  const ratioOpt: EChartsOption = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(0,0,0,0.92)',
      borderColor: 'rgba(240,240,250,0.35)',
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: '#f0f0fa', fontFamily: DISPLAY, fontSize: 12 },
      formatter: (params: unknown) => {
        const list = params as { seriesName?: string; axisValue?: string; value?: number }[];
        if (!Array.isArray(list) || list.length === 0) return '';
        const date = list[0].axisValue ?? '';
        const val = list[0].value !== undefined ? list[0].value : '--';
        return `<span style="font-family:${MONO};font-size:11px;color:#f0f0fa">${date}</span><br/>`
          + `<span style="color:rgba(240,240,250,0.7)">${activeRatioConfig.name}：</span>`
          + `<b style="font-family:${MONO};color:${AMBER};font-size:13px"> ${val}</b>`;
      },
    },
    grid: { left: 52, right: 16, top: 24, bottom: 26 },
    xAxis: {
      type: 'category',
      data: ratioDates,
      axisLine: { lineStyle: { color: 'rgba(240,240,250,0.25)' } },
      axisTick: { show: false },
      axisLabel: { color: 'rgba(240,240,250,0.6)', fontFamily: MONO, fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      scale: true,
      splitLine: { lineStyle: { color: 'rgba(240,240,250,0.1)' } },
      axisLabel: { color: 'rgba(240,240,250,0.6)', fontFamily: MONO, fontSize: 10 },
    },
    series: [
      {
        name: activeRatioConfig.name,
        type: 'line',
        data: activeRatioConfig.series,
        showSymbol: false,
        lineStyle: { color: AMBER, width: 2 },
        itemStyle: { color: AMBER },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(245,197,66,0.2)' },
              { offset: 1, color: 'rgba(245,197,66,0.01)' },
            ],
          },
        },
      },
    ],
  };

  const bmList = [
    benchmarks.sox,
    benchmarks.ndx,
    benchmarks.tsm,
    benchmarks.hstech,
    benchmarks.star50,
    benchmarks.csi300,
    benchmarks.chip_etf,
  ].filter(Boolean);

  return (
    <article>
      <header className="hero">
        <div className="semi-hero-bg" aria-hidden="true" />
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
            <span className="hero-credit">数据 · Yahoo Finance / 市场公开快照 / Asia/Shanghai</span>
          </div>
        </div>
      </header>

      <div className="content">
        {/* ============ 1) 核心基准与行情卡片 ============ */}
        <h2 className="sec-title">
          核心基准行情
          <span className="hint">全球与国内半导体关键标的实时/收盘快照</span>
        </h2>
        <div className="benchmarks-grid">
          {bmList.map((bm) => (
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

        {/* ============ 2) A 股 TMT 真实拥挤度指标 (Phase 2 MVP) ============ */}
        <h2 className="sec-title" style={{ marginTop: 28 }}>
          A 股 TMT 真实拥挤度指标 (Phase 2)
          <span className="hint">
            申万一级（电子/计算机/传媒/通信）全成分股微观实测 · 每日收盘后定时刷新 · 截至 {crowding ? crowding.asOf : snapshot.slice(0, 10)}
          </span>
        </h2>

        {crowding && (
          <>
            <div className="real-crowd-grid">
              {/* 卡片 1: TMT 成交额占比 */}
              <div className="card real-crowd-card">
                <div className="real-crowd-head">
                  <span className="real-crowd-title">{crowding.turnoverShare.label}</span>
                  <span className={`real-crowd-tag crowd-badge ${crowding.zone}`}>
                    {crowding.label}
                  </span>
                </div>
                <div className="real-crowd-num-row">
                  <span className="real-crowd-val num" style={{ color: crowding.zone === 'danger' ? UP : crowding.zone === 'warning' ? AMBER : 'var(--text)' }}>
                    {crowding.turnoverShare.value}
                  </span>
                  <span className="real-crowd-unit">{crowding.turnoverShare.unit}</span>
                </div>
                <div className="real-crowd-desc">{crowding.turnoverShare.desc}</div>
                <div className="real-crowd-detail">
                  TMT 成交：<b>{crowding.turnoverShare.tmtAmountYi.toLocaleString()}</b> 亿元 / 两市总额：<b>{crowding.turnoverShare.marketAmountYi.toLocaleString()}</b> 亿元
                </div>
              </div>

              {/* 卡片 2: Top 5% 成交集中度 */}
              <div className="card real-crowd-card">
                <div className="real-crowd-head">
                  <span className="real-crowd-title">{crowding.top5Concentration.label}</span>
                  <span className="real-crowd-tag">集中度</span>
                </div>
                <div className="real-crowd-num-row">
                  <span className="real-crowd-val num" style={{ color: AMBER }}>
                    {crowding.top5Concentration.value}
                  </span>
                  <span className="real-crowd-unit">{crowding.top5Concentration.unit}</span>
                </div>
                <div className="real-crowd-desc">{crowding.top5Concentration.desc}</div>
                <div className="real-crowd-detail">
                  头部 5%（前 {crowding.top5Concentration.top5Count} 只）成交：<b>{crowding.top5Concentration.top5AmountYi.toLocaleString()}</b> 亿元 / TMT 宇宙：{crowding.top5Concentration.totalTmtCount} 只
                </div>
              </div>

              {/* 卡片 3: 流通换手热度比率 */}
              <div className="card real-crowd-card">
                <div className="real-crowd-head">
                  <span className="real-crowd-title">{crowding.circulatingHeatRatio.label}</span>
                  <span className="real-crowd-tag">{crowding.circulatingHeatRatio.scopeLabel}</span>
                </div>
                <div className="real-crowd-num-row">
                  <span className="real-crowd-val num" style={{ color: '#38bdf8' }}>
                    {crowding.circulatingHeatRatio.value}
                  </span>
                  <span className="real-crowd-unit">{crowding.circulatingHeatRatio.unit}</span>
                </div>
                <div className="real-crowd-desc">{crowding.circulatingHeatRatio.desc}</div>
                <div className="real-crowd-detail">
                  TMT 成交额 <b>{crowding.turnoverShare.tmtAmountYi.toLocaleString()}</b> 亿元 / 流通市值合计 <b>{crowding.circulatingHeatRatio.tmtNmcYi.toLocaleString()}</b> 亿元
                </div>
              </div>
            </div>

            {/* 申万细分板块成交分布与 Top 标的 */}
            <div className="card sector-breakdown-card">
              <div className="sector-breakdown-title">
                <span>申万 TMT 四大一级行业成交拆解</span>
                <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-faint)', textTransform: 'none' }}>
                  {crowding.src}
                </span>
              </div>
              <div className="sector-pills">
                {Object.entries(crowding.sectorBreakdown).map(([key, sec]) => (
                  <div className="sector-pill" key={key}>
                    <div className="sector-pill-name">{sec.name}</div>
                    <div className="sector-pill-val num">{sec.amountYi.toLocaleString()} <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>亿元</span></div>
                    <div className="sector-pill-sub">
                      两市占比 <b>{sec.share}%</b> · 流通热度 <b>{sec.heatRatio}%</b> ({sec.count}只)
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 14 }}>
                <span style={{ fontSize: 11.5, color: 'var(--text-dim)', letterSpacing: 0.5 }}>
                  当日 TMT 成交额前十名龙头标的：
                </span>
                <div className="top-stocks-grid">
                  {crowding.topStocks.map((stk) => (
                    <div className="top-stock-chip" key={stk.code}>
                      <span className="top-stock-name">
                        <span style={{ color: 'var(--text-faint)', marginRight: 4 }}>{stk.code}</span>
                        {stk.name}
                      </span>
                      <span className="top-stock-amt num">{stk.amountYi}亿</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        {/* ============ 2.2) 动量与收益离散度辅助参考 (Phase 1 归档参考) ============ */}
        <details style={{ marginTop: 14, cursor: 'pointer' }}>
          <summary style={{ fontSize: 12, color: 'var(--text-faint)', fontFamily: MONO, padding: '4px 0' }}>
            ▶ 查看 Phase-1 动量与收益离散度代理指标（已降级为辅助参考）
          </summary>
          <div className="crowd-container" style={{ marginTop: 10 }}>
            <div className="card crowd-dial">
              <div className="crowd-score-row">
                <span className="crowd-score num">{crowdingProxy.score}</span>
                <span className="crowd-score-denom">/ 100</span>
                <span className={`crowd-badge ${crowdingProxy.zone}`}>{crowdingProxy.label}</span>
              </div>
              <div className="crowd-bar">
                <div
                  className={`crowd-bar-fill ${crowdingProxy.zone}`}
                  style={{ width: `${Math.max(4, Math.min(100, crowdingProxy.score))}%` }}
                />
              </div>
              <div className="crowd-scale">
                <span>0 冰点</span>
                <span>30 中性</span>
                <span>60 偏热</span>
                <span>80+ 过热</span>
              </div>
              <div className="crowd-note">
                {crowdingProxy.methodNote}（截至 {crowdingProxy.asOf}）
              </div>
            </div>

            <div className="crowd-metrics">
              <div className="card crowd-metric-cell">
                <span className="crowd-metric-val num" style={{ color: (crowdingProxy.cards.tmtTurnoverShare ?? 0) >= 0 ? UP : DOWN }}>
                  {crowdingProxy.cards.tmtTurnoverShare !== undefined ? `${crowdingProxy.cards.tmtTurnoverShare}%` : '--'}
                </span>
                <span className="crowd-metric-lbl">TMT 成交额占比 (Phase-2)</span>
              </div>
              <div className="card crowd-metric-cell">
                <span className="crowd-metric-val num" style={{ color: (crowdingProxy.cards.top5Concentration ?? 0) >= 0 ? UP : DOWN }}>
                  {crowdingProxy.cards.top5Concentration !== undefined ? `${crowdingProxy.cards.top5Concentration}%` : '--'}
                </span>
                <span className="crowd-metric-lbl">Top 5% 成交集中度</span>
              </div>
              <div className="card crowd-metric-cell">
                <span className="crowd-metric-val num" style={{ color: AMBER }}>
                  {crowdingProxy.cards.circulatingHeatRatio !== undefined ? `${crowdingProxy.cards.circulatingHeatRatio}%` : '--'}
                </span>
                <span className="crowd-metric-lbl">流通换手热度比率</span>
              </div>
            </div>
          </div>
        </details>

        {/* ============ 3) 走势对比与跨市场比值 ============ */}
        <h2 className="sec-title" style={{ marginTop: 28 }}>
          {charts.secTitle}
          <span className="hint">{charts.secHint}</span>
        </h2>
        <div className="charts" style={{ gap: 16 }}>
          {/* 标准化对比图 */}
          <div className="card chart-panel">
            <div className="chart-title">
              全球主要半导体基准标准化走势（近 ~6 个月累计百分比收益率）
            </div>
            <ReactECharts option={normalizedOpt} style={{ height: 320, width: '100%' }} notMerge lazyUpdate />
          </div>

          {/* 跨市场比值图 */}
          <div className="card chart-panel">
            <div className="kline-head">
              <div className="chart-title" style={{ padding: 0 }}>
                {activeRatioConfig.name} · <span style={{ color: 'var(--text-faint)' }}>{activeRatioConfig.hint}</span>
                {activeRatioConfig.latest !== null && (
                  <b style={{ color: AMBER, marginLeft: 8 }}>最新：{activeRatioConfig.latest}</b>
                )}
              </div>
              <div className="kline-tabs">
                <button
                  type="button"
                  className={ratioTab === 'star50_csi300' ? 'active' : ''}
                  onClick={() => setRatioTab('star50_csi300')}
                >
                  科创50 / 沪深300
                </button>
                <button
                  type="button"
                  className={ratioTab === 'chip_sox' ? 'active' : ''}
                  onClick={() => setRatioTab('chip_sox')}
                >
                  中证芯片 / SOX
                </button>
              </div>
            </div>
            <ReactECharts option={ratioOpt} style={{ height: 260, width: '100%' }} notMerge lazyUpdate />
          </div>
        </div>

        {/* ============ 4) 市场与产业信号 ============ */}
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
              <div className="col-h up">
                <i aria-hidden="true" />
                {signal.bullTitle}
                <span>{signal.bullHint}</span>
              </div>
              {signal.bull.map((b, i) => (
                <div className="sig-item up" key={i}>
                  <i aria-hidden="true" />
                  <span className="k">{b.k}</span>
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
              {signal.bear.map((b, i) => (
                <div className="sig-item down" key={i}>
                  <i aria-hidden="true" />
                  <span className="k">{b.k}</span>
                  <span className="v">{b.v}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="sig-watch">
            <b>跟踪重点 · </b>{signal.watch}
          </div>
          <div className="sig-note">{signal.note}</div>
        </div>

        {/* ============ 5) 迭代路线图 (Phase 1/2/3 诚实说明) ============ */}
        <h2 className="sec-title" style={{ marginTop: 28 }}>
          {roadmap.secTitle}
          <span className="hint">{roadmap.secHint}</span>
        </h2>
        <div className="roadmap-grid">
          {roadmap.phases.map((p, idx) => (
            <div className="card roadmap-card" key={idx}>
              <div className="roadmap-phase-head">
                <span className="roadmap-phase-title">{p.title}</span>
                <span className={`roadmap-phase-badge ${p.status}`}>{p.phase}</span>
              </div>
              <ul className="roadmap-list">
                {p.items.map((it, i) => (
                  <li key={i}>{it}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* ============ 6) 产业时间轴 ============ */}
        <h2 className="sec-title" style={{ marginTop: 28 }}>
          产业与事件时间轴
        </h2>
        <div className="tl" ref={tlRef}>
          {timeline.map((n, i) => (
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

        {/* ============ 7) 行业要闻 ============ */}
        <h2 className="sec-title" style={{ marginTop: 28 }}>
          行业前沿要闻
        </h2>
        <div className="card news" ref={newsRef}>
          {news.map((n, i) => (
            <a className="nrow" key={i} href={n.url} target="_blank" rel="noopener noreferrer">
              <span className="n-src">{n.src}</span>
              <span className="n-t">{n.title}</span>
              <span className="n-date">{n.date}</span>
              <span className="n-go">↗</span>
            </a>
          ))}
        </div>

        {/* ============ 8) 核心风险 ============ */}
        <h2 className="sec-title" style={{ marginTop: 28 }}>
          产业周期与宏观风险
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
