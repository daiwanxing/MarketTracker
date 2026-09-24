import ensoData from '../data/ensoData.json';
import heroEnso from '../assets/hero-enso.jpg';
import { useReveal } from '../hooks/useReveal';

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
      <h2 className="sec-title">
        CPC 数值
        <span className="hint">传统与相对分栏 · 只收录已经结束的周和月</span>
      </h2>
      <div className="cpc-grid">
        <div className="card cpc-card trad">
          <div className="family">传统 traditional</div>
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
            <span className="k">ONI</span>
            <span className="num">{signed(trad.oni.value, 2)}</span>
            <span className="meta">{trad.oni.season} {trad.oni.year} · {fileName(trad.oni.sourceUrl)}</span>
          </div>
        </div>
        <div className="card cpc-card rel">
          <div className="family">相对 relative</div>
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
            <span className="k">RONI</span>
            <span className="num">{signed(rel.roni.value, 2)}</span>
            <span className="meta">{rel.roni.season} {rel.roni.year} · {fileName(rel.roni.sourceUrl)}</span>
          </div>
        </div>
      </div>
      <p className="cpc-asof">数值截至 {cpc.asOf}。传统 Niño3.4 与相对 Niño3.4 分属不同字段，不能相减。</p>
    </>
  );
}

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
      <CpcNumbers />
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
