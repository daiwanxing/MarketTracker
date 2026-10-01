import { useMemo, type CSSProperties } from 'react';
import { ArrowUpRight } from 'lucide-react';
import heroRobot from '../assets/hero-robot.jpg';
import robotData from '../data/robotData.json';
import { useReveal } from '../hooks/useReveal';

const S = {
  anchorCard: {
    background: 'rgba(240, 240, 250, 0.04)',
    border: '1px solid rgba(240, 240, 250, 0.14)',
    borderRadius: '4px',
    padding: '20px 24px',
    marginBottom: '24px',
  } as CSSProperties,
  anchorHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: '12px',
    marginBottom: '10px',
  } as CSSProperties,
  anchorTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: '18px',
    fontWeight: 700,
    letterSpacing: '0.8px',
    color: 'var(--text)',
  } as CSSProperties,
  anchorThesis: {
    fontSize: '14px',
    color: 'var(--text-dim)',
    lineHeight: 1.6,
    marginBottom: '18px',
  } as CSSProperties,
  kpiGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '12px',
    borderTop: '1px solid var(--line)',
    paddingTop: '16px',
  } as CSSProperties,
  kpiItem: {
    padding: '10px 14px',
    background: 'rgba(0, 0, 0, 0.3)',
    border: '1px solid rgba(240, 240, 250, 0.08)',
    borderRadius: '4px',
  } as CSSProperties,
  kpiLabel: {
    fontSize: '11px',
    fontFamily: 'var(--font-mono)',
    color: 'var(--text-faint)',
    letterSpacing: '0.5px',
    textTransform: 'uppercase',
  } as CSSProperties,
  kpiValRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '8px',
    marginTop: '4px',
  } as CSSProperties,
  kpiVal: {
    fontFamily: 'var(--font-display)',
    fontSize: '24px',
    fontWeight: 700,
    color: 'var(--text)',
  } as CSSProperties,
  kpiChg: {
    fontFamily: 'var(--font-display)',
    fontSize: '13px',
    fontWeight: 700,
    color: 'var(--up)',
  } as CSSProperties,
  kpiSub: {
    fontSize: '11px',
    color: 'var(--text-dim)',
    marginTop: '4px',
    lineHeight: 1.4,
  } as CSSProperties,
  sixGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))',
    gap: '16px',
    marginBottom: '32px',
  } as CSSProperties,
  dimCard: {
    background: 'var(--ghost-surface)',
    border: '1px solid var(--ghost-border)',
    borderRadius: '4px',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
  } as CSSProperties,
  dimHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '12px',
    marginBottom: '8px',
  } as CSSProperties,
  dimNumName: {
    fontFamily: 'var(--font-display)',
    fontSize: '17px',
    fontWeight: 700,
    letterSpacing: '0.6px',
    color: 'var(--text)',
  } as CSSProperties,
  analogyTag: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10.5px',
    padding: '2px 8px',
    background: 'rgba(56, 189, 248, 0.12)',
    border: '1px solid rgba(56, 189, 248, 0.28)',
    borderRadius: '2px',
    color: '#7dd3fc',
    whiteSpace: 'nowrap',
  } as CSSProperties,
  dimMetric: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--text-faint)',
    marginBottom: '14px',
  } as CSSProperties,
  chartBox: {
    background: 'rgba(0, 0, 0, 0.35)',
    border: '1px solid rgba(240, 240, 250, 0.08)',
    borderRadius: '4px',
    padding: '14px',
    marginBottom: '14px',
  } as CSSProperties,
  readingText: {
    fontSize: '13px',
    color: 'var(--text)',
    lineHeight: 1.6,
    marginBottom: '10px',
  } as CSSProperties,
  sourceLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10.5px',
    color: 'var(--text-faint)',
    marginBottom: '12px',
  } as CSSProperties,
  signalBox: {
    borderTop: '1px solid var(--line)',
    paddingTop: '10px',
    display: 'flex',
    gap: '8px',
    alignItems: 'baseline',
  } as CSSProperties,
  signalTag: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    fontWeight: 700,
    padding: '2px 6px',
    borderRadius: '2px',
    background: 'rgba(245, 197, 66, 0.15)',
    color: 'var(--amber)',
    border: '1px solid rgba(245, 197, 66, 0.3)',
    whiteSpace: 'nowrap',
  } as CSSProperties,
  signalText: {
    fontSize: '12px',
    color: 'rgba(240, 240, 250, 0.85)',
    lineHeight: 1.5,
  } as CSSProperties,
  compGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: '12px',
  } as CSSProperties,
};

