import React, { useId } from 'react';

export interface BrandLogoProps {
  size?: number;
  className?: string;
  ariaLabel?: string;
}

/**
 * MarketTracker 品牌标识系统 · 地平线动量仪 (Horizon Vector Mark)
 * 
 * 核心设计哲学：「The grid carries weight; the line carries pace.」
 * 融合 SpaceX Telemetry 仪表盘 HUD 倒角瞄准框、时序多维动量走势 (暗合 M 形态) 与 突破定位信标十字 (暗合 T 形态)。
 */
export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 28,
  className = '',
  ariaLabel = 'MarketTracker 市场追踪 Logo',
}) => {
  const uid = useId().replace(/:/g, '');
  const bgId = `mt-bg-${uid}`;
  const areaId = `mt-area-${uid}`;
  const strokeId = `mt-stroke-${uid}`;
  const glowId = `mt-glow-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`brand-logo brand-logo-vector ${className}`.trim()}
      role="img"
      aria-label={ariaLabel}
    >
      <defs>
        {/* 底色：深空钛金半透明材质 */}
        <linearGradient id={bgId} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#121726" stopOpacity="0.96" />
          <stop offset="100%" stopColor="#04060a" stopOpacity="0.99" />
        </linearGradient>

        {/* 动量面积渐变：量化多头能量池 */}
        <linearGradient id={areaId} x1="0" y1="7" x2="0" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="65%" stopColor="#ffffff" stopOpacity="0.06" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>

        {/* 动量折线：从沉静底色过渡至纯白突破光芒 */}
        <linearGradient id={strokeId} x1="6" y1="22" x2="26" y2="7" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="rgba(240, 240, 250, 0.55)" />
          <stop offset="50%" stopColor="rgba(240, 240, 250, 0.9)" />
          <stop offset="100%" stopColor="#ffffff" />
        </linearGradient>

        {/* 信标微光滤波 */}
        <filter id={glowId} x="14" y="1" width="16" height="16" filterUnits="userSpaceOnUse">
          <feGaussianBlur stdDeviation="1.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* 外轮廓：SpaceX 控制台倒角 HUD 方框 */}
      <rect
        x="1"
        y="1"
        width="30"
        height="30"
        rx="6.5"
        fill={`url(#${bgId})`}
        stroke="rgba(240, 240, 250, 0.22)"
        strokeWidth="1"
        className="brand-logo-frame"
      />

      {/* 坐标基准刻度网格：「The grid carries weight」 */}
      <line
        x1="5"
        y1="20.5"
        x2="27"
        y2="20.5"
        stroke="rgba(240, 240, 250, 0.16)"
        strokeWidth="0.8"
        strokeDasharray="1.5 2"
        className="brand-logo-grid"
      />
      <line
        x1="16"
        y1="6"
        x2="16"
        y2="26"
        stroke="rgba(240, 240, 250, 0.1)"
        strokeWidth="0.8"
        strokeDasharray="1.5 2"
        className="brand-logo-grid"
      />

      {/* 市场动能面积阴影 */}
      <path
        d="M 5.5 22.5 L 11 13 L 15.5 17 L 21.5 8.5 L 26.5 8.5 V 23.5 H 5.5 Z"
        fill={`url(#${areaId})`}
        className="brand-logo-area"
      />

      {/* 核心市场折线：「The line carries pace」—— 构成突破形态并隐含 M 形态 */}
      <path
        d="M 5.5 22.5 L 11 13 L 15.5 17 L 21.5 8.5 L 26.5 8.5"
        stroke={`url(#${strokeId})`}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="brand-logo-line"
      />

      {/* 结构转换转折点微标 */}
      <circle cx="11" cy="13" r="1.1" fill="#ffffff" opacity="0.85" />

      {/* 追踪十字标刻度 (与顶点交汇构成 T 形结构) */}
      <line
        x1="21.5"
        y1="2.5"
        x2="21.5"
        y2="5.5"
        stroke="#ffffff"
        strokeWidth="1.3"
        strokeLinecap="round"
        className="brand-logo-crosshair"
      />
      <line
        x1="24"
        y1="8.5"
        x2="27"
        y2="8.5"
        stroke="#ffffff"
        strokeWidth="1.3"
        strokeLinecap="round"
        className="brand-logo-crosshair"
      />

      {/* 瞄准雷达微脉冲环 */}
      <circle
        cx="21.5"
        cy="8.5"
        r="4.5"
        fill="none"
        stroke="#ffffff"
        strokeWidth="0.9"
        strokeDasharray="1.5 1.5"
        opacity="0.65"
        className="brand-logo-pulse"
      />

      {/* 顶点实时定位信标 (Luminous Beacon) */}
      <circle
        cx="21.5"
        cy="8.5"
        r="2.2"
        fill="#ffffff"
        filter={`url(#${glowId})`}
        className="brand-logo-beacon"
      />
    </svg>
  );
};

export default BrandLogo;
