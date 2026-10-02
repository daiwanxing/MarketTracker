import { useState, type CSSProperties } from 'react';
import heroOptics from '../assets/hero-optics.jpg';
import opticsData from '../data/opticsData.json';
import techSemiData from '../data/techSemiData.json';

const EMPTY = '未接入';

/* —— Types —— */
type RiskStatus = 'normal' | 'warning' | 'critical';
type CycleStatus = 'up' | 'neutral' | 'down';

type Rate = {
  k: string;
  metric: string;
  status: string;
  asOf: string;
  source: string;
  reading: string;
  shift: string;
};

type NameQuote = {
  name: string;
  symbol: string;
  cumPct: number;
  asOf: string;
  src: string;
};

type CoreVariable = {
  id: string;
  name: string;
  role: string;
  status: string;
  reading: string;
  implication: string;
};

type InvestorSummary = {
  thesis: string;
  takeaway: string;
  coreVariables: CoreVariable[];
};

type RiskItem = {
  id: string;
  title: string;
  status: RiskStatus | string;
  level: number;
  metric: string;
  reading: string;
  implication: string;
};

type CyclePole = {
  cycle: string;
  traits: string[];
};

type IndustryDriver = {
  from: CyclePole;
  to: CyclePole;
  marketScale?: string;
  coreTrackers?: string[];
};

type BomItem = {
  name: string;
  share: string;
  margin: string;
  status?: string;
  players: string;
  barriers: string;
};

type TechRoute = {
  route: string;
  role?: string;
  rate: string;
  timeline: string;
  maturity: string;
  threatLevel: string;
  detail: string;
};

type CycleDim = {
  cycle: string;
  logic?: string;
  keyVars?: string;
  status: CycleStatus | string;
  meaning?: string;
  detail: string;
};

type Competitor = {
  name: string;
  symbol: string;
  tier: string;
  advantage: string;
  globalShare: string;
};

type ValuationRow = {
  name: string;
  ntmPe: string;
  peg: string;
  status: string;
  growthExp: string;
};

type OpticsPayload = {
  head: { kicker: string; title: string; sub: string };
  rate: Rate;
  names: NameQuote[];
  footer: string;
  investorSummary?: InvestorSummary;
  riskRadar?: RiskItem[];
  industryDriver?: IndustryDriver;
  bomBreakdown?: { coreConflict?: string; items: BomItem[] };
  techMatrix?: { trapWarning?: string; routes: TechRoute[] } | TechRoute[];
  tripleCycle?: { framework?: string; coreInsight?: string; dimensions: CycleDim[]; synthesis: string };
  competition?: { summary?: string; structuralRisks?: { title: string; desc: string }[]; players: Competitor[] };
  valuation?: {
    guidance?: string;
    peBand?: { staticDesc: string; forward2026: string; forward2027: string; pegRule: string };
    items: ValuationRow[];
  };
};

/* —— Shared inline tokens (SpaceX-aligned) —— */
const S = {
  pad: { padding: '20px 18px' } as CSSProperties,
  kMono: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: 'uppercase' as const,
    color: 'var(--text-faint)',
  } as CSSProperties,
  reading: { fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.65, marginTop: 10 } as CSSProperties,
  imply: {
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    color: 'var(--text-faint)',
    lineHeight: 1.6,
    marginTop: 12,
    paddingTop: 10,
    borderTop: '1px solid var(--line)',
  } as CSSProperties,
  barTrack: {
    height: 6,
    borderRadius: 2,
    background: 'rgba(240,240,250,0.1)',
    overflow: 'hidden',
    marginTop: 10,
  } as CSSProperties,
  th: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase' as const,
    color: 'var(--text-faint)',
    textAlign: 'left' as const,
    padding: '10px 12px',
    borderBottom: '1px solid var(--line-strong)',
  } as CSSProperties,
  td: {
    fontSize: 13,
    color: 'var(--text-dim)',
    padding: '12px',
    borderBottom: '1px solid var(--line)',
    verticalAlign: 'top' as const,
    lineHeight: 1.55,
  } as CSSProperties,
};

function citedRate(rate: Rate) {
  return rate.status === 'live' && Boolean(rate.asOf && rate.source && rate.reading && rate.shift);
}

function riskBadge(status: string): string {
  if (status === 'critical') return 'danger';
  if (status === 'warning') return 'warning';
  if (status === 'normal') return 'cold';
  return 'unknown';
}

function riskLabel(status: string): string {
  if (status === 'critical') return 'CRITICAL';
  if (status === 'warning') return 'WATCH';
  if (status === 'normal') return 'STABLE';
  return 'N/A';
}

function cycleBadge(status: string): string {
  if (status === 'up') return 'neutral';
  if (status === 'down') return 'danger';
  if (status === 'neutral') return 'warning';
  return 'unknown';
}

function cycleArrow(status: string): string {
  if (status === 'up') return '↑ 景气扩张';
  if (status === 'down') return '↓ 下行衰退';
  if (status === 'neutral') return '· 震荡消化';
  return EMPTY;
}

function threatTone(level: string): string {
  if (level.includes('高') && !level.includes('中高')) return 'danger';
  if (level.includes('中') && !level.includes('中低')) return 'warning';
  return 'cold';
}

function shareWidth(share: string): number {
  const m = share.match(/(\d+)/);
  return m ? Math.min(100, Number(m[1]) + 8) : 40;
}

