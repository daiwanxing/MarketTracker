import heroSemi from '../assets/hero-semi.jpg';
import opticsData from '../data/opticsData.json';
import techSemiData from '../data/techSemiData.json';

const EMPTY = '未接入 · 还没有可引用的披露';

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

function citedRate(rate: Rate) {
  return rate.status === 'live' && Boolean(rate.asOf && rate.source && rate.reading && rate.shift);
}

function opticsVerdict(rate: Rate, capexReading: string | undefined, capexLive: boolean, names: NameQuote[], soxLast: number | undefined) {
  const lines: string[] = [];
  if (citedRate(rate) && capexLive && capexReading) {
    const cut = capexReading.includes('下调');
    const stuck = rate.shift === 'stuck';
    lines.push(
      cut || stuck
        ? `产业前景转弱：云厂商开支为「${capexReading}」，速率结构为「${rate.reading}」（${rate.asOf}，${rate.source}）。`
        : `产业前景还在：开支没有下调（${capexReading}），速率仍在往上换（${rate.reading}，${rate.asOf}，${rate.source}）。`,
    );
  }
  if (typeof soxLast === 'number' && names.length) {
    const alone = names.filter((item) => item.cumPct < 0 && soxLast >= 0);
    const margin = techSemiData.leverage?.marginBuyShare?.value;
    const share = techSemiData.crowding?.turnoverShare?.value;
    if (alone.length) {
      lines.push(
        `${alone.map((item) => `${item.name}累计 ${item.cumPct.toFixed(1)}%`).join('、')}相对费半单独跌回起点下方，多半是交易拥挤解除。`,
      );
    } else {
      lines.push(
        `${names.map((item) => `${item.name}累计 ${item.cumPct > 0 ? '+' : ''}${item.cumPct.toFixed(1)}%`).join('、')}，没有相对费半单独跌回起点下方。`,
      );
    }
    if (typeof margin === 'number' && margin > 9 && typeof share === 'number' && share >= 38) {
      lines.push(`融资买入 ${margin.toFixed(2)}% 高于 9%，主题成交占比 ${share.toFixed(2)}% 极端过热。继续拿，赌的是下一份披露还能上修。`);
    }
  }
  if (!lines.length) return '开支方向、速率结构或标的相对费半还没有可引用的读数，缺的那句不写。本页不下能否继续持有的结论。';
  return lines.join('');
}

export default function OpticsPanel() {
  const { head, rate, names, footer } = opticsData as typeof opticsData & { names: NameQuote[] };
  const capex = techSemiData.fundamental?.items?.find((item) => item.k === '四大 CSP 资本开支');
  const capexLive = Boolean(capex && capex.status !== 'pending' && capex.v && capex.v !== '未接入');
  const sox = techSemiData.charts.normalized.sox;
  const soxDates = techSemiData.charts.normalized.dates;
  const soxLast = sox.length ? sox[sox.length - 1] : undefined;
  const soxDate = soxDates.length ? soxDates[soxDates.length - 1] : '';

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
            <span className="hero-chip">OPTICS · MODULES</span>
            <span className="hero-credit">影像 · DrHughManning / 12 英寸微电子硅晶圆 / CC BY-SA 4.0 / 维基共享资源</span>
          </div>
        </div>
      </header>
      <div className="content">
        <h2 className="sec-title">
          最近一次披露
          <span className="hint">开支方向引用宏观页同一格，不另造一套数字</span>
        </h2>
        <div className="base-grid">
          <div className="card real-crowd-card">
            <div className="real-crowd-head">
              <span className="real-crowd-title">{rate.k}</span>
              <span className={`crowd-badge ${citedRate(rate) ? 'neutral' : 'unknown'}`}>
                {citedRate(rate) ? (rate.shift === 'stuck' ? '停在旧速率' : '往上换') : EMPTY}
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
                {capexLive ? capex?.v : EMPTY}
              </span>
            </div>
            <div className="real-crowd-desc">{capexLive ? capex?.watch : '与科技指数宏观同一条云厂商资本开支结论'}</div>
          </div>
          <div className="card real-crowd-card">
            <div className="real-crowd-head">
              <span className="real-crowd-title">相对费半</span>
              <span className={`crowd-badge ${names.length ? 'neutral' : 'unknown'}`}>
                {names.length ? '标的报价' : EMPTY}
              </span>
            </div>
            <div className="real-crowd-desc">
              费半近半年累计（起点为 0）
              {typeof soxLast === 'number' ? ` ${soxLast > 0 ? '+' : ''}${soxLast.toFixed(1)}%` : ' —'}
              {soxDate ? `，截至 ${soxDate}` : ''}。下面是标的，不是行业指数。
            </div>
            {names.length > 0 && (
              <div className="real-crowd-detail">
                {names
                  .map((item) => `${item.name}（${item.symbol}，标的）${item.cumPct > 0 ? '+' : ''}${item.cumPct.toFixed(1)}%，${item.asOf}`)
                  .join('；')}
              </div>
            )}
          </div>
        </div>
        <h2 className="sec-title" style={{ marginTop: 28 }}>
          研判
          <span className="hint">第一句看开支和速率，第二句看价格和宏观页已有的融资、成交占比</span>
        </h2>
        <div className="card signal">
          <div className="sig-verdict">
            <div className="v-main">{opticsVerdict(rate, capex?.v, capexLive, names, soxLast)}</div>
          </div>
        </div>
        <footer className="src">{footer}</footer>
      </div>
    </article>
  );
}
