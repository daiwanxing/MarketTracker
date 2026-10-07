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

  // 1. ECharts: 历史超级厄尔尼诺周期对比 (Super El Niño Multi-Cycle Overlay)
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

  // 2. ECharts: 巴拿马加通湖十年水位季节性包络图 (Gatun Lake Seasonal Envelope Band)
  const gatunEnvelopeOpt: EChartsOption = useMemo(() => {
    const env = chokepoints.envelope;
    if (!env) return {};
    const bandSpan = env.max.map((mx: number, i: number) => parseFloat((mx - env.min[i]).toFixed(1)));
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(0,0,0,0.88)',
        borderColor: 'rgba(240,240,250,0.35)',
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: '#f0f0fa', fontFamily: DISPLAY, fontSize: 12 },
        formatter: (params: unknown) => {
          const list = params as { seriesName: string; value: number }[];
          if (!list || list.length === 0) return '';
          const idx = (params as { dataIndex: number }[])[0]?.dataIndex ?? 0;
          const month = env.months[idx];
          const act = env.actual2026[idx] ? `${env.actual2026[idx]} ft` : '尚未记录';
          return `<b style="color:#fff;font-family:${DISPLAY}">${month} · 加通湖水文</b><br/>` +
            `<span style="color:#ff6b6b;font-family:${MONO}">2026 实际: <b>${act}</b></span><br/>` +
            `<span style="color:rgba(255,255,255,0.6);font-family:${MONO}">历史十年均值: ${env.avg[idx]} ft</span><br/>` +
            `<span style="color:rgba(255,255,255,0.4);font-family:${MONO}">十年区间: ${env.min[idx]} ~ ${env.max[idx]} ft</span>`;
        },
      },
      legend: {
        top: 2,
        itemWidth: 14,
        itemHeight: 3,
        textStyle: { color: 'rgba(240,240,250,0.85)', fontFamily: DISPLAY, fontSize: 11 },
        data: ['十年水位包络区间', '历史同期均值', '2026 实际水位'],
      },
      grid: { left: 44, right: 16, top: 40, bottom: 28 },
      xAxis: {
        type: 'category',
        data: env.months,
        axisLine: { lineStyle: { color: 'rgba(240,240,250,0.25)' } },
        axisTick: { show: false },
        axisLabel: { color: 'rgba(240,240,250,0.6)', fontFamily: MONO, fontSize: 10.5 },
      },
      yAxis: {
        type: 'value',
        min: 78,
        max: 91,
        splitLine: { lineStyle: { color: 'rgba(240,240,250,0.1)' } },
        axisLabel: {
          color: 'rgba(240,240,250,0.6)',
          fontFamily: MONO,
          fontSize: 10.5,
          formatter: (v: number) => `${v}ft`,
        },
      },
      series: [
        {
          name: '包络底界',
          type: 'line',
          data: env.min,
          stack: 'envelope',
          showSymbol: false,
          lineStyle: { opacity: 0 },
          itemStyle: { opacity: 0 },
        },
        {
          name: '十年水位包络区间',
          type: 'line',
          data: bandSpan,
          stack: 'envelope',
          showSymbol: false,
          lineStyle: { opacity: 0 },
          areaStyle: { color: 'rgba(255, 255, 255, 0.08)' },
        },
        {
          name: '历史同期均值',
          type: 'line',
          data: env.avg,
          showSymbol: false,
          lineStyle: { color: 'rgba(255, 255, 255, 0.4)', width: 1.2, type: 'dashed' },
          itemStyle: { color: 'rgba(255, 255, 255, 0.4)' },
        },
        {
          name: '2026 实际水位',
          type: 'line',
          data: env.actual2026,
          showSymbol: true,
          symbolSize: 6,
          lineStyle: { color: '#ff6b6b', width: 2.8 },
          itemStyle: { color: '#ff6b6b' },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: 'rgba(255, 107, 107, 0.6)', type: 'dashed' },
            label: {
              color: 'rgba(255, 107, 107, 0.9)',
              fontFamily: MONO,
              fontSize: 10,
              formatter: '危机警戒线 80.0 ft',
            },
            data: [{ yAxis: 80.0 }],
          },
        },
      ],
    };
  }, [chokepoints]);

  // 3. ECharts: 四维跨资产气象敏感度与价格弹性象限气泡图 (Bubble Quadrant Chart)
  const quadrantOpt: EChartsOption = useMemo(() => {
    const items = crossAsset.quadrantItems || [];
    return {
      backgroundColor: 'transparent',
      tooltip: {
        backgroundColor: 'rgba(0,0,0,0.92)',
        borderColor: 'rgba(240,240,250,0.35)',
        borderWidth: 1,
        padding: [10, 14],
        textStyle: { color: '#f0f0fa', fontFamily: DISPLAY, fontSize: 12 },
        formatter: (params: unknown) => {
          const pt = (params as { data: [number, number, number, string, string, string, string] }).data;
          const [x, y, , name, , cat, desc] = pt;
          return `<b style="font-size:14px;color:#fff">${name}</b> <span style="font-family:${MONO};font-size:10.5px;color:var(--text-faint)">(${cat})</span><br/>` +
            `<div style="font-family:${MONO};font-size:11px;color:var(--amber);margin:4px 0">物理气象敏感度: ${x} · 边际价格弹性: ${y > 0 ? '+' : ''}${y}</div>` +
            `<span style="font-size:11.5px;color:var(--text-dim);line-height:1.45">${desc}</span>`;
        },
      },
      grid: { left: 52, right: 28, top: 32, bottom: 36 },
      xAxis: {
        type: 'value',
        min: 50,
        max: 100,
        splitLine: { lineStyle: { color: 'rgba(240,240,250,0.1)' } },
        axisLabel: { color: 'rgba(240,240,250,0.6)', fontFamily: MONO, fontSize: 10 },
        name: '物理气象扰动敏感度 (0 ➔ 100)',
        nameLocation: 'middle',
        nameGap: 24,
        nameTextStyle: { color: 'rgba(240,240,250,0.45)', fontFamily: DISPLAY, fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        min: -80,
        max: 100,
        splitLine: { lineStyle: { color: 'rgba(240,240,250,0.1)' } },
        axisLabel: { color: 'rgba(240,240,250,0.6)', fontFamily: MONO, fontSize: 10 },
        name: '边际价格爆发力 / 供给无弹性 (-100 ➔ +100)',
        nameLocation: 'middle',
        nameGap: 36,
        nameTextStyle: { color: 'rgba(240,240,250,0.45)', fontFamily: DISPLAY, fontSize: 11 },
      },
      series: [
        {
          type: 'scatter',
          data: items.map((it: { x: number; y: number; size: number; name: string; tone: string; category: string; desc: string }) => [
            it.x, it.y, it.size, it.name, it.tone, it.category, it.desc,
          ]),
          symbolSize: (val: number[]) => Math.sqrt(val[2]) * 4.2,
          itemStyle: {
            color: (params: unknown) => {
              const tone = (params as { data: string[] }).data[4];
              if (tone === 'r') return 'rgba(255, 107, 107, 0.85)';
              if (tone === 'g') return 'rgba(46, 213, 115, 0.85)';
              return 'rgba(245, 197, 66, 0.85)';
            },
            borderColor: '#fff',
            borderWidth: 1,
            shadowBlur: 8,
            shadowColor: 'rgba(0, 0, 0, 0.5)',
          },
          label: {
            show: true,
            formatter: (params: unknown) => (params as { data: string[] }).data[3],
            position: 'top',
            color: '#f0f0fa',
            fontFamily: DISPLAY,
            fontSize: 11.5,
            fontWeight: 'bold',
          },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: 'rgba(255, 255, 255, 0.25)', type: 'dashed' },
            data: [{ yAxis: 0 }],
          },
        },
      ],
    };
  }, [crossAsset]);

  // 4. ECharts: 白糖全球供需平衡表逆转与库存柱折图 (Sugar Deficit & Stocks-to-Use)
  const sugarBalanceOpt: EChartsOption = useMemo(() => {
    const sb = softCommodities.sugarBalance;
    if (!sb) return {};
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: 'rgba(0,0,0,0.92)',
        borderColor: 'rgba(240,240,250,0.35)',
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: '#f0f0fa', fontFamily: DISPLAY, fontSize: 11.5 },
      },
      legend: {
        top: 2,
        itemWidth: 14,
        itemHeight: 4,
        textStyle: { color: 'rgba(240,240,250,0.85)', fontFamily: DISPLAY, fontSize: 11 },
        data: ['全球供需净平衡 (Mt)', '全球库销比 Stocks to Use (%)'],
      },
      grid: { left: 44, right: 44, top: 38, bottom: 28 },
      xAxis: {
        type: 'category',
        data: sb.seasons,
        axisLine: { lineStyle: { color: 'rgba(240,240,250,0.25)' } },
        axisTick: { show: false },
        axisLabel: { color: 'rgba(240,240,250,0.7)', fontFamily: DISPLAY, fontSize: 11 },
      },
      yAxis: [
        {
          type: 'value',
          splitLine: { lineStyle: { color: 'rgba(240,240,250,0.1)' } },
          axisLabel: {
            color: 'rgba(240,240,250,0.6)',
            fontFamily: MONO,
            fontSize: 10,
            formatter: (v: number) => `${v > 0 ? '+' : ''}${v}Mt`,
          },
        },
        {
          type: 'value',
          min: 24,
          max: 42,
          splitLine: { show: false },
          axisLabel: {
            color: 'rgba(245, 197, 66, 0.75)',
            fontFamily: MONO,
            fontSize: 10,
            formatter: (v: number) => `${v}%`,
          },
        },
      ],
      series: [
        {
          name: '全球供需净平衡 (Mt)',
          type: 'bar',
          data: sb.deficitMt.map((val: number) => ({
            value: val,
            itemStyle: {
              color: val >= 0 ? 'rgba(46, 213, 115, 0.75)' : '#ff6b6b',
              borderRadius: [val >= 0 ? 3 : 0, val >= 0 ? 3 : 0, val < 0 ? 3 : 0, val < 0 ? 3 : 0],
            },
          })),
          barWidth: 26,
          label: {
            show: true,
            position: 'top',
            color: '#fff',
            fontFamily: MONO,
            fontSize: 10.5,
            fontWeight: 'bold',
            formatter: (p: unknown) => `${((p as { value: number }).value > 0 ? '+' : '')}${(p as { value: number }).value}Mt`,
          },
        },
        {
          name: '全球库销比 Stocks to Use (%)',
          type: 'line',
          yAxisIndex: 1,
          data: sb.stockUseRatio,
          showSymbol: true,
          symbolSize: 6,
          lineStyle: { color: '#f39c12', width: 2.2 },
          itemStyle: { color: '#f39c12' },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: 'rgba(245, 197, 66, 0.5)', type: 'dashed' },
            label: {
              color: '#f39c12',
              fontFamily: MONO,
              fontSize: 9.5,
              formatter: '15年最低警戒线 30%',
            },
            data: [{ yAxis: 30 }],
          },
        },
      ],
    };
  }, [softCommodities]);

  // 5. ECharts: 主产国出口垄断度横向堆叠条形图 (Export Concentration Ratio)
  const concentrationOpt: EChartsOption = useMemo(() => {
    const cc = softCommodities.concentration;
    if (!cc) return {};
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: 'rgba(0,0,0,0.92)',
        borderColor: 'rgba(240,240,250,0.35)',
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: '#f0f0fa', fontFamily: DISPLAY, fontSize: 11.5 },
      },
      legend: {
        top: 2,
        itemWidth: 12,
        itemHeight: 4,
        textStyle: { color: 'rgba(240,240,250,0.85)', fontFamily: DISPLAY, fontSize: 11 },
        data: ['首要核心主产国', '第二主产集团', '全球其余分散份额'],
      },
      grid: { left: 110, right: 30, top: 36, bottom: 20 },
      xAxis: {
        type: 'value',
        max: 100,
        splitLine: { lineStyle: { color: 'rgba(240,240,250,0.08)' } },
        axisLabel: {
          color: 'rgba(240,240,250,0.6)',
          fontFamily: MONO,
          fontSize: 9.5,
          formatter: '{value}%',
        },
      },
      yAxis: {
        type: 'category',
        data: cc.commodities,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: '#f0f0fa', fontFamily: DISPLAY, fontSize: 11.5, fontWeight: 'bold' },
      },
      series: [
        {
          name: '首要核心主产国',
          type: 'bar',
          stack: 'total',
          data: cc.tier1.map((val: number, i: number) => ({
            value: val,
            name: cc.tier1Label[i],
          })),
          itemStyle: { color: '#e74c3c' },
          label: {
            show: true,
            formatter: (p: unknown) => (p as { data: { name: string } }).data.name,
            color: '#fff',
            fontFamily: MONO,
            fontSize: 10,
          },
        },
        {
          name: '第二主产集团',
          type: 'bar',
          stack: 'total',
          data: cc.tier2.map((val: number, i: number) => ({
            value: val,
            name: cc.tier2Label[i],
          })),
          itemStyle: { color: '#f39c12' },
          label: {
            show: true,
            formatter: (p: unknown) => (p as { data: { name: string } }).data.name,
            color: '#fff',
            fontFamily: MONO,
            fontSize: 10,
          },
        },
        {
          name: '全球其余分散份额',
          type: 'bar',
          stack: 'total',
          data: cc.tier3.map((val: number, i: number) => ({
            value: val,
            name: cc.tier3Label[i],
          })),
          itemStyle: { color: 'rgba(255,255,255,0.2)' },
          label: {
            show: true,
            formatter: (p: unknown) => (p as { data: { name: string } }).data.name,
            color: 'rgba(255,255,255,0.7)',
            fontFamily: MONO,
            fontSize: 9.5,
          },
        },
      ],
    };
  }, [softCommodities]);

  // 6. ECharts: 未来 12 个月生物学时滞甘特波浪图 (Transmission Horizon Waves)
  const lagWavesOpt: EChartsOption = useMemo(() => {
    const lag = transmissionLag;
    if (!lag.waves) return {};
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(0,0,0,0.92)',
        borderColor: 'rgba(240,240,250,0.35)',
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: '#f0f0fa', fontFamily: DISPLAY, fontSize: 11.5 },
      },
      legend: {
        top: 2,
        itemWidth: 12,
        itemHeight: 3,
        textStyle: { color: 'rgba(240,240,250,0.85)', fontFamily: DISPLAY, fontSize: 10.5 },
        data: lag.waves.map((w: { name: string }) => w.name),
      },
      grid: { left: 40, right: 18, top: 40, bottom: 28 },
      xAxis: {
        type: 'category',
        data: lag.timelineMonths,
        axisLine: { lineStyle: { color: 'rgba(240,240,250,0.25)' } },
        axisTick: { show: false },
        axisLabel: { color: 'rgba(240,240,250,0.6)', fontFamily: MONO, fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        max: 100,
        splitLine: { lineStyle: { color: 'rgba(240,240,250,0.08)' } },
        axisLabel: {
          color: 'rgba(240,240,250,0.5)',
          fontFamily: MONO,
          fontSize: 9.5,
          formatter: (v: number) => `${v}%`,
        },
        name: '冲击传导强度',
        nameTextStyle: { color: 'rgba(240,240,250,0.4)', fontFamily: DISPLAY, fontSize: 10 },
      },
      series: lag.waves.map((w: { name: string; data: number[]; color: string }) => ({
        name: w.name,
        type: 'line',
        smooth: true,
        data: w.data,
        showSymbol: false,
        lineStyle: { color: w.color, width: 2 },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: w.color },
              { offset: 1, color: 'transparent' },
            ],
          },
          opacity: 0.25,
        },
        itemStyle: { color: w.color },
      })),
    };
  }, [transmissionLag]);

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

        {/* 4. Module 2: Panama Canal Chokepoint Sentinel (包络图升级) */}
        <h2 className="sec-title">
          {chokepoints.secTitle}
          <span className="hint">{chokepoints.hint}</span>
        </h2>
        <div className="chokepoint-container" ref={chokepointRef}>
          <div className="card" style={{ padding: '16px 18px', marginBottom: '18px' }}>
            <ReactECharts
              option={gatunEnvelopeOpt}
              style={{ height: '300px', width: '100%' }}
              opts={{ renderer: 'canvas' }}
            />
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

        {/* 5. Module 3: 4D Cross-Asset Transmission Matrix (象限气泡图升级) */}
        <h2 className="sec-title">
          {crossAsset.secTitle}
          <span className="hint">{crossAsset.hint}</span>
        </h2>
        <div className="card" ref={crossAssetRef} style={{ padding: '16px 18px', marginBottom: '28px' }}>
          <ReactECharts
            option={quadrantOpt}
            style={{ height: '360px', width: '100%' }}
            opts={{ renderer: 'canvas' }}
          />
        </div>

        {/* 6. Module 4: Soft Commodities & Industrial Ag Specialties (平衡表柱折图 + 集中度堆叠条升级) */}
        <h2 className="sec-title">
          {softCommodities.secTitle}
          <span className="hint">{softCommodities.hint}</span>
        </h2>
        <div className="chart-split-grid" ref={softRef}>
          <div className="card" style={{ padding: '16px 18px' }}>
            <div style={{ fontFamily: DISPLAY, fontSize: '13px', fontWeight: 'bold', color: 'var(--text-dim)', marginBottom: '8px' }}>
              全球食糖平衡表逆转与库销比 (J.P. Morgan & USDA)
            </div>
            <ReactECharts
              option={sugarBalanceOpt}
              style={{ height: '280px', width: '100%' }}
              opts={{ renderer: 'canvas' }}
            />
          </div>
          <div className="card" style={{ padding: '16px 18px' }}>
            <div style={{ fontFamily: DISPLAY, fontSize: '13px', fontWeight: 'bold', color: 'var(--text-dim)', marginBottom: '8px' }}>
              全球四大软商品出口垄断度 (HHI 集中度)
            </div>
            <ReactECharts
              option={concentrationOpt}
              style={{ height: '280px', width: '100%' }}
              opts={{ renderer: 'canvas' }}
            />
          </div>
        </div>

        {/* 7. Module 5: Biological & Logistics Lag Timeline (时滞波浪图升级) */}
        <h2 className="sec-title">
          {transmissionLag.secTitle}
          <span className="hint">{transmissionLag.hint}</span>
        </h2>
        <div className="card" ref={lagRef} style={{ padding: '16px 18px', marginBottom: '28px' }}>
          <ReactECharts
            option={lagWavesOpt}
            style={{ height: '290px', width: '100%' }}
            opts={{ renderer: 'canvas' }}
          />
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
