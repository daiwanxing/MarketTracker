import heroRobot from '../assets/hero-robot.jpg';

export default function RobotPanel() {
  return (
    <article>
      <header className="hero">
        <img className="hero-bg" src={heroRobot} alt="具身智能人形机器人 · 精密机械臂与关节传感器" />
        <span className="hero-scrim" aria-hidden="true" />
        <div className="hero-inner">
          <div className="hero-main">
            <div className="kicker">THEME 07 · ROBOTICS & EMBODIED AI</div>
            <h1>机器人</h1>
            <p className="hero-lead">具身智能与工业机器人：减速器、伺服电机、滚柱丝杠、六维力传感器及总成出货跟踪。</p>
          </div>
          <div className="hero-aside">
            <span className="hero-meta"><b>状态：框架梳理与指标接入中</b></span>
          </div>
        </div>
      </header>

      <div className="content">
        <h2 className="sec-title">
          跟踪框架规划
          <span className="hint">核心硬件环节与供应链披露跟踪</span>
        </h2>
        <div className="base-grid">
          {[
            { k: '行星滚柱丝杠', metric: '加工设备交期、C3/C5 精度良率与批量送样进展', v: '待接入' },
            { k: '六维力与触觉传感', metric: '解耦算法芯片化、应变片工艺与单台整机 BOM 占比', v: '待接入' },
            { k: '减速器（谐波 / RV）', metric: '寿命测试表现、齿形专利壁垒与国产替代产线稼动率', v: '待接入' },
            { k: '空心杯与无框力矩电机', metric: '功率密度、绕线工艺与灵巧手集成方案演进', v: '待接入' },
            { k: '总成装配与出货预期', metric: '头部主机厂量产时间表、单台目标成本与应用场景验证', v: '待接入' },
            { k: '工业与协作机器人出货', metric: 'MIR / 睿工业月度销量、下游汽车/3C 扩产资本开支', v: '待接入' },
          ].map((item) => (
            <div className="card real-crowd-card" key={item.k}>
              <div className="real-crowd-head">
                <span className="real-crowd-title">{item.k}</span>
                <span className="crowd-badge unknown">{item.v}</span>
              </div>
              <div className="real-crowd-desc">{item.metric}</div>
              <div className="real-crowd-detail">指标与公开披露数据源预留中</div>
            </div>
          ))}
        </div>

        <h2 className="sec-title" style={{ marginTop: 28 }}>
          模块说明
        </h2>
        <div className="sec-note">
          本板块为机器人与具身智能产业链预留占位。数据标准与研判框架将沿用本站严肃机构准则：仅引用经核实的公司公告、业绩会交流及权威行业统计，未接入项不下主观臆断。
        </div>
      </div>
    </article>
  );
}
