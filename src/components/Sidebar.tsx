import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { BrandLogo, type LogoVariant } from './BrandLogo';

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

  const [logoVariant, setLogoVariant] = useState<LogoVariant>(() => {
    try {
      const saved = localStorage.getItem('mt_logo_variant');
      if (saved === 'radar' || saved === 'matrix' || saved === 'vector') return saved;
    } catch {
      // ignore
    }
    return 'vector';
  });

  const handleCycleVariant = () => {
    const nextVariant: Record<LogoVariant, LogoVariant> = {
      vector: 'radar',
      radar: 'matrix',
      matrix: 'vector',
    };
    const next = nextVariant[logoVariant];
    setLogoVariant(next);
    try {
      localStorage.setItem('mt_logo_variant', next);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

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
          <BrandLogo size={20} variant={logoVariant} />
          {current}
        </span>
      </div>

      {open && <div className="drawer-mask" onClick={() => setOpen(false)} aria-hidden="true" />}

      <aside className={`sidebar${open ? ' drawer-open' : ''}`}>
        <div className="brand">
          <button
            type="button"
            className="brand-mark"
            onClick={handleCycleVariant}
            title={`当前风格: ${
              logoVariant === 'vector'
                ? '地平线动量仪 (Flagship)'
                : logoVariant === 'radar'
                ? '全景雷达瞄准仪'
                : 'M·T 极简矩阵'
            } · 点击切换设计风格`}
            aria-label="切换 Logo 设计风格"
          >
            <BrandLogo size={30} variant={logoVariant} />
          </button>
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

