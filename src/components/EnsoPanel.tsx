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
  const treeRef = useReveal<HTMLDivElement>();
  const regionRef = useReveal<HTMLDivElement>();
  const outlookRef = useReveal<HTMLDivElement>();
  const {
    head, anchor, impactTree, cropRegions, commodityOutlook,
    timeline, timelineTitle, timelineHint, footer, lastUpdated,
  } = ensoData;

  return (
    <article>
      <header className="hero">
        <img className="hero-bg" src={heroEnso} alt="1997 年 3-8 月 AVHRR 海表温度距平（NASA SVS · 公有领域）" />
        <span className="hero-scrim" aria-hidden="true" />
        <div className="hero-inner">
          <div className="hero-main">
            <div className="kicker">{head.kicker}</div>
            <h1>{head.title}</h1>
            <p className="hero-lead">{head.sub}</p>
          </div>
          <div className="hero-aside">
            <span className="hero-chip">ENSO · 农产品</span>
            <span className="hero-meta"><b>最后更新：{lastUpdated}</b></span>
            <span className="hero-credit">影像 · NASA SVS / 1997 年赤道太平洋海表温度距平移 / 公有领域</span>
          </div>
        </div>
      </header>

      <div className="content">
        <h2 className="sec-title">
          {anchor.secTitle}
          <span className="hint">{anchor.hint}</span>
        </h2>
        <div className="card metrics">
          {anchor.refs.map((ref) => (
            <div className="m-item" key={ref.k}>
              <div className="num">{ref.v}</div>
              <div className="lbl">{ref.k}</div>
            </div>
          ))}
        </div>
        <p className="cpc-asof">{anchor.note}</p>
        <CpcNumbers />

        <h2 className="sec-title">
          {impactTree.secTitle}
          <span className="hint">{impactTree.hint}</span>
        </h2>
        <div ref={treeRef}>
          {impactTree.tiers.map((tier) => (
            <section key={tier.name}>
              <h3 className="sec-title">
                {tier.name}
                <span className="hint">{tier.label}</span>
              </h3>
              <div className="risks">
                {tier.crops.map((crop) => (
                  <div className="card rcard" key={crop.name}>
                    <div className="rk"><i className={tier.tone} aria-hidden="true" />{crop.name}</div>
                    <p>{crop.body}</p>
                    <div className="src">{crop.src}</div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        <h2 className="sec-title">
          {cropRegions.secTitle}
          <span className="hint">{cropRegions.hint}</span>
        </h2>
        <div className="tech-grid" ref={regionRef}>
          {cropRegions.items.map((item) => (
            <div className="t-item" key={item.name}>
              <b>{item.name}</b>
              <span>{item.body}</span>
              <div className="src">{item.src}</div>
            </div>
          ))}
        </div>

        <h2 className="sec-title">
          {commodityOutlook.secTitle}
          <span className="hint">{commodityOutlook.hint}</span>
        </h2>
        <div className="risks" ref={outlookRef}>
          {commodityOutlook.rows.map((row) => (
            <div className="card rcard" key={row.name}>
              <div className="rk">{row.name}</div>
              <p>{row.hazard}</p>
              <div className="src">{row.lag} · {row.bias} · {row.gap}</div>
            </div>
          ))}
        </div>

        <h2 className="sec-title">
          {timelineTitle}
          <span className="hint">{timelineHint}</span>
        </h2>
        <div className="tl" ref={tlRef}>
          {timeline.map((n) => (
            <div className="node" key={`${n.date}-${n.tag}`}>
              <div className="dot" />
              <div className="tags">
                <span className="date">{n.date}</span>
                <span className="tag">{n.tag}</span>
              </div>
              <div className="d">{n.body}</div>
            </div>
          ))}
        </div>

        <footer className="src">{footer}</footer>
      </div>
    </article>
  );
}