function enrichRisks(
  risks: RiskItem[],
  capex: { v?: string; watch?: string; status?: string } | undefined,
  share: number | undefined,
  margin: number | undefined,
): RiskItem[] {
  return risks.map((item) => {
    if (item.id === 'csp_capex' && capex?.v && capex.v !== '未接入' && capex.status !== 'pending') {
      const cut = capex.v.includes('下调');
      return {
        ...item,
        status: cut ? 'critical' : item.status,
        level: cut ? 5 : item.level,
        reading: `宏观页读数「${capex.v}」：${capex.watch || ''}。${item.reading}`,
      };
    }
    if (item.id === 'chips_crowding' && typeof share === 'number') {
      const hot = share >= 38;
      const warm = share >= 32;
      const marginTxt = typeof margin === 'number' ? `，全市场融资买入 ${margin.toFixed(2)}%` : '';
      return {
        ...item,
        status: hot ? 'critical' : warm ? 'warning' : item.status,
        level: hot ? 5 : warm ? 4 : item.level,
        reading: `宏观页 Actions：TMT 成交占比 ${share.toFixed(2)}%${marginTxt}。${item.reading}`,
      };
    }
    return item;
  });
}

function opticsVerdict(
  rate: Rate,
  capexReading: string | undefined,
  capexLive: boolean,
  names: NameQuote[],
  soxLast: number | undefined,
  synthesis: string | undefined,
) {
  const lines: string[] = [];
  if (synthesis) lines.push(synthesis);
  if (citedRate(rate) && capexLive && capexReading) {
    const cut = capexReading.includes('下调');
    const stuck = rate.shift === 'stuck';
    lines.push(
      cut || stuck
        ? `需求与结构转弱：云厂商开支为「${capexReading}」，速率结构为「${rate.reading}」（${rate.asOf}，${rate.source}）。`
        : `需求与结构维持：云厂商开支未下修（${capexReading}）；速率结构仍在上移（${rate.reading}，${rate.asOf}，${rate.source}）。`,
    );
  }
  if (typeof soxLast === 'number' && names.length) {
    const alone = names.filter((item) => item.cumPct < 0 && soxLast >= 0);
    const margin = techSemiData.leverage?.marginBuyShare?.value;
    const share = techSemiData.crowding?.turnoverShare?.value;
    if (alone.length) {
      lines.push(
        `${alone.map((item) => `${item.name}累计 ${item.cumPct.toFixed(1)}%`).join('、')}相对费城半导体指数回撤至区间起点下方，与交易拥挤回落一致。`,
      );
    } else {
      lines.push(
        `${names.map((item) => `${item.name}累计 ${item.cumPct > 0 ? '+' : ''}${item.cumPct.toFixed(1)}%`).join('、')}，未相对费城半导体指数单独回撤至区间起点下方。`,
      );
    }
    if (typeof margin === 'number' && margin > 9 && typeof share === 'number' && share >= 38) {
      lines.push(
        `融资买入 ${margin.toFixed(2)}%（高于 9%），TMT 成交占比 ${share.toFixed(2)}%（≥38，极端过热）。后续取决于下一期披露是否上修。本页不形成持仓结论。`,
      );
    }
  }
  if (!lines.length) return '开支方向、速率结构或相对费城半导体指数缺少可引用读数。不形成持仓结论。';
  return lines.join(' ');
}

