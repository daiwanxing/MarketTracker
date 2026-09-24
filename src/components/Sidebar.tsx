import { useState } from 'react';
import { NavLink } from 'react-router-dom';

export default function Sidebar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* 移动端顶栏：汉堡按钮 + 品牌名 */}
      <div className="mobile-topbar">
        <button
          type="button"
          className="hamburger"
          aria-label="打开导航菜单"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <span />
          <span />
          <span />
        </button>
        <span className="mobile-brand">市场追踪</span>
      </div>

      {/* 遮罩 */}
      {open && <div className="drawer-mask" onClick={() => setOpen(false)} aria-hidden="true" />}

      <aside className={`sidebar${open ? ' drawer-open' : ''}`}>
        <div className="brand">
          <div className="brand-mark" aria-hidden="true" />
          <span className="brand-name">市场追踪</span>
          <button
            type="button"
            className="drawer-close"
            aria-label="关闭导航菜单"
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </div>
        <nav onClick={() => setOpen(false)}>
          <div className="nav-group">
            <div className="group-label">地缘与能源</div>
            <NavLink to="/oil" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
              <span className="dot-mini" aria-hidden="true" />
              原油行情
            </NavLink>
          </div>
          <div className="nav-group">
            <div className="group-label">贵金属</div>
            <NavLink to="/gold" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
              <span className="dot-mini" aria-hidden="true" />
              黄金行情
            </NavLink>
          </div>
          <div className="nav-group">
            <div className="group-label">气候与农业</div>
            <NavLink to="/enso" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
              <span className="dot-mini" aria-hidden="true" />
              厄尔尼诺
            </NavLink>
          </div>
        </nav>
      </aside>
    </>
  );
}
