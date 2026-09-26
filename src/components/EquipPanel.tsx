import heroSemi from '../assets/hero-semi.jpg';
import equipData from '../data/equipData.json';

const EMPTY = '未接入 · 还没有可引用的披露';

type Reading = {
  k: string;
  metric: string;
  status: string;
  asOf: string;
  source: string;
  v: string;
  reading: string;
};

function cited(item: Reading) {
  return item.status === 'live' && Boolean(item.asOf && item.source && item.reading);
}

function equipVerdict(items: Reading[]) {
  const ready = items.filter(cited);
  if (!ready.length) return '订单、交期和耗材都还没有可引用的披露，本页不写装机是否跟上。';
  const body = ready.map((item) => `${item.k}：${item.reading}（${item.asOf}，${item.source}）`).join('。');
  return `${body}。只根据这几格已填的披露，不引用指数涨跌或成交占比。`;
}

export default function EquipPanel() {
  const { head, items, footer } = equipData;

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
            <span className="hero-chip">EQUIPMENT · MATERIALS</span>
            <span className="hero-credit">影像 · DrHughManning / 12 英寸微电子硅晶圆 / CC BY-SA 4.0 / 维基共享资源</span>
          </div>
        </div>
      </header>
      <div className="content">
        <h2 className="sec-title">
          最近一次披露
          <span className="hint">日期、来源、方向。没有材料就留空</span>
        </h2>
        <div className="base-grid">
          {items.map((item) => (
            <div className="card real-crowd-card" key={item.k}>
              <div className="real-crowd-head">
                <span className="real-crowd-title">{item.k}</span>
                <span className={`crowd-badge ${cited(item) ? 'neutral' : 'unknown'}`}>
                  {cited(item) ? item.v : EMPTY}
                </span>
              </div>
              <div className="real-crowd-desc">{cited(item) ? item.reading : item.metric}</div>
              {cited(item) && (
                <div className="real-crowd-detail">
                  {item.asOf} · {item.source}
                </div>
              )}
            </div>
          ))}
        </div>
        <h2 className="sec-title" style={{ marginTop: 28 }}>
          研判
          <span className="hint">只根据上面已填的格子</span>
        </h2>
        <div className="card signal">
          <div className="sig-verdict">
            <div className="v-main">{equipVerdict(items)}</div>
          </div>
        </div>
        <footer className="src">{footer}</footer>
      </div>
    </article>
  );
}
