import ensoData from '../data/ensoData.json';
import heroEnso from '../assets/hero-enso.jpg';
import { useReveal } from '../hooks/useReveal';

export default function EnsoPanel() {
  const tlRef = useReveal<HTMLDivElement>();
  const vwRef = useReveal<HTMLDivElement>();
  const { editions, footer, lastUpdated } = ensoData;

  return (
    <article>
      <header className="hero">
        <img className="hero-bg" src={heroEnso} alt="1997 年 3-8 月 AVHRR 海表温度距平（NASA SVS · 公有领域）" />
        <span className="hero-scrim" aria-hidden="true" />
        <div className="hero-inner">
          <div className="hero-main">
            <div className="kicker">THEME 02 · ENSO</div>
            <h1>厄尔尼诺</h1>
            <p className="hero-lead">Niño3.4 海温距平与官方机构动态，按 NOAA CPC 口径每日追踪事件强度演变。</p>
          </div>
          <div className="hero-aside">
            <span className="hero-chip">ENSO · NOAA CPC</span>
            <span className="hero-meta"><b>最后更新：{lastUpdated}</b></span>
            <span className="hero-credit">影像 · NASA SVS / 1997 年赤道太平洋海表温度距平移 / 公有领域</span>
          </div>
        </div>
      </header>

      <div className="content">
      {editions.map((ed, idx) => (
        <section className="edition" key={idx}>
          <div className="ed-head">
            <span className={ed.badge === '最新一期' ? 'ed-badge hot' : 'ed-badge'}>{ed.badge}</span>
            <h2>{ed.title}</h2>
          </div>

          <div className="card metrics">
            <div className="metric-main">
              <div className={ed.metrics.main.accent ? 'num accent' : 'num'}>{ed.metrics.main.num}</div>
              <div className="lbl">{ed.metrics.main.lbl}</div>
              <div className="src-lbl">{ed.metrics.main.src}</div>
            </div>
            <div className="metric-side">
              {ed.metrics.side.map((m, i) => (
                <div className="m-item" key={i}>
                  <div className={m.accent ? 'num accent' : 'num'}>{m.num}</div>
                  <div className="lbl">{m.lbl}</div>
                  <div className="src-lbl">{m.src}</div>
                </div>
              ))}
            </div>
          </div>

          {ed.timeline.length > 0 && (
            <>
              <h3 className="sec-title">
                本期重要动态
                <span className="hint">官方机构 / 科研动态 · 最新在前</span>
              </h3>
              <div className="tl" ref={tlRef}>
                {ed.timeline.map((n, i) => (
                  <div className="node" key={i}>
                    <div className="dot" />
                    <div className="tags">
                      <span className="date">{n.date}</span>
                      <span className="tag">{n.tag}</span>
                    </div>
                    <div className="d">{n.body}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          {ed.views.length > 0 && (
            <>
              <h3 className="sec-title">
                国际一线科学家观点
                <span className="hint">研究方向判断 · 仅供追踪参考</span>
              </h3>
              <div className="views" ref={vwRef}>
                {ed.views.map((v, i) => (
                  <div className="card view" key={i}>
                    <div className="who">{v.who}</div>
                    <div className="txt">{v.txt}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      ))}

      <footer className="src">{footer}</footer>
      </div>
    </article>
  );
}
