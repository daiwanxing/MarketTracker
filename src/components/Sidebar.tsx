import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { useKeyPress } from 'ahooks';
import { BrandLogo } from './BrandLogo';

const PAGES: { to: string; label: string }[] = [
  { to: '/oil', label: '原油' },
  { to: '/gold', label: '黄金' },
  { to: '/enso', label: '农产品' },
  { to: '/semi', label: '科创 50 & SOX & KOSPI' },
  { to: '/equip', label: '半导体设备材料' },
  { to: '/optics', label: '光模块' },
  { to: '/robot', label: '机器人' },
];

export default function Sidebar() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const current = PAGES.find((page) => pathname.startsWith(page.to))?.label ?? '市场追踪';

  // 抽屉展开时锁定背景滚动条
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  // 按 ESC 键快速关闭移动端抽屉导航
  useKeyPress('Escape', () => {
    if (open) setOpen(false);
  });

  return (
    <>
      <div className="mobile-topbar">
        <button
          type="button"
          className="hamburger"
          aria-label="打开导航菜单"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <Menu size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <span className="mobile-brand" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <BrandLogo size={22} />
          {current}
        </span>
      </div>

      {open && <div className="drawer-mask" onClick={() => setOpen(false)} aria-hidden="true" />}

      <aside className={`sidebar${open ? ' drawer-open' : ''}`}>
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <BrandLogo size={30} />
          </div>
          <span className="brand-name">市场追踪</span>
          <button
            type="button"
            className="drawer-close"
            aria-label="关闭导航菜单"
            onClick={() => setOpen(false)}
          >
            <X size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        <nav onClick={() => setOpen(false)}>
          <div className="nav-group">
            <div className="group-label">地缘与能源</div>
            <NavLink to="/oil" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
              <span className="dot-mini" aria-hidden="true" />
              原油
            </NavLink>
          </div>
          <div className="nav-group">
            <div className="group-label">贵金属</div>
            <NavLink to="/gold" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
              <span className="dot-mini" aria-hidden="true" />
              黄金
            </NavLink>
          </div>
          <div className="nav-group">
            <div className="group-label">气候与农业</div>
            <NavLink to="/enso" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
              <span className="dot-mini" aria-hidden="true" />
              农产品
            </NavLink>
          </div>
          <div className="nav-group">
            <div className="group-label">科技产业</div>
            <NavLink to="/semi" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
              <span className="dot-mini" aria-hidden="true" />
              科创 50 & SOX & KOSPI
            </NavLink>
            <NavLink to="/equip" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
              <span className="dot-mini" aria-hidden="true" />
              半导体设备材料
            </NavLink>
            <NavLink to="/optics" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
              <span className="dot-mini" aria-hidden="true" />
              光模块
            </NavLink>
            <NavLink to="/robot" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
              <span className="dot-mini" aria-hidden="true" />
              机器人
            </NavLink>
          </div>
        </nav>
      </aside>
    </>
  );
}