export default function RobotPanel() {
  const { head, anchor, dimensions, components, timelineTitle, timelineHint, timeline, footer } = robotData;
  const tlRef = useReveal<HTMLDivElement>();

  const sortedTimeline = useMemo(() => {
    return [...(timeline || [])].sort((a, b) => b.date.localeCompare(a.date));
  }, [timeline]);

  return (
    <article>
      {/* 1. 英雄主视觉区 */}
      <header className="hero">
        <img className="hero-bg" src={heroRobot} alt="具身智能人形机器人 · 精密机械臂与关节传感器" />
        <span className="hero-scrim" aria-hidden="true" />
        <div className="hero-inner">
          <div className="hero-main">
            <div className="kicker">{head.kicker}</div>
            <h1>{head.title}</h1>
            <p className="hero-lead">{head.sub}</p>
          </div>
          <div className="hero-aside">
            <span className="hero-meta"><b>数据截至：{head.asOf}</b></span>
            <span className="hero-meta" style={{ opacity: 0.8 }}>{head.framework}</span>
          </div>
        </div>
      </header>

      <div className="content">
        {/* 2. 顶层判断锚点与核心 KPI */}
        <div style={S.anchorCard}>
          <div style={S.anchorHeader}>
            <div style={S.anchorTitle}>核心判断锚点 · 工业与商业规模化落地标准</div>
            <span className="crowd-badge cold" style={{ fontSize: '11px' }}>
              严格遵循机构验证准则
            </span>
          </div>
          <div style={S.anchorThesis}>{anchor.thesis}</div>

          <div style={S.kpiGrid}>
            {anchor.kpis.map((kpi) => (
              <div style={S.kpiItem} key={kpi.id}>
                <div style={S.kpiLabel}>{kpi.label}</div>
                <div style={S.kpiValRow}>
                  <span style={S.kpiVal} className="num">{kpi.value}</span>
                  <span style={S.kpiChg} className="num">{kpi.chg}</span>
                </div>
                <div style={S.kpiSub}>{kpi.sub}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 3. 六维核心观察矩阵 */}
        <h2 className="sec-title">
          六维产业验证矩阵
          <span className="hint">半导体周期框架迁移 · 紧扣出货、订单、成本、产能、良率与财务闭环</span>
        </h2>

        <div style={S.sixGrid}>
          {dimensions.map((dim) => (
            <div style={S.dimCard} key={dim.id}>
              <div>
                {/* 维度头部 */}
                <div style={S.dimHead}>
                  <span style={S.dimNumName}>{dim.name}</span>
                  <span style={S.analogyTag}>对照：{dim.analogy}</span>
                </div>
                <div style={S.dimMetric}>指标：{dim.metrics}</div>

                {/* 维度专属内联可视化图表 */}
                <div style={S.chartBox}>
                  {dim.id === 'volume' && dim.penetration && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-dim)', marginBottom: 6 }}>
                        <span>场景渗透率结构（2026H1）</span>
                        <span>生产场景合计 <b>18.0%</b>（阈值 30%）</span>
                      </div>
                      {/* 堆叠进度条 */}
                      <div style={{ height: 18, background: 'rgba(240, 240, 250, 0.08)', borderRadius: 2, display: 'flex', position: 'relative', overflow: 'hidden' }}>
                        <div style={{ width: '13%', background: '#ff6b6b' }} title="智能制造 13%" />
                        <div style={{ width: '5%', background: '#38bdf8' }} title="仓储物流 5%" />
                        <div style={{ width: '82%', background: 'rgba(240, 240, 250, 0.15)' }} title="文娱科研及其他 82%" />
                        {/* 30% 观察阈值刻度线 */}
                        <div
                          style={{
                            position: 'absolute',
                            left: '30%',
                            top: 0,
                            bottom: 0,
                            width: 2,
                            background: '#f5c542',
                            boxShadow: '0 0 6px #f5c542',
                          }}
                        />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-faint)', marginTop: 6, fontFamily: 'var(--font-mono)' }}>
                        <span style={{ color: '#ff6b6b' }}>■ 智能制造 13%</span>
                        <span style={{ color: '#38bdf8' }}>■ 仓储物流 5%</span>
                        <span style={{ color: 'var(--amber)' }}>▲ 爆发观察线 30%</span>
                        <span>□ 文娱商演等 82%</span>
                      </div>
                    </div>
                  )}

                  {dim.id === 'orders' && dim.procurement && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-dim)', marginBottom: 8 }}>
                        <span>国网规划采购结构（设备 58 亿元 / 8500 台）</span>
                        <span style={{ color: 'var(--text-faint)' }}>非公开招标公告口径</span>
                      </div>
                      {dim.procurement.map((p) => (
                        <div key={p.name} style={{ marginBottom: 6 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: 2 }}>
                            <span style={{ color: 'var(--text)' }}>{p.name}</span>
                            <span className="mono" style={{ color: 'var(--text-dim)' }}>
                              {p.units} 台 / <b>{p.budget} 亿元</b> ({p.unitPrice})
                            </span>
                          </div>
                          <div style={{ height: 6, background: 'rgba(240, 240, 250, 0.08)', borderRadius: 2 }}>
                            <div
                              style={{
                                height: '100%',
                                width: `${(p.budget / 25) * 100}%`,
                                background: p.name.includes('人形') ? '#ff6b6b' : 'rgba(240, 240, 250, 0.45)',
                                borderRadius: 2,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {dim.id === 'price' && dim.aspHistory && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-dim)', marginBottom: 8 }}>
                        <span>宇树人形机器人出货均价 ASP 下探</span>
                        <span style={{ color: 'var(--down)' }}>3 年累计 -72.0%</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, textAlign: 'center' }}>
                        {dim.aspHistory.map((h) => (
                          <div key={h.year} style={{ padding: '6px 4px', background: 'rgba(240, 240, 250, 0.04)', borderRadius: 2 }}>
                            <div style={{ fontSize: '10px', color: 'var(--text-faint)' }}>{h.year}</div>
                            <div className="num" style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text)', margin: '2px 0' }}>
                              {h.asp} <span style={{ fontSize: '10px', fontWeight: 400 }}>万</span>
                            </div>
                            <div style={{ fontSize: '9.5px', color: 'var(--text-dim)' }}>毛利 {h.grossMargin}%</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ marginTop: 8, fontSize: '10.5px', color: 'var(--text-faint)', display: 'flex', justifyContent: 'space-between' }}>
                        <span>入门标杆：R1-Air 标价 2.99 万元</span>
                        <span>特斯拉目标：$20,000–$30,000</span>
                      </div>
                    </div>
                  )}

                  {dim.id === 'capacity' && dim.capacitySteps && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-dim)', marginBottom: 8 }}>
                        <span>产线节拍爬坡阶梯 vs 远期规划</span>
                        <span style={{ color: 'var(--amber)' }}>当前处于量产鸿沟期</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {dim.capacitySteps.map((s) => (
                          <div key={s.stage} style={{ display: 'flex', alignItems: 'center', fontSize: '11px' }}>
                            <span style={{ width: 85, color: 'var(--text-dim)', flexShrink: 0 }}>{s.stage}</span>
                            <div style={{ flex: 1, height: 6, background: 'rgba(240, 240, 250, 0.08)', borderRadius: 2, margin: '0 8px' }}>
                              <div
                                style={{
                                  height: '100%',
                                  width: `${Math.min(100, Math.log10(s.val + 1) * 23)}%`,
                                  background: s.stage.includes('实际') ? '#4ade80' : s.stage.includes('目标') ? '#f5c542' : 'rgba(240, 240, 250, 0.35)',
                                  borderRadius: 2,
                                }}
                              />
                            </div>
                            <span className="mono" style={{ width: 90, textAlign: 'right', color: 'var(--text)', fontSize: '10.5px' }}>
                              {s.val} {s.unit}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {dim.id === 'reliability' && dim.reliabilityStats && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-dim)', marginBottom: 8 }}>
                        <span>工业连续运行工时进展 (Figure 宝马工位)</span>
                        <span className="mono" style={{ color: '#4ade80' }}>
                          {dim.reliabilityStats.bmwHours}h / {dim.reliabilityStats.targetMtbf}h
                        </span>
                      </div>
                      <div style={{ height: 8, background: 'rgba(240, 240, 250, 0.08)', borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
                        <div
                          style={{
                            height: '100%',
                            width: `${(dim.reliabilityStats.bmwHours / dim.reliabilityStats.targetMtbf) * 100}%`,
                            background: '#4ade80',
                            borderRadius: 2,
                          }}
                        />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10.5px', color: 'var(--text-faint)' }}>
                        <span>累计装载冲压件：&gt;90,000 件</span>
                        <span style={{ color: '#ff6b6b' }}>特斯拉瓶颈：手部 100+ 零件仍手工装配</span>
                      </div>
                    </div>
                  )}

                  {dim.id === 'financials' && dim.peers && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-dim)', marginBottom: 8 }}>
                        <span>整机龙头财务报表检验（2025 全年 · 亿元）</span>
                        <span style={{ color: 'var(--text-faint)' }}>
                          <span style={{ color: '#ff6b6b' }}>■ 宇树</span> vs <span style={{ color: '#38bdf8' }}>■ 优必选</span>
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {dim.peers.map((p) => (
                          <div key={p.metric} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', background: 'rgba(240, 240, 250, 0.02)', padding: '3px 6px', borderRadius: 2 }}>
                            <span style={{ color: 'var(--text-dim)', width: 85 }}>{p.metric}</span>
                            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                              <span className="mono" style={{ color: p.unitree >= 0 ? '#ff6b6b' : '#4ade80', fontWeight: 600 }}>
                                宇: {p.unitree > 0 ? `+${p.unitree}` : p.unitree}
                              </span>
                              <span className="mono" style={{ color: p.ubtech >= 0 ? '#38bdf8' : '#f5c542', fontWeight: 600 }}>
                                优: {p.ubtech > 0 ? `+${p.ubtech}` : p.ubtech}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* 披露事实阅读 */}
                <div style={S.readingText}>{dim.reading}</div>
                <div style={S.sourceLabel}>数据来源：{dim.source}</div>
              </div>

              {/* 观察触发条件 */}
              <div style={S.signalBox}>
                <span style={S.signalTag}>观察条件</span>
                <span style={S.signalText}>{dim.signal}</span>
              </div>
            </div>
          ))}
        </div>

        {/* 4. 上游关键零部件供应链映射 */}
        <h2 className="sec-title" style={{ marginTop: 36 }}>
          上游核心硬件环节跟踪
          <span className="hint">丝杠、传感器、减速器与伺服电机披露更新</span>
        </h2>

        <div style={S.compGrid}>
          {components.map((c) => (
            <div className="card real-crowd-card" key={c.k}>
              <div className="real-crowd-head">
                <span className="real-crowd-title">{c.k}</span>
                <span className={`crowd-badge ${c.status === 'watching' ? 'hot' : 'neutral'}`}>{c.badge}</span>
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-faint)', marginBottom: 6 }}>
                {c.en}
              </div>
              <div className="real-crowd-desc" style={{ fontSize: '12px', color: 'var(--text-dim)', marginBottom: 8 }}>
                <b>核心指标：</b>{c.metric}
              </div>
              <div className="real-crowd-detail" style={{ fontSize: '12px', lineHeight: 1.5, color: 'var(--text)' }}>
                {c.reading}
              </div>
            </div>
          ))}
        </div>

        {/* 5. 具身智能与人形机器人产业大事记 */}
        {sortedTimeline.length > 0 && (
          <>
            <h2 className="sec-title" style={{ marginTop: 36 }}>
              {timelineTitle || '产业大事记与动态追踪'}
              <span className="hint">{timelineHint}</span>
            </h2>
            <div className="tl" ref={tlRef}>
              {sortedTimeline.map((n, i) => (
                <div className={`node ${i === 0 ? 'latest' : ''} ${n.hot ? 'hot' : ''}`} key={`${n.date}-${n.t}-${i}`}>
                  <div className="dot" />
                  <div className="tags">
                    <span className="date">{n.date}</span>
                    <span className="tag">{n.tag}</span>
                    {n.hot && <span className="tag hot-tag">重大事件</span>}
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

        {/* 6. 底部来源与说明 */}
        <footer className="src">
          {footer}
        </footer>
      </div>
    </article>
  );
}
