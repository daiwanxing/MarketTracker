import { useState } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import goldData from '../data/goldData.json';
import heroGold from '../assets/hero-gold.jpg';

const MONO = "ui-monospace, 'SF Mono', Consolas, monospace";
const DISPLAY = "'Barlow Condensed', 'Arial Narrow', Arial, sans-serif";

const UP = '#FF6B6B';
const DOWN = '#4ADE80';
const GOLD = '#FFD700';
const AMBER = '#F5C542';

export default function GoldPanel() {
  const { metrics, tech, positioning, macro, etf, sentiment, action, footer, snapshot } = goldData;
  const [yy, mm, dd] = snapshot.slice(0, 10).split('-');
  const snapDate = `${yy}年${mm}月${dd}日 ${snapshot.slice(11, 16)}`;

  const chgCls = (c: string) => (c === 'up' ? ' up' : c === 'down' ? ' down' : '');
  const DIM: Record<string, string> = {
    rates: '利率',
    dollar: '美元',
    fed: '美联储',
    centralbank: '央行',
    geo: '地缘',
  };
  const dimOf = (dim?: string) => (dim && DIM[dim] ? DIM[dim] : '');

  /* ============ 1) 日K + 成交量 + 支撑/压力带（Tab 切换 5/30/90 日窗口） ============ */
  const [range, setRange] = useState<'5d' | '30d' | '90d'>('30d');
  const rangeLen = range === '5d' ? 5 : range === '30d' ? 30 : 91;
  const rangeLabel = range === '5d' ? '近 5 交易日' : range === '30d' ? '近 30 交易日' : '近 90 交易日 + 今日';
  const sliceCandles = tech.candles.slice(-rangeLen);
  const candleDates = sliceCandles.map((c) => c.d);
  const candleData = sliceCandles.map((c) => [c.o, c.c, c.l, c.h] as number[]);
  const volData = tech.volume.slice(-rangeLen).map((v, i) => {
    const c = sliceCandles[i];
    return { value: v, itemStyle: { color: c.c >= c.o ? UP : DOWN, opacity: 0.75 } };
  });

  const klineOpt: EChartsOption = {
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
        const k = list.find((p) => p.seriesName === '伦敦金');
        const v = k?.value;
        let kline = '';
        if (Array.isArray(v) && v.length >= 4) {
          const [o, c, l, h] = v as number[];
          const pctNum = ((c - o) / o) * 100;
          const pct = `${pctNum >= 0 ? '+' : ''}${pctNum.toFixed(2)}%`;
          const color = c >= o ? UP : DOWN;
          kline = `<span style="font-family:${MONO};font-size:11px;color:#f0f0fa">${date}</span><br/>`
            + `<b style="color:${color}">收 ${c.toFixed(2)}（${pct}）</b>`
            + `<span style="color:rgba(240,240,250,0.65)">　开 ${o.toFixed(2)}　高 ${h.toFixed(2)}　低 ${l.toFixed(2)}</span>`;
        }
        const vol = list.find((p) => p.seriesName === '成交量');
        const volTxt = vol && typeof vol.value === 'number' ? `<span style="color:rgba(240,240,250,0.55)">量 ${Number(vol.value).toLocaleString()} 手</span>` : '';
        return `${kline}<br/>${volTxt}`;
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
        axisLabel: { color: 'rgba(240,240,250,0.6)', fontFamily: MONO, fontSize: 10 },
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
        name: '伦敦金',
        type: 'candlestick',
        data: candleData,
        itemStyle: { color: UP, color0: DOWN, borderColor: UP, borderColor0: DOWN },
        markArea: {
          silent: true,
          data: [
            [
              {
                name: `SUPPORT ${tech.support[0]}-${tech.support[1]}`,
                yAxis: tech.support[0],
                itemStyle: { color: 'rgba(245,197,66,0.10)' },
                label: {
                  show: true,
                  position: 'insideTop',
                  color: AMBER,
                  fontFamily: MONO,
                  fontSize: 9,
                  formatter: `SUPPORT ${tech.support[0]}-${tech.support[1]}`,
                },
              },
              { yAxis: tech.support[1] },
            ],
            [
              {
                name: `RESISTANCE ${tech.resistance[0]}-${tech.resistance[1]}`,
                yAxis: tech.resistance[0],
                itemStyle: { color: 'rgba(255,107,107,0.07)' },
                label: {
                  show: true,
                  position: 'insideTop',
                  color: 'rgba(255,107,107,0.95)',
                  fontFamily: MONO,
                  fontSize: 9,
                  formatter: `RESISTANCE ${tech.resistance[0]}-${tech.resistance[1]}`,
                },
              },
              { yAxis: tech.resistance[1] },
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
    ],
  };

  /* ============ 2) CFTC 投机净多头历史分位 ============ */
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
                data: [{ name: '当前', coord: [lastPctIdx, positioning.pctValues[lastPctIdx] as number] as (string | number)[] }],
              }
            : undefined,
      },
    ],
  };

  /* ============ 3) SPDR 近 15 交易日净增减柱状图 ============ */
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

  /* ============ 4) 盈亏比现算 ============ */
  const rr = sentiment.riskReward;
  const downPx = rr.price - rr.support;
  const upPx = rr.resistance - rr.price;
  const rrRatio = (upPx / downPx).toFixed(1);

  return (
    <article>
      <header className="hero">
        <img className="hero-bg" src={heroGold} alt="金条堆叠 · Gold bullion bars（Stevebidmead / CC0）" />
        <span className="hero-scrim" aria-hidden="true" />
        <div className="hero-inner">
          <div className="hero-main">
            <div className="kicker">THEME 03 · GOLD</div>
            <h1>黄金行情</h1>
            <p className="hero-lead">伦敦金为现货定价核心、纽约金 COMEX 在价格发现上同样关键：市场价格、技术形态、持仓资金、宏观驱动与实物需求的综合追踪。</p>
          </div>
          <div className="hero-aside">
            <span className="hero-chip">XAU/USD · LBMA SPOT</span>
            <span className="hero-meta"><b>最后更新：{snapDate}</b></span>
            <span className="hero-credit">影像 · Stevebidmead / Gold bullion bars / CC0 公有领域 / 维基共享资源</span>
          </div>
        </div>
      </header>

      <div className="content">
        {/* 市场价格 */}
        <h2 className="sec-title">{metrics.secTitle}</h2>
        <div className="card metrics">
          <div className="metric-main">
            <div className="price-row">
              <div className="num">{metrics.main.num.startsWith('$') ? metrics.main.num : `$${metrics.main.num}`}</div>
              {metrics.main.chg && (
                <span className={`chg ${chgCls(metrics.main.chgClass)}`}>{metrics.main.chg}</span>
              )}
            </div>
            <div className="lbl">{metrics.main.label}</div>
            <div className="src-lbl">{metrics.main.src}</div>
            {metrics.main.refs && <div className="refs">{metrics.main.refs}</div>}
          </div>
        </div>

        {/* 价格形态与技术信号：日K + 成交量 + 支撑压力带（5/30/90 日 Tab 切换） */}
        <h2 className="sec-title">{tech.secTitle}</h2>
        <div className="card chart-panel">
          <div className="kline-head">
            <div className="chart-title">{rangeLabel} · 伦敦金日K（Candlestick）· 成交量（手）</div>
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
          <div className="legend">
            <span><i style={{ background: UP }} />阳线（涨）</span>
            <span><i style={{ background: DOWN }} />阴线（跌）</span>
            <span><i style={{ background: 'rgba(245,197,66,0.5)' }} />支撑带</span>
            <span><i style={{ background: 'rgba(255,107,107,0.5)' }} />压力带</span>
          </div>
          <ReactECharts option={klineOpt} style={{ height: 400, width: '100%' }} notMerge lazyUpdate />
        </div>

        {/* 盈亏比速览条 */}
        <div className="card rr-strip">
          <span className="rr-lbl">盈亏比速览</span>
          <span className="rr-item">距支撑 <b>{rr.support}</b> <em>{downPx.toFixed(0)} 美元</em></span>
          <span className="rr-item">距阻力 <b>{rr.resistance}</b> <em>{upPx.toFixed(0)} 美元</em></span>
          <span className="rr-item rr-key">盈亏比 <b>1:{rrRatio}</b></span>
          <span className="rr-item rr-stop">止损参考 <b>{rr.stop}</b> 下方</span>
        </div>

        <div className="tech-grid">
          <div className="t-item t-full"><b>趋势</b><span>{tech.trend}</span></div>
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
              <span className="v">{it.v}</span>
              <span className="g-src">{it.src}</span>
            </div>
          ))}
        </div>

        {/* ETF 与实物需求：SPDR 15 日净增减柱状图 */}
        <h2 className="sec-title">{etf.secTitle}</h2>
        <div className="card chart-panel">
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

        {/* 市场情绪与赔率：SSI + 盈亏比 */}
        <h2 className="sec-title">{sentiment.secTitle}</h2>
        <div className="sent-grid">
          <div className="card sent-card">
            <div className="sent-h">{sentiment.ssi.title}</div>
            <div className="ssi-main">
              <div className="ssi-num">{sentiment.ssi.longPct}<span>%</span></div>
              <div className={`ssi-level ${sentiment.ssi.level === '拥挤' ? 'crowded' : ''}`}>{sentiment.ssi.level}</div>
            </div>
            <div className="ssi-bar">
              <i style={{ width: `${sentiment.ssi.longPct}%` }} />
            </div>
            <div className="ssi-scale"><span>0% 散户空头占优</span><span>100% 散户多头占优</span></div>
            <p className="sent-hint">{sentiment.ssi.hint}</p>
            <div className="src">{sentiment.ssi.src}</div>
          </div>
          <div className="card sent-card">
            <div className="sent-h">{sentiment.riskReward.title}</div>
            <div className="rr-metrics">
              <div className="rr-cell">
                <b>{downPx.toFixed(0)}</b>
                <span>下行风险<br />现价 {rr.price.toFixed(2)} → 支撑 {rr.support}</span>
              </div>
              <div className="rr-cell">
                <b>{upPx.toFixed(0)}</b>
                <span>上行空间<br />阻力 {rr.resistance} ← 现价 {rr.price.toFixed(2)}</span>
              </div>
              <div className="rr-cell rr-ratio">
                <b>1:{rrRatio}</b>
                <span>盈亏比<br />上行 ÷ 下行</span>
              </div>
            </div>
            <p className="sent-hint">盈亏比 1:{rrRatio} 只比较现价到阻力 {rr.resistance}、到支撑 {rr.support} 的空间。跌破 {rr.stop} 则这组支撑失效。方向看下方行动准则，不由这个比值单独决定。</p>
            <div className="src">{sentiment.riskReward.src}</div>
          </div>
        </div>

        {/* 当前行动准则（Action Plan） */}
        <h2 className="sec-title">{action.secTitle}</h2>
        <div className="card verdict">
          <div className="v-main">{action.summary}</div>
        </div>
        <div className="plan-grid">
          {action.plans.map((p, i) => (
            <div className="card plan-card" key={i}>
              <div className="plan-h">
                <span>{p.who}</span>
                <em className={p.stance === '按兵不动' ? 'wait' : 'probe'}>{p.stance}</em>
              </div>
              <p>{p.action}</p>
            </div>
          ))}
        </div>

        <footer className="src">{footer}</footer>
      </div>
    </article>
  );
}