/* —— 1. 核心观察变量看板 —— */
function CoreVariablesBoard({ summary }: { summary?: InvestorSummary }) {
  if (!summary) return null;
  return (
    <div
      className="card"
      style={{
        padding: '24px 22px',
        marginBottom: 24,
        background: 'linear-gradient(180deg, color-mix(in srgb, var(--amber) 6%, transparent) 0%, rgba(240,240,250,0.02) 100%)',
        border: '1px solid color-mix(in srgb, var(--amber) 30%, transparent)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <span style={S.kMono}>INVESTOR BRIEFING · 投资逻辑</span>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 18,
              fontWeight: 700,
              color: 'var(--amber)',
              letterSpacing: 0.5,
              marginTop: 4,
            }}
          >
            {summary.thesis}
          </div>
        </div>
        <span className="crowd-badge neutral" style={{ fontSize: 11, padding: '4px 12px' }}>
          三项观察变量
        </span>
      </div>

      <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.65, marginTop: 10, paddingBottom: 16, borderBottom: '1px solid var(--line)' }}>
        <b>跟踪要点 · </b>
        {summary.takeaway}
      </div>

      {/* 三个核心变量卡片 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 250px), 1fr))', gap: 14, marginTop: 18 }}>
        {summary.coreVariables.map((v, idx) => (
          <div
            key={v.id}
            style={{
              padding: '16px 14px',
              background: 'rgba(0,0,0,0.45)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-sharp)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={S.kMono}>VAR 0{idx + 1} · {v.role}</span>
                <span
                  className={`crowd-badge ${
                    v.status.includes('上修') ? 'neutral' : v.status.includes('紧缺') ? 'danger' : 'warning'
                  }`}
                >
                  {v.status}
                </span>
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
                {v.name}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6, marginTop: 8 }}>
                {v.reading}
              </div>
            </div>
            <div style={{ ...S.imply, marginTop: 10, paddingTop: 8, fontSize: 11, color: 'var(--amber)' }}>
              <b>含义 · </b>{v.implication}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* —— 2. 雷达图与诊断面板 —— */
function RadarWebChart({
  items,
  activeId,
  onSelect,
}: {
  items: RiskItem[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const size = 320;
  const center = size / 2;
  const radius = 108;
  const count = items.length || 5;

  const getCoordinates = (index: number, valNorm: number, rOffset = 0) => {
    const angle = (Math.PI * 2 / count) * index - Math.PI / 2;
    const r = radius * valNorm + rOffset;
    return {
      x: center + r * Math.cos(angle),
      y: center + r * Math.sin(angle),
      angle,
    };
  };

  const gridLevels = [0.2, 0.4, 0.6, 0.8, 1.0];
  const gridPolygons = gridLevels.map((lvl) => {
    const pts = items.map((_, i) => {
      const { x, y } = getCoordinates(i, lvl);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return { lvl, pts };
  });

  const dataPoints = items.map((item, i) => {
    const norm = Math.max(0.15, Math.min(1.0, (item.level || 1) / 5));
    return getCoordinates(i, norm);
  });
  const dataPolygonPts = dataPoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', width: '100%', maxWidth: size, margin: '0 auto' }}>
      <svg width="100%" height="auto" viewBox={`0 0 ${size} ${size}`} style={{ overflow: 'visible', maxWidth: size, aspectRatio: '1 / 1' }}>
        <defs>
          <radialGradient id="radarGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="color-mix(in srgb, var(--amber) 35%, transparent)" />
            <stop offset="70%" stopColor="color-mix(in srgb, var(--up) 20%, transparent)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
        </defs>

        {gridPolygons.map(({ lvl, pts }) => (
          <polygon
            key={lvl}
            points={pts}
            fill={lvl === 1.0 ? 'rgba(240,240,250,0.015)' : 'none'}
            stroke="rgba(240, 240, 250, 0.12)"
            strokeWidth={lvl === 1.0 ? 1.2 : 0.8}
            strokeDasharray={lvl < 1.0 ? '3,3' : undefined}
          />
        ))}

        {items.map((_, i) => {
          const { x, y } = getCoordinates(i, 1.0);
          return (
            <line
              key={i}
              x1={center}
              y1={center}
              x2={x}
              y2={y}
              stroke="rgba(240, 240, 250, 0.18)"
              strokeWidth={1}
            />
          );
        })}

        <polygon
          points={dataPolygonPts}
          fill="url(#radarGlow)"
          stroke="var(--amber)"
          strokeWidth={2}
          strokeLinejoin="round"
          style={{ filter: 'drop-shadow(0 0 8px color-mix(in srgb, var(--amber) 40%, transparent))', transition: 'all 0.3s ease' }}
        />

        {items.map((item, i) => {
          const pt = dataPoints[i];
          const labelPt = getCoordinates(i, 1.0, 24);
          const isSelected = item.id === activeId;
          const isCritical = item.status === 'critical';
          const isWarning = item.status === 'warning';
          const dotColor = isCritical ? 'var(--up)' : isWarning ? 'var(--amber)' : 'rgba(240, 240, 250, 0.7)';

          return (
            <g
              key={item.id}
              onClick={() => onSelect(item.id)}
              style={{ cursor: 'pointer' }}
            >
              {isSelected && (
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={10}
                  fill="none"
                  stroke={dotColor}
                  strokeWidth={1.5}
                  strokeDasharray="2,2"
                />
              )}
              <circle
                cx={pt.x}
                cy={pt.y}
                r={isSelected ? 5.5 : 4}
                fill={dotColor}
                stroke="#000"
                strokeWidth={1.5}
              />
              <text
                x={labelPt.x}
                y={labelPt.y + (labelPt.y > center ? 4 : -2)}
                textAnchor={labelPt.x < center - 10 ? 'end' : labelPt.x > center + 10 ? 'start' : 'middle'}
                fill={isSelected ? '#ffffff' : 'rgba(240,240,250,0.72)'}
                fontSize={11}
                fontWeight={isSelected ? 700 : 500}
                fontFamily="var(--font-display)"
                letterSpacing={0.4}
              >
                {item.title}
              </text>
              <text
                x={labelPt.x}
                y={labelPt.y + (labelPt.y > center ? 15 : 9)}
                textAnchor={labelPt.x < center - 10 ? 'end' : labelPt.x > center + 10 ? 'start' : 'middle'}
                fill={dotColor}
                fontSize={9}
                fontFamily="var(--font-mono)"
              >
                L{item.level} · {item.status.toUpperCase()}
              </text>
            </g>
          );
        })}
      </svg>
      <div style={{ ...S.kMono, fontSize: 9, marginTop: 4, color: 'var(--text-faint)' }}>
        点选顶点查看该项
      </div>
    </div>
  );
}

function RiskRadarSection({ items }: { items: RiskItem[] }) {
  const [activeId, setActiveId] = useState<string>(items[0]?.id || 'upstream_chips');
  const activeItem = items.find((it) => it.id === activeId) || items[0];

  const totalScore = items.reduce((acc, it) => acc + (it.level || 0), 0);
  const maxScore = items.length * 5;
  const scorePct = Math.round((totalScore / maxScore) * 100);
  const criticalCount = items.filter((it) => it.status === 'critical').length;
  const warningCount = items.filter((it) => it.status === 'warning').length;
  const leadRisk = items.find((it) => it.status === 'critical');
  const bottleneck = items.find((it) => it.id === 'upstream_chips');

  const globalStatus = criticalCount > 0 ? 'CRITICAL ALERT' : warningCount >= 2 ? 'ELEVATED WATCH' : 'MODERATE';
  const globalBadge = criticalCount > 0 ? 'danger' : warningCount >= 2 ? 'warning' : 'cold';

  if (!items.length) {
    return (
      <div className="card" style={S.pad}>
        <div style={S.reading}>{EMPTY}</div>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: '24px 22px' }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          paddingBottom: 20,
          borderBottom: '1px solid var(--line)',
          marginBottom: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              background: criticalCount > 0 ? 'var(--up)' : 'var(--amber)',
              boxShadow: `0 0 10px ${criticalCount > 0 ? 'var(--up)' : 'var(--amber)'}`,
            }}
          />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, letterSpacing: 0.6 }}>
                风险跟踪
              </span>
              <span className={`crowd-badge ${globalBadge}`}>{globalStatus}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 2 }}>
              等级合计 {totalScore} / {maxScore}（{scorePct}%）。高优先级 {criticalCount} 项，观察 {warningCount} 项
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ textAlign: 'left' }}>
            <div style={S.kMono}>主要风险项</div>
            <div style={{ color: leadRisk?.status === 'critical' ? 'var(--up)' : 'var(--amber)', fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
              {leadRisk?.title || '持仓集中'}
            </div>
          </div>
          <div style={{ textAlign: 'left', borderLeft: '1px solid var(--line)', paddingLeft: 16 }}>
            <div style={S.kMono}>核心瓶颈项</div>
            <div style={{ color: bottleneck?.status === 'critical' ? 'var(--up)' : 'var(--amber)', fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
              {bottleneck?.title || '芯片供给'}
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
          gap: 24,
          alignItems: 'start',
        }}
      >
        <div
          style={{
            padding: '16px 12px',
            background: 'rgba(240, 240, 250, 0.02)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-sharp)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, padding: '0 8px' }}>
            <span style={S.kMono}>5-AXIS RADAR SCOPE</span>
            <span className="mono" style={{ fontSize: 10, color: 'var(--amber)' }}>
              LOAD: {scorePct}%
            </span>
          </div>
          <RadarWebChart items={items} activeId={activeId} onSelect={setActiveId} />
        </div>

        {activeItem && (
          <div
            style={{
              padding: '20px 22px',
              background: 'rgba(240, 240, 250, 0.03)',
              border: `1px solid ${activeItem.status === 'critical' ? 'color-mix(in srgb, var(--up) 35%, transparent)' : 'var(--ghost-border-hover)'}`,
              borderRadius: 'var(--radius-sharp)',
            }}
          >
            <div className="real-crowd-head" style={{ marginBottom: 10 }}>
              <div>
                <span style={{ ...S.kMono, display: 'block', marginBottom: 2 }}>
                  TARGET DIAGNOSIS · AXIS 0{items.findIndex((it) => it.id === activeItem.id) + 1}
                </span>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
                  {activeItem.title}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                  SEVERITY LVL {activeItem.level}/5
                </span>
                <span className={`crowd-badge ${riskBadge(activeItem.status)}`}>
                  {riskLabel(activeItem.status)}
                </span>
              </div>
            </div>

            <div style={{ padding: '8px 12px', background: 'rgba(0,0,0,0.4)', borderRadius: 2, marginBottom: 14 }}>
              <div style={S.kMono}>跟踪指标</div>
              <div style={{ color: 'var(--text)', fontSize: 13, marginTop: 2 }}>{activeItem.metric}</div>
            </div>

            <div>
              <div style={S.kMono}>当前读数</div>
              <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.65, marginTop: 4 }}>
                {activeItem.reading || EMPTY}
              </div>
            </div>

            <div style={{ ...S.imply, marginTop: 14, paddingTop: 12 }}>
              <b>含义 · </b>
              {activeItem.implication}
            </div>

            <div style={{ marginTop: 20, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
              <span style={{ ...S.kMono, display: 'block', marginBottom: 8 }}>
                QUICK SWITCH AXIS
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {items.map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => setActiveId(it.id)}
                    style={{
                      background: it.id === activeId ? 'rgba(240,240,250,0.18)' : 'rgba(240,240,250,0.05)',
                      border: `1px solid ${it.id === activeId ? 'var(--ghost-border-hover)' : 'var(--line)'}`,
                      color: it.id === activeId ? '#fff' : 'var(--text-dim)',
                      padding: '6px 12px',
                      minHeight: 32,
                      WebkitTapHighlightColor: 'transparent',
                      borderRadius: 'var(--radius-sharp)',
                      cursor: 'pointer',
                      fontSize: 11,
                      fontFamily: 'var(--font-display)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: it.status === 'critical' ? 'var(--up)' : it.status === 'warning' ? 'var(--amber)' : 'rgba(240, 240, 250, 0.7)',
                      }}
                    />
                    {it.title}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* —— 3. 国盛证券「三重周期」分析框架 —— */
function TripleCycleCard({
  framework,
  coreInsight,
  dimensions,
  synthesis,
}: {
  framework?: string;
  coreInsight?: string;
  dimensions: CycleDim[];
  synthesis: string;
}) {
  if (!dimensions.length) {
    return (
      <div className="card signal">
        <div className="v-sub">{EMPTY}</div>
      </div>
    );
  }
  return (
    <div className="card" style={{ padding: '24px 22px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <div style={S.kMono}>{framework || '国盛证券「三重周期」分析框架'}</div>
        <span className="crowd-badge neutral">价格与产业方向可背离</span>
      </div>

      {coreInsight && (
        <div
          style={{
            padding: '12px 16px',
            background: 'color-mix(in srgb, var(--amber) 8%, transparent)',
            borderLeft: '3px solid var(--amber)',
            borderRadius: '0 var(--radius-sharp) var(--radius-sharp) 0',
            fontSize: 13,
            color: 'var(--text)',
            lineHeight: 1.6,
            marginBottom: 20,
          }}
        >
          <b>框架要点 · </b>
          {coreInsight}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 250px), 1fr))', gap: 14 }}>
        {dimensions.map((dim) => (
          <div
            key={dim.cycle}
            style={{
              padding: '18px 16px',
              background: 'rgba(240,240,250,0.03)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-sharp)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div className="real-crowd-head" style={{ marginBottom: 6 }}>
                <div>
                  <span style={{ ...S.kMono, display: 'block', fontSize: 9 }}>{dim.logic || '周期逻辑'}</span>
                  <span className="real-crowd-title" style={{ fontSize: 16 }}>{dim.cycle}</span>
                </div>
                <span className={`crowd-badge ${cycleBadge(dim.status)}`}>{cycleArrow(dim.status)}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--amber)', marginTop: 4, fontWeight: 600 }}>
                {dim.meaning}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 6 }}>
                核心变量：{dim.keyVars}
              </div>
              <div style={{ ...S.reading, marginTop: 10, fontSize: 12 }}>{dim.detail}</div>
            </div>
          </div>
        ))}
      </div>

      {synthesis && (
        <div className="sig-watch" style={{ marginTop: 20, background: 'rgba(0,0,0,0.4)', padding: '14px 16px' }}>
          <b style={{ color: 'var(--text)' }}>综合 · </b>
          {synthesis}
        </div>
      )}
    </div>
  );
}

/* —— 4. 成本与壁垒结构 —— */
function DriverBom({
  driver,
  bom,
}: {
  driver?: IndustryDriver;
  bom?: { coreConflict?: string; note?: string; items: BomItem[] };
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: 16 }}>
      {/* 驱动力切换 */}
      <div className="card" style={{ padding: '22px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={S.kMono}>DRIVER SHIFT · 需求来源切换</span>
            <span className="crowd-badge neutral">电信 ➔ AI 算力</span>
          </div>

          {!driver ? (
            <div style={S.reading}>{EMPTY}</div>
          ) : (
            <>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 130px), 1fr))',
                  gap: 12,
                  alignItems: 'start',
                  marginTop: 16,
                  paddingBottom: 16,
                  borderBottom: '1px solid var(--line)',
                }}
              >
                <div>
                  <div className="crowd-badge unknown" style={{ display: 'inline-block', fontSize: 10 }}>
                    FROM
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontWeight: 700,
                      fontSize: 16,
                      marginTop: 8,
                      color: 'var(--text-dim)',
                    }}
                  >
                    {driver.from.cycle}
                  </div>
                  <ul style={{ margin: '10px 0 0', paddingLeft: 16, color: 'var(--text-faint)', fontSize: 12, lineHeight: 1.65 }}>
                    {driver.from.traits.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                </div>
                <div
                  style={{
                    alignSelf: 'center',
                    justifySelf: 'center',
                    fontFamily: 'var(--font-display)',
                    fontSize: 18,
                    fontWeight: 700,
                    color: 'var(--amber)',
                    padding: '4px 0',
                  }}
                >
                  ➔
                </div>
                <div>
                  <div className="crowd-badge neutral" style={{ display: 'inline-block', fontSize: 10 }}>
                    TO
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontWeight: 700,
                      fontSize: 16,
                      marginTop: 8,
                      color: 'var(--text)',
                    }}
                  >
                    {driver.to.cycle}
                  </div>
                  <ul style={{ margin: '10px 0 0', paddingLeft: 16, color: 'var(--text-dim)', fontSize: 12, lineHeight: 1.65 }}>
                    {driver.to.traits.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                </div>
              </div>

              {driver.marketScale && (
                <div style={{ marginTop: 14, padding: '10px 12px', background: 'color-mix(in srgb, var(--amber) 6%, transparent)', borderRadius: 'var(--radius-sharp)' }}>
                  <div style={S.kMono}>全球市场规模（卖方预测）</div>
                  <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.6, marginTop: 4 }}>
                    {driver.marketScale}
                  </div>
                </div>
              )}

              {driver.coreTrackers && (
                <div style={{ marginTop: 14 }}>
                  <div style={S.kMono}>核心跟踪指标</div>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 16, color: 'var(--text-dim)', fontSize: 12, lineHeight: 1.65 }}>
                    {driver.coreTrackers.map((tr) => (
                      <li key={tr}>{tr}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 成本与壁垒结构 */}
      <div className="card" style={{ padding: '22px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={S.kMono}>VALUE CHAIN · 成本结构与利润分布</span>
            <span className="crowd-badge danger">组装门槛下移 · 芯片供给约束</span>
          </div>

          {bom?.coreConflict && (
            <div
              style={{
                marginTop: 12,
                padding: '10px 12px',
                background: 'color-mix(in srgb, var(--up) 8%, transparent)',
                borderLeft: '3px solid var(--up)',
                borderRadius: '0 var(--radius-sharp) var(--radius-sharp) 0',
                fontSize: 12,
                color: 'var(--text)',
                lineHeight: 1.6,
              }}
            >
              <b>结构要点 · </b>
              {bom.coreConflict}
            </div>
          )}

          {!bom?.items?.length ? (
            <div style={S.reading}>{EMPTY}</div>
          ) : (
            <div style={{ marginTop: 14 }}>
              {bom.items.map((row) => (
                <div key={row.name} style={{ marginTop: 12, padding: '8px 10px', background: 'rgba(0,0,0,0.3)', borderRadius: 2 }}>
                  <div className="real-crowd-head" style={{ marginBottom: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="real-crowd-title" style={{ fontSize: 14 }}>{row.name}</span>
                      {row.status && (
                        <span
                          className={`crowd-badge ${
                            row.status.includes('紧缺') || row.status.includes('瓶颈') || row.status.includes('偏紧') || row.status.includes('约束') ? 'danger' : 'neutral'
                          }`}
                          style={{ fontSize: 9, padding: '1px 6px' }}
                        >
                          {row.status}
                        </span>
                      )}
                    </div>
                    <span className="mono num" style={{ fontSize: 11, color: 'var(--amber)' }}>
                      {row.share} · 毛利 {row.margin}
                    </span>
                  </div>
                  <div style={S.barTrack}>
                    <div
                      style={{
                        width: `${shareWidth(row.share)}%`,
                        height: '100%',
                        background:
                          row.share.includes('30') || row.share.includes('25')
                            ? 'linear-gradient(90deg, var(--up), var(--amber))'
                            : 'rgba(240,240,250,0.4)',
                      }}
                    />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 6 }}>供给方：{row.players}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5, marginTop: 4 }}>{row.barriers}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* —— 5. 技术演进矩阵 —— */
function TechRoadmap({ matrix }: { matrix?: { trapWarning?: string; routes: TechRoute[] } | TechRoute[] }) {
  const routes = Array.isArray(matrix) ? matrix : matrix?.routes || [];
  const trapWarning = !Array.isArray(matrix) ? matrix?.trapWarning : undefined;

  return (
    <div className="card" style={{ padding: '22px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <div style={S.kMono}>TECH ROADMAP MATRIX · 多路径并行</div>
        <span className="crowd-badge neutral">可插拔与硅光为近端主要路径</span>
      </div>

      {trapWarning && (
        <div
          style={{
            padding: '12px 16px',
            background: 'color-mix(in srgb, var(--amber) 8%, transparent)',
            borderLeft: '3px solid var(--amber)',
            borderRadius: '0 var(--radius-sharp) var(--radius-sharp) 0',
            fontSize: 13,
            color: 'var(--text)',
            lineHeight: 1.6,
            marginBottom: 18,
          }}
        >
          <b>路径判断 · </b>
          {trapWarning}
        </div>
      )}

      {!routes.length ? (
        <div style={S.reading}>{EMPTY}</div>
      ) : (
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
            <thead>
              <tr>
                <th style={S.th}>路线定位</th>
                <th style={S.th}>速率 / 架构</th>
                <th style={S.th}>时间窗口</th>
                <th style={S.th}>成熟度</th>
                <th style={S.th}>替代威胁</th>
                <th style={S.th}>产业含义</th>
              </tr>
            </thead>
            <tbody>
              {routes.map((r) => (
                <tr key={r.route}>
                  <td style={{ ...S.td, color: 'var(--text)' }}>
                    <div style={{ fontWeight: 600 }}>{r.route}</div>
                    {r.role && <div style={{ fontSize: 10, color: 'var(--amber)', fontFamily: 'var(--font-mono)' }}>{r.role}</div>}
                  </td>
                  <td style={{ ...S.td, fontFamily: 'var(--font-mono)', fontSize: 12 }}>{r.rate}</td>
                  <td style={S.td}>{r.timeline}</td>
                  <td style={S.td}>{r.maturity}</td>
                  <td style={S.td}>
                    <span className={`crowd-badge ${threatTone(r.threatLevel)}`}>{r.threatLevel}</span>
                  </td>
                  <td style={{ ...S.td, fontSize: 12 }}>{r.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* —— 6. 竞争格局与结构性风险 —— */
function CompetitionBoard({ competition }: { competition?: { summary?: string; structuralRisks?: { title: string; desc: string }[]; players: Competitor[] } }) {
  if (!competition) return null;

  return (
    <div className="card" style={{ padding: '22px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <div style={S.kMono}>COMPETITION LANDSCAPE · 份额集中</div>
        <span className="crowd-badge neutral">前五市占 61.4%（LightCounting） · 交付约束份额</span>
      </div>

      {competition.summary && (
        <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.65, marginBottom: 18 }}>
          {competition.summary}
        </div>
      )}

      {/* 结构性变化与风险警示 */}
      {competition.structuralRisks && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 12, marginBottom: 20 }}>
          {competition.structuralRisks.map((risk, i) => (
            <div
              key={risk.title}
              style={{
                padding: '12px 14px',
                background: 'rgba(0,0,0,0.4)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-sharp)',
              }}
            >
              <div style={{ ...S.kMono, color: 'var(--up)', marginBottom: 4 }}>STRUCTURAL RISK 0{i + 1}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                {risk.title}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.55, marginTop: 4 }}>
                {risk.desc}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 玩家卡片 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 12 }}>
        {competition.players.map((p) => (
          <div
            key={`${p.name}-${p.symbol}`}
            style={{
              padding: '16px 14px',
              background: 'rgba(240,240,250,0.03)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-sharp)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div className="real-crowd-head" style={{ marginBottom: 6 }}>
                <span className="real-crowd-title" style={{ fontSize: 16 }}>
                  {p.name}
                  {p.symbol && p.symbol !== '—' && (
                    <span className="mono" style={{ marginLeft: 6, color: 'var(--text-faint)', fontSize: 11 }}>
                      {p.symbol}
                    </span>
                  )}
                </span>
                <span className="crowd-badge neutral">{p.tier}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6, marginTop: 8 }}>
                {p.advantage}
              </div>
            </div>
            <div style={{ ...S.imply, marginTop: 10, paddingTop: 8, fontSize: 11 }}>
              {p.globalShare}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* —— 7. 前瞻估值锚与安全边际 —— */
function ValuationTable({
  valuation,
}: {
  valuation?: {
    guidance?: string;
    peBand?: { staticDesc: string; forward2026: string; forward2027: string; pegRule: string };
    items: ValuationRow[];
  };
}) {
  if (!valuation) return null;

  return (
    <div className="card" style={{ padding: '22px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <div style={S.kMono}>VALUATION ANCHOR · 前瞻 PE 与 PEG</div>
        <span className="crowd-badge neutral">静态分位与前瞻中枢</span>
      </div>

      {valuation.guidance && (
        <div
          style={{
            padding: '12px 16px',
            background: 'color-mix(in srgb, var(--amber) 8%, transparent)',
            borderLeft: '3px solid var(--amber)',
            borderRadius: '0 var(--radius-sharp) var(--radius-sharp) 0',
            fontSize: 13,
            color: 'var(--text)',
            lineHeight: 1.6,
            marginBottom: 18,
          }}
        >
          <b>框架说明 · </b>
          {valuation.guidance}
        </div>
      )}

      {/* 估值分阶参考框 */}
      {valuation.peBand && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: 12, marginBottom: 20 }}>
          <div style={{ padding: '12px 14px', background: 'rgba(0,0,0,0.4)', borderRadius: 'var(--radius-sharp)' }}>
            <div style={S.kMono}>静态 PE</div>
            <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 4 }}>{valuation.peBand.staticDesc}</div>
          </div>
          <div style={{ padding: '12px 14px', background: 'rgba(0,0,0,0.4)', borderRadius: 'var(--radius-sharp)' }}>
            <div style={S.kMono}>2026 前瞻中枢</div>
            <div style={{ fontSize: 13, color: 'var(--amber)', fontWeight: 700, marginTop: 4 }}>{valuation.peBand.forward2026}</div>
          </div>
          <div style={{ padding: '12px 14px', background: 'rgba(0,0,0,0.4)', borderRadius: 'var(--radius-sharp)' }}>
            <div style={S.kMono}>2027 远期折算</div>
            <div style={{ fontSize: 13, color: 'rgba(240, 240, 250, 0.7)', fontWeight: 700, marginTop: 4 }}>{valuation.peBand.forward2027}</div>
          </div>
          <div style={{ padding: '12px 14px', background: 'rgba(0,0,0,0.4)', borderRadius: 'var(--radius-sharp)' }}>
            <div style={S.kMono}>PEG 参照</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>{valuation.peBand.pegRule}</div>
          </div>
        </div>
      )}

      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
          <thead>
            <tr>
              <th style={S.th}>标的 / 参照线</th>
              <th style={S.th}>NTM PE 测算</th>
              <th style={S.th}>动态 PEG</th>
              <th style={S.th}>估值性质</th>
              <th style={S.th}>业绩与风险跟踪重点</th>
            </tr>
          </thead>
          <tbody>
            {valuation.items.map((row) => (
              <tr key={row.name}>
                <td style={{ ...S.td, color: 'var(--text)', fontWeight: 600 }}>{row.name}</td>
                <td style={{ ...S.td, fontFamily: 'var(--font-mono)', color: 'var(--amber)' }}>{row.ntmPe}</td>
                <td style={{ ...S.td, fontFamily: 'var(--font-mono)' }}>{row.peg}</td>
                <td style={S.td}>
                  <span
                    className={`crowd-badge ${
                      row.status === 'growth_peg' ? 'neutral' : row.status === 'framework' ? 'warning' : 'cold'
                    }`}
                  >
                    {row.status === 'growth_peg' ? '高增' : row.status === 'framework' ? '情景阈值' : row.status}
                  </span>
                </td>
                <td style={{ ...S.td, fontSize: 12 }}>{row.growthExp}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* —— 8. 宏观联动快照 —— */
function MacroStrip({
  rate,
  capexLive,
  capexV,
  capexWatch,
  names,
  soxLast,
  soxDate,
}: {
  rate: Rate;
  capexLive: boolean;
  capexV?: string;
  capexWatch?: string;
  names: NameQuote[];
  soxLast: number | undefined;
  soxDate: string;
}) {
  return (
    <div className="base-grid">
      <div className="card real-crowd-card">
        <div className="real-crowd-head">
          <span className="real-crowd-title">{rate.k}</span>
          <span className={`crowd-badge ${citedRate(rate) ? 'neutral' : 'unknown'}`}>
            {citedRate(rate) ? (rate.shift === 'stuck' ? '速率持平' : '结构上移') : EMPTY}
          </span>
        </div>
        <div className="real-crowd-desc">{citedRate(rate) ? rate.reading : rate.metric}</div>
        {citedRate(rate) && (
          <div className="real-crowd-detail">
            {rate.asOf} · {rate.source}
          </div>
        )}
      </div>
      <div className="card real-crowd-card">
        <div className="real-crowd-head">
          <span className="real-crowd-title">开支方向</span>
          <span className={`crowd-badge ${capexLive ? 'neutral' : 'unknown'}`}>
            {capexLive ? capexV : EMPTY}
          </span>
        </div>
        <div className="real-crowd-desc">{capexLive ? capexWatch : '引用宏观页云厂商资本开支读数'}</div>
      </div>
      <div className="card real-crowd-card">
        <div className="real-crowd-head">
          <span className="real-crowd-title">相对费城半导体指数</span>
          <span className={`crowd-badge ${names.length ? 'neutral' : 'unknown'}`}>
            {names.length ? '标的报价' : EMPTY}
          </span>
        </div>
        <div className="real-crowd-desc">
          费城半导体指数近半年累计（起点为 0）
          {typeof soxLast === 'number' ? ` ${soxLast > 0 ? '+' : ''}${soxLast.toFixed(1)}%` : ' —'}
          {soxDate ? `，截至 ${soxDate}` : ''}。以下为个股，非行业指数。
        </div>
        {names.length > 0 && (
          <div className="real-crowd-detail">
            {names
              .map(
                (item) =>
                  `${item.name}（${item.symbol}，标的）${item.cumPct > 0 ? '+' : ''}${item.cumPct.toFixed(1)}%，${item.asOf}`,
              )
              .join('；')}
          </div>
        )}
      </div>
    </div>
  );
}

/* —— 主组件 —— */
export default function OpticsPanel() {
  const data = opticsData satisfies OpticsPayload;
  const { head, rate, names, footer } = data;
  const summary = data.investorSummary;
  const risks = data.riskRadar ?? [];
  const driver = data.industryDriver;
  const bom = data.bomBreakdown;
  const matrix = data.techMatrix;
  const triple = data.tripleCycle;
  const competition = data.competition;
  const valuation = data.valuation;

  const capex = techSemiData.fundamental?.items?.find((item) => item.k === '四大 CSP 资本开支');
  const capexLive = Boolean(capex && capex.status !== 'pending' && capex.v && capex.v !== '未接入');
  const sox = techSemiData.charts.normalized.sox;
  const soxDates = techSemiData.charts.normalized.dates;
  const soxLast = sox.length ? sox[sox.length - 1] : undefined;
  const soxDate = soxDates.length ? soxDates[soxDates.length - 1] : '';
  const share = techSemiData.crowding?.turnoverShare?.value;
  const margin = techSemiData.leverage?.marginBuyShare?.value;

  const liveRisks = enrichRisks(risks, capex, share, margin);

  return (
    <article>
      <header className="hero">
        <img
          className="hero-bg"
          src={heroOptics}
          alt="数据中心光网络 · 高速光纤与光收发模块互联"
        />
        <span className="hero-scrim" aria-hidden="true" />
        <div className="hero-inner">
          <div className="hero-main">
            <div className="kicker">{head.kicker}</div>
            <h1>{head.title}</h1>
            <p className="hero-lead">{head.sub}</p>
          </div>
        </div>
      </header>

      <div className="content">
        {/* 核心观察变量看板 */}
        <CoreVariablesBoard summary={summary} />

        {/* 雷达图与诊断面板 */}
        <h2 className="sec-title">
          风险雷达
          <span className="hint">五项跟踪信号 · 点选查看读数与含义</span>
        </h2>
        <RiskRadarSection items={liveRisks} />

        {/* 维度 2：国盛证券「三重周期」分析框架 */}
        <h2 className="sec-title" style={{ marginTop: 28 }}>
          国盛「三重周期」分析框架
          <span className="hint">供需周期（产业向上） × 筹码周期（交易层面消化） × 业绩周期（季报兑现）</span>
        </h2>
        <TripleCycleCard
          framework={triple?.framework}
          coreInsight={triple?.coreInsight}
          dimensions={triple?.dimensions ?? []}
          synthesis={triple?.synthesis ?? ''}
        />

        {/* 成本与壁垒结构 */}
        <h2 className="sec-title" style={{ marginTop: 28 }}>
          产业驱动力与利润分配
          <span className="hint">电信周期转向 AI 算力集群 · 组装门槛下移，芯片供给构成约束（预付款 14.88 亿元，中际旭创 2026 年一季报）</span>
        </h2>
        <DriverBom driver={driver} bom={bom} />

        {/* 技术演进矩阵 */}
        <h2 className="sec-title" style={{ marginTop: 28 }}>
          技术路线演进矩阵
          <span className="hint">可插拔仍为近端主力 · 硅光渗透（1.6T 超 50%）· CPO 规模化仍待 3–5 年</span>
        </h2>
        <TechRoadmap matrix={matrix} />

        {/* 维度 5：竞争格局与结构性变化 */}
        <h2 className="sec-title" style={{ marginTop: 28 }}>
          竞争格局 · 交付壁垒与结构风险
          <span className="hint">全球前五市占 61.4%（LightCounting） · 关注跨界与持仓再平衡</span>
        </h2>
        <CompetitionBoard competition={competition} />

        {/* 维度 6：前瞻估值锚与安全边际 */}
        <h2 className="sec-title" style={{ marginTop: 28 }}>
          前瞻估值参照 · PE 与 PEG
          <span className="hint">静态 PE 60–85x · 2026E 前瞻约 20–25x（框架）· 毛利承压时前瞻盈利下修</span>
        </h2>
        <ValuationTable valuation={valuation} />

        {/* 宏观联动快照 */}
        <h2 className="sec-title" style={{ marginTop: 28 }}>
          宏观联动快照
          <span className="hint">开支方向引用宏观页同一读数</span>
        </h2>
        <MacroStrip
          rate={rate}
          capexLive={capexLive}
          capexV={capex?.v}
          capexWatch={capex?.watch}
          names={names}
          soxLast={soxLast}
          soxDate={soxDate}
        />

        {/* 综合研判 */}
        <h2 className="sec-title" style={{ marginTop: 28 }}>
          综合研判
          <span className="hint">三重周期 · 开支与速率 · 相对费城半导体指数与拥挤度</span>
        </h2>
        <div className="card signal">
          <div className="sig-verdict">
            <div className="v-main">
              {opticsVerdict(rate, capex?.v, capexLive, names, soxLast, triple?.synthesis)}
            </div>
          </div>
        </div>

        <footer className="src">{footer}</footer>
      </div>
    </article>
  );
}
