import { useState, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { clamp } from 'lodash-es';
import { useInterval } from 'ahooks';
import heroEquip from '../assets/hero-equip.jpg';
import equipData from '../data/equipData.json';
import { useLiveQuotes } from '../hooks/useLiveQuotes';
import { getBeijingTime, getStar50Status } from '../utils/marketClock';

const MONO = "ui-monospace, 'SF Mono', Consolas, monospace";
const DISPLAY = "'Barlow Condensed', 'Arial Narrow', Arial, sans-serif";

const UP = '#FF6B6B';
const DOWN = '#4ADE80';
const AMBER = '#F5C542';
const CYAN = '#38bdf8';
const MAVOL5_COLOR = '#fb923c';
const MAVOL20_COLOR = '#a855f7';

export default function EquipPanel() {
  const { head, benchmark, relativeStrength, tech, crowding, leaders, radar, footer } = equipData;
  const { liveQuotes } = useLiveQuotes();
  const equipQuotes = liveQuotes?.equip;

  const [currentTime, setCurrentTime] = useState(() => new Date());
  useInterval(() => {
    setCurrentTime(new Date());
  }, 30000);

  const starStatus = useMemo(() => {
    const bj = getBeijingTime(currentTime);
    return getStar50Status(bj);
  }, [currentTime]);

  const [range, setRange] = useState<'30d' | '60d' | '125d'>('60d');
  const rangeLen = range === '30d' ? 30 : range === '60d' ? 60 : 125;
  const rangeLabel = range === '30d' ? '近 30 交易日' : range === '60d' ? '近 60 交易日' : '近 125 交易日（半年）';

  const activeBenchmark = useMemo(() => {
    return {
      name: benchmark.name,
      symbol: benchmark.symbol,
      price: equipQuotes?.benchmark?.price ?? benchmark.price,
      chg: equipQuotes?.benchmark?.chg || benchmark.chg,
      chgClass: equipQuotes?.benchmark?.chgClass || benchmark.chgClass,
      role: benchmark.role,
      src: benchmark.src,
    };
  }, [benchmark, equipQuotes]);

  const sliceCandles = useMemo(() => (tech.candles || []).slice(-rangeLen), [tech.candles, rangeLen]);
  const candleDates = useMemo(() => sliceCandles.map((c) => c.d), [sliceCandles]);
  const candleData = useMemo(() => sliceCandles.map((c) => [c.o, c.c, c.l, c.h] as number[]), [sliceCandles]);
  const volData = useMemo(() => {
    const vols = (tech.volume || []).slice(-rangeLen);
    return vols.map((v, i) => {
      const c = sliceCandles[i];
      if (!c) return { value: v, itemStyle: { color: UP, opacity: 0.75 } };
      return {
        value: v,
        itemStyle: { color: c.c >= c.o ? UP : DOWN, opacity: 0.75 },
      };
    });
  }, [tech.volume, sliceCandles, rangeLen]);

  const fullCloses = useMemo(() => (tech.candles || []).map((c) => c.c), [tech.candles]);

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

  // 成交量 MAVOL5 与 MAVOL20 均线计算
  const sliceMAVOL5 = useMemo(() => {
    const vols = tech.volume || [];
    return vols.map((_, i) => {
      if (i < 4) return null;
      let sum = 0;
      for (let j = 0; j < 5; j++) sum += vols[i - j];
      return Math.round(sum / 5);
    }).slice(-rangeLen);
  }, [tech.volume, rangeLen]);

  const sliceMAVOL20 = useMemo(() => {
    const vols = tech.volume || [];
    return vols.map((_, i) => {
      if (i < 19) return null;
      let sum = 0;
      for (let j = 0; j < 20; j++) sum += vols[i - j];
      return Math.round(sum / 20);
    }).slice(-rangeLen);
  }, [tech.volume, rangeLen]);

  // 最新量能定性分析
  const volDiagnosis = useMemo(() => {
    const vols = tech.volume || [];
    if (!vols.length) return { label: '量能平稳', tagClass: 'normal' };
    const cur = vols[vols.length - 1];
    const last20 = sliceMAVOL20[sliceMAVOL20.length - 1] ?? cur;
    const last5 = sliceMAVOL5[sliceMAVOL5.length - 1] ?? cur;
    if (last20 && cur < last20 * 0.7) {
      return { label: '地量休整 · 筹码沉淀', tagClass: 'shrink' };
    }
    if (last5 && cur > last5 * 1.5) {
      return { label: '放量异动 · 主力博弈', tagClass: 'expand' };
    }
    return { label: '量能温和 · 均量平稳', tagClass: 'normal' };
  }, [tech.volume, sliceMAVOL20, sliceMAVOL5]);

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

  const latestPrice = activeBenchmark.price || (fullCloses.length ? fullCloses[fullCloses.length - 1] : 0);
  const pMA20 = parseFloat(currentMA20) || latestPrice || 1;
  const pMA60 = parseFloat(currentMA60) || latestPrice || 1;
  const biasMA20 = ((latestPrice / pMA20) - 1) * 100;
  const biasMA60 = ((latestPrice / pMA60) - 1) * 100;

  const klineOpt: EChartsOption = useMemo(() => {
    if (candleDates.length === 0) return {};
    const currSym = tech.currency || '¥';
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
          const k = list.find((p) => p.seriesName === tech.name);
          const v = k?.value;
          let kline = '';
          if (Array.isArray(v) && v.length >= 4) {
            const [o, c, l, h] = v as number[];
            const pctNum = ((c - o) / o) * 100;
            const pct = `${pctNum >= 0 ? '+' : ''}${pctNum.toFixed(2)}%`;
            const color = c >= o ? UP : DOWN;
            kline = `<span style="font-family:${MONO};font-size:11px;color:#f0f0fa">${date} · ${tech.name}</span><br/>`
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
          const mav5 = list.find((p) => p.seriesName === 'MAVOL5')?.value;
          const mav20 = list.find((p) => p.seriesName === 'MAVOL20')?.value;
          const volTxt = vol && typeof vol.value === 'number' ? `<span style="color:rgba(240,240,250,0.75)">成交量: ${Number(vol.value).toLocaleString()} 手/份</span>` : '';
          const mavTxt = [
            typeof mav5 === 'number' ? `<span style="color:${MAVOL5_COLOR}">VL5: ${Number(mav5).toLocaleString()}</span>` : '',
            typeof mav20 === 'number' ? `<span style="color:${MAVOL20_COLOR}">VL20: ${Number(mav20).toLocaleString()}</span>` : '',
          ].filter(Boolean).join('　');

          return `${kline}${maTxt ? `<br/>${maTxt}` : ''}<br/>${volTxt}${mavTxt ? `　${mavTxt}` : ''}`;
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
          name: tech.name,
          type: 'candlestick',
          data: candleData,
          itemStyle: { color: UP, color0: DOWN, borderColor: UP, borderColor0: DOWN },
          markArea: {
            silent: true,
            data: [
              [
                {
                  name: `支撑防守 ${tech.support[0]}-${tech.support[1]}`,
                  yAxis: tech.support[0],
                  itemStyle: { color: 'rgba(245,197,66,0.10)' },
                  label: {
                    show: true,
                    position: 'insideTop',
                    color: AMBER,
                    fontFamily: MONO,
                    fontSize: 9,
                    formatter: `支撑带 ${tech.support[0]}-${tech.support[1]} ${currSym}`,
                  },
                },
                { yAxis: tech.support[1] },
              ],
              [
                {
                  name: `压力颈线 ${tech.resistance[0]}-${tech.resistance[1]}`,
                  yAxis: tech.resistance[0],
                  itemStyle: { color: 'rgba(255,107,107,0.07)' },
                  label: {
                    show: true,
                    position: 'insideTop',
                    color: 'rgba(255,107,107,0.95)',
                    fontFamily: MONO,
                    fontSize: 9,
                    formatter: `压力区 ${tech.resistance[0]}-${tech.resistance[1]} ${currSym}`,
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
        {
          name: 'MAVOL5',
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: sliceMAVOL5,
          showSymbol: false,
          lineStyle: { color: MAVOL5_COLOR, width: 1.2, opacity: 0.9 },
          itemStyle: { color: MAVOL5_COLOR },
        },
        {
          name: 'MAVOL20',
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: sliceMAVOL20,
          showSymbol: false,
          lineStyle: { color: MAVOL20_COLOR, width: 1.2, opacity: 0.9 },
          itemStyle: { color: MAVOL20_COLOR },
        },
      ],
    };
  }, [candleDates, candleData, volData, sliceMA20, sliceMA60, sliceMAVOL5, sliceMAVOL20, tech]);

  const liveEquipCrowd = equipQuotes?.crowding;
  const effectiveCrowding = useMemo(() => {
    if (liveEquipCrowd) {
      return {
        ...crowding,
        turnoverShare: {
          ...crowding.turnoverShare,
          value: liveEquipCrowd.value,
          equipAmountYi: liveEquipCrowd.equipAmountYi,
          marketAmountYi: liveEquipCrowd.marketAmountYi,
        },
        zone: liveEquipCrowd.zone,
        label: liveEquipCrowd.label,
      };
    }
    return crowding;
  }, [crowding, liveEquipCrowd]);

  const crowdZone = effectiveCrowding.zone || 'neutral';
  const crowdLabel = effectiveCrowding.label || '温和活跃';

  // 联动前道核心三剑客的实时报价
  const activeLeaders = useMemo(() => {
    return leaders.map((leader) => {
      const live = equipQuotes?.leaders?.find((l) => l.symbol === leader.symbol);
      const price = live?.price ?? leader.price;
      const chg = live?.chg || leader.chg;
      const chgClass = live?.chgClass || leader.chgClass;
      return {
        ...leader,
        price,
        chg,
        chgClass,
      };
    });
  }, [leaders, equipQuotes?.leaders]);

  const priceDisplay = typeof activeBenchmark.price === 'number' ? activeBenchmark.price.toFixed(3) : '--';
  const chgClass = activeBenchmark.chgClass === 'up' ? 'up' : activeBenchmark.chgClass === 'down' ? 'down' : 'neutral';
  const statusClass = starStatus.status.toLowerCase();
  const statusLabel = starStatus.statusLabel;

  return (
    <article>
      {/* 1. 英雄主视觉区 */}
      <header className="hero">
        <img className="hero-bg" src={heroEquip} alt="半导体制造洁净室 · 微纳光刻步进机与前道核心设备" />
        <span className="hero-scrim" aria-hidden="true" />
        <div className="hero-inner">
          <div className="hero-main">
            <div className="kicker">{head.kicker}</div>
            <h1>{head.title}</h1>
            <p className="hero-lead">{head.sub}</p>
            <div className="hero-asof">
              <span className="asof-tag">截至 {head.asOf}</span>
              <span className="asof-pipe">·</span>
              <span>{head.framework}</span>
            </div>
          </div>
        </div>
      </header>

      <div className="content">
        {/* 2. 核心标的行情与中期量价通道 */}
        <section style={{ marginBottom: 28 }}>
          {/* A. 单指数聚焦展示条（含相对强度 RS 胶囊） */}
          <div className="equip-single-tab-bar">
            <div className="equip-tab-head-col">
              <div className="equip-tab-title-row">
                <span className="equip-tab-name">{activeBenchmark.name}</span>
                <span className="equip-tab-sym">{activeBenchmark.symbol}</span>
                <span className={`index-tab-status ${statusClass}`}>{statusLabel}</span>
              </div>
              <span className="equip-tab-role">{activeBenchmark.role}</span>
            </div>

            {/* 相对强度 (RS vs 科创50) 胶囊 */}
            <div className="equip-rs-col">
              <div className="equip-rs-title">
                <span className="equip-rs-lbl">RS 相对科创50 (20D)</span>
                <span className="equip-rs-val up">{relativeStrength.rsSpread}</span>
              </div>
              <span className="equip-rs-tag">{relativeStrength.label}</span>
            </div>

            <div className="equip-tab-price-col">
              <span className="equip-tab-price">¥{priceDisplay}</span>
              <span className={`equip-tab-chg ${chgClass}`}>{activeBenchmark.chg}</span>
            </div>
          </div>

          {/* B. K线图表与趋势通道 */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="equip-kline-caption-bar">
              <div className="equip-kline-title">
                <span className="terminal-chart-indicator" style={{ background: '#38bdf8' }} />
                <span>
                  {rangeLabel} · {tech.name}（{tech.symbol}）日K与量能
                </span>
                <span className={`equip-vol-badge ${volDiagnosis.tagClass}`}>{volDiagnosis.label}</span>
              </div>
              <div className="equip-range-tabs">
                {([['30d', '30日K'], ['60d', '60日K (季线)'], ['125d', '半年K (125日)']] as const).map(([k, lbl]) => (
                  <button
                    key={k}
                    type="button"
                    className={`equip-range-btn ${range === k ? 'active' : ''}`}
                    onClick={() => setRange(k)}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>

            <div className="equip-kline-legend">
              <span><i style={{ background: UP }} />阳线（涨）</span>
              <span><i style={{ background: DOWN }} />阴线（跌）</span>
              <span><i style={{ background: AMBER }} />MA20（月线/波段）</span>
              <span><i style={{ background: CYAN }} />MA60（季线/生命线）</span>
              <span><i style={{ background: MAVOL5_COLOR }} />MAVOL5</span>
              <span><i style={{ background: MAVOL20_COLOR }} />MAVOL20</span>
              <span><i style={{ background: 'rgba(245,197,66,0.6)' }} />支撑带 ({tech.support[0]}-{tech.support[1]})</span>
              <span><i style={{ background: 'rgba(255,107,107,0.6)' }} />压力带 ({tech.resistance[0]}-{tech.resistance[1]})</span>
            </div>

            <ReactECharts key={`equip-kline-${range}`} option={klineOpt} style={{ height: 350, width: '100%' }} notMerge />

            {/* 趋势生命线与跟踪防守体系条 */}
            <div className="card trend-lifeline-strip" style={{ margin: '10px 14px 14px' }}>
              <div className="trend-badge-group">
                <span className="trend-badge-lbl">趋势定性</span>
                <span className={`trend-status-tag ${tech.trendStatus || 'correction'}`}>
                  {tech.trendStatusLabel || '回踩休整 · 考验前低支撑'}
                </span>
              </div>
              <div className="trend-points">
                <span className="tp-item">
                  波段强弱线 (MA20) <b>{tech.currency}{currentMA20} {tech.unit}</b>
                  <small>偏离 {biasMA20 >= 0 ? '+' : ''}{biasMA20.toFixed(2)}% · 站稳确立右侧</small>
                </span>
                <span className="tp-item">
                  季线生命线 (MA60) <b>{tech.currency}{currentMA60} {tech.unit}</b>
                  <small>偏离 {biasMA60 >= 0 ? '+' : ''}{biasMA60.toFixed(2)}% · 中长线趋势强弱分水岭</small>
                </span>
                <span className="tp-item tp-stop">
                  结构破位底线 <b>{tech.currency}{tech.stopLoss} {tech.unit}</b>
                  <em>跌破确认结构破位 · 下行风险敞口扩大</em>
                </span>
                <span className="tp-item tp-entry">
                  右侧突破确认 <b>{tech.currency}{tech.breakoutTarget} {tech.unit}</b>
                  <small>放量突破颈线 · 形态确立右侧走强</small>
                </span>
              </div>
            </div>

            {/* 中期趋势研判与量化风控参考卡片 */}
            <div className="tech-grid" style={{ margin: '0 14px 14px' }}>
              <div className="t-item t-full">
                <b>走势判定</b>
                <span>{tech.trend}</span>
              </div>
              <div className="t-item">
                <b>支撑带依据</b>
                <span>{tech.supportDesc}</span>
              </div>
              <div className="t-item">
                <b>压力带依据</b>
                <span>{tech.resistanceDesc}</span>
              </div>
              <div className="t-item t-full" style={{ borderLeft: '3px solid var(--amber)' }}>
                <b style={{ color: 'var(--amber)' }}>中期趋势技术面特征与量化风控参考</b>
                <span>{tech.discipline}</span>
              </div>
            </div>

            {/* 模块级就地免责声明 */}
            <div style={{ margin: '0 16px 14px', fontSize: 11, color: 'var(--text-faint)', lineHeight: 1.5 }}>
              * 免责声明：上述均线偏离度、静态支撑带与阻力位基于历史量价指标测算，仅供客观技术形态与风险敞口跟踪参考，不构成任何投资咨询或买卖操作建议。
            </div>
          </div>
        </section>

        {/* 3. 资金面与微观筹码哨兵 */}
        <h2 className="sec-title" style={{ marginTop: 28 }}>
          资金面与微观筹码哨兵
          <span className="hint">成交额占比衡量板块拥挤度，ETF 份额跟踪主力申赎动向</span>
        </h2>
        <div className="anomaly-grid" style={{ marginBottom: 28 }}>
          {/* A. 板块成交额占比仪表 */}
          <div className="card real-crowd-card">
            <div className="real-crowd-head">
              <span className="real-crowd-title">半导体设备材料成交额占比</span>
              <span className={`crowd-badge ${crowdZone}`}>{crowdLabel}</span>
            </div>
            <div className="real-crowd-num-row">
              <span className="real-crowd-val num">{effectiveCrowding.turnoverShare.value}</span>
              <span className="real-crowd-unit">%</span>
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
              设备材料 {typeof effectiveCrowding.turnoverShare.equipAmountYi === 'number' ? effectiveCrowding.turnoverShare.equipAmountYi.toLocaleString() : '--'} 亿 / 两市 {typeof effectiveCrowding.turnoverShare.marketAmountYi === 'number' ? effectiveCrowding.turnoverShare.marketAmountYi.toLocaleString() : '--'} 亿。{effectiveCrowding.methodNote}。
            </div>
          </div>

          {/* B. ETF 份额净申赎 */}
          <div className="card real-crowd-card">
            <div className="real-crowd-head">
              <span className="real-crowd-title">代表性 ETF 份额动向（588170）</span>
              <span className="crowd-badge neutral">{crowding.etfFlow.label}</span>
            </div>
            <div className="real-crowd-num-row">
              <span className="real-crowd-val num">{crowding.etfFlow.unitsTotal}</span>
              <span className="real-crowd-unit" style={{ fontSize: 13, color: 'var(--up)' }}>
                {crowding.etfFlow.unitsChange}
              </span>
            </div>
            <div className="real-crowd-detail" style={{ marginTop: 12 }}>
              {crowding.etfFlow.signal}（截至 {crowding.etfFlow.asOf}）。
            </div>
          </div>
        </div>

        {/* 4. 权重龙头攻防共振哨兵 · 前道核心三剑客 */}
        <h2 className="sec-title" style={{ marginTop: 28 }}>
          权重龙头攻防共振哨兵 · 前道核心三剑客
          <span className="hint">北方华创、中微公司、拓荆科技：前三大核心权重走势联动与 MA20 攻防站位</span>
        </h2>
        <div className="equip-leaders-grid">
          {activeLeaders.map((item) => (
            <div className="equip-leader-card" key={item.symbol}>
              <div className="equip-leader-head">
                <span className="equip-leader-name">{item.name}</span>
                <span className="equip-leader-sym">{item.symbol}</span>
              </div>
              <div className="equip-leader-role">{item.role}</div>
              <div className="equip-leader-price-row">
                <span className="equip-leader-price">
                  ¥{typeof item.price === 'number' ? item.price.toFixed(2) : item.price}
                </span>
                <span className={`equip-leader-chg ${item.chgClass}`}>{item.chg}</span>
              </div>
              <div className="equip-leader-ma-row">
                <span>MA20: ¥{item.ma20.toFixed(2)} ({item.ma20Bias})</span>
                <span className={`equip-leader-tag ${item.ma20Status}`}>{item.ma20Label}</span>
              </div>
            </div>
          ))}
        </div>

        {/* 5. 国内自主可控四维产业前瞻雷达 */}
        <h2 className="sec-title" style={{ marginTop: 28 }}>
          国内自主可控四维前瞻雷达
          <span className="hint">晶圆厂扩产招标、细分环节三阶梯替代、龙头合同负债管线、大基金三期落地</span>
        </h2>
        <div className="equip-radar-grid">
          {radar.map((item) => (
            <div className="equip-radar-card" key={item.id}>
              <div className="equip-radar-head">
                <div className="equip-radar-title">
                  <span style={{ color: 'var(--amber)', marginRight: 6, fontFamily: MONO, fontSize: 13 }}>
                    {item.num}
                  </span>
                  {item.title}
                </div>
                <span className="equip-radar-tag">{item.tag}</span>
              </div>
              <div className="equip-radar-reading">{item.reading}</div>
              <div className="equip-radar-source">来源：{item.source}</div>
              <div className="equip-signal-box">
                <span className="equip-signal-tag">前瞻信号</span>
                <span className="equip-signal-text">{item.signal}</span>
              </div>
            </div>
          ))}
        </div>

        {/* 6. 底部数据说明 */}
        <footer className="src">{footer}</footer>
      </div>
    </article>
  );
}
