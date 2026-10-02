import React from 'react';

export type LogoVariant = 'vector' | 'radar' | 'matrix';

export interface BrandLogoProps {
  size?: number;
  className?: string;
  variant?: LogoVariant;
  ariaLabel?: string;
}

/**
 * MarketTracker 品牌标识系统 (Brand Logo Mark)
 * 
 * 核心设计哲学：「The grid carries weight; the line carries pace.」
 * 融合 SpaceX Telemetry 仪表盘 HUD 瞄准框、时序多维动量走势 (M 字形态) 与 全天候追踪信标十字 (T 字基准)。
 */
export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 30,
  className = '',
  variant = 'vector',
  ariaLabel = 'MarketTracker 市场追踪 Logo',
}) => {
  if (variant === 'radar') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`brand-logo brand-logo-radar ${className}`.trim()}
        role="img"
        aria-label={ariaLabel}
      >
        <defs>
          <radialGradient id="mt-radar-bg" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#121828" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#04060a" stopOpacity="0.98" />
          </radialGradient>
          <linearGradient id="mt-radar-ray" x1="6" y1="22" x2="25" y2="7" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="rgba(240, 240, 250, 0.4)" />
            <stop offset="55%" stopColor="rgba(240, 240, 250, 0.85)" />
            <stop offset="100%" stopColor="#ffffff" />
          </linearGradient>
        </defs>

        {/* 外圈高精度刻度环 */}
        <circle
          cx="16"
          cy="16"
          r="14.5"
          fill="url(#mt-radar-bg)"
          stroke="rgba(240, 240, 250, 0.38)"
          strokeWidth="1.2"
          className="brand-logo-frame"
        />

        {/* 内层同心测距标尺圈 */}
        <circle
          cx="16"
          cy="16"
          r="9.5"
          fill="none"
          stroke="rgba(240, 240, 250, 0.16)"
          strokeWidth="0.8"
          strokeDasharray="2 2"
        />
        <circle
          cx="16"
          cy="16"
          r="5"
          fill="none"
          stroke="rgba(240, 240, 250, 0.24)"
          strokeWidth="0.8"
        />

        {/* 倾斜航道/供应链轨道 */}
        <ellipse
          cx="16"
          cy="16"
          rx="12.5"
          ry="5.5"
          transform="rotate(-28 16 16)"
          fill="none"
          stroke="rgba(240, 240, 250, 0.22)"
          strokeWidth="0.8"
          strokeDasharray="2.5 2"
        />

        {/* 四象限正交瞄准刻度 (十字雷达) */}
        <line x1="16" y1="1.5" x2="16" y2="5" stroke="#ffffff" strokeWidth="1.4" strokeLinecap="round" />
        <line x1="16" y1="27" x2="16" y2="30.5" stroke="rgba(240, 240, 250, 0.6)" strokeWidth="1.4" strokeLinecap="round" />
        <line x1="1.5" y1="16" x2="5" y2="16" stroke="rgba(240, 240, 250, 0.6)" strokeWidth="1.4" strokeLinecap="round" />
        <line x1="27" y1="16" x2="30.5" y2="16" stroke="#ffffff" strokeWidth="1.4" strokeLinecap="round" />

        {/* 动态行情仰角扫描射线 */}
        <path
          d="M 6.5 21 L 11.5 14.5 L 15.5 17.5 L 24 7.5"
          stroke="url(#mt-radar-ray)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="brand-logo-line"
        />

        {/* 扫描信标焦点与微脉冲 */}
        <circle cx="24" cy="7.5" r="2.2" fill="#ffffff" className="brand-logo-beacon" />
        <circle
          cx="24"
          cy="7.5"
          r="4.5"
          fill="none"
          stroke="#ffffff"
          strokeWidth="1"
          strokeDasharray="1.5 1.5"
          opacity="0.65"
          className="brand-logo-pulse"
        />
      </svg>
    );
  }

  if (variant === 'matrix') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`brand-logo brand-logo-matrix ${className}`.trim()}
        role="img"
        aria-label={ariaLabel}
      >
        <defs>
          <linearGradient id="mt-mat-bg" x1="0" y1="0" x2="32" y2="32">
            <stop offset="0%" stopColor="#111624" />
            <stop offset="100%" stopColor="#04060a" />
          </linearGradient>
          <linearGradient id="mt-mat-grad" x1="5" y1="24" x2="27" y2="8">
            <stop offset="0%" stopColor="rgba(240, 240, 250, 0.6)" />
            <stop offset="100%" stopColor="#ffffff" />
          </linearGradient>
        </defs>

        <rect
          x="1"
          y="1"
          width="30"
          height="30"
          rx="6"
          fill="url(#mt-mat-bg)"
          stroke="rgba(240, 240, 250, 0.28)"
          strokeWidth="1.2"
          className="brand-logo-frame"
        />

        {/* 极简 M-T 几何拓扑矩阵 */}
        {/* 左侧 M 柱状动量折线 */}
        <path
          d="M 6.5 24 V 11.5 L 11.5 16.5 L 16.5 11.5 V 24"
          stroke="url(#mt-mat-grad)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* 右侧 T 悬浮十字坐标与信标 */}
        <path
          d="M 19 11.5 H 26.5 M 22.75 11.5 V 24"
          stroke="#ffffff"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="22.75" cy="7.5" r="2" fill="#ffffff" />
      </svg>
    );
  }

  // 默认旗舰版：Horizon Vector (地平线动量仪)
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
        <linearGradient id="mt-vec-bg" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#121726" stopOpacity="0.96" />
          <stop offset="100%" stopColor="#04060a" stopOpacity="0.99" />
        </linearGradient>

        {/* 动量面积渐变：量化多头能量池 */}
        <linearGradient id="mt-vec-area" x1="0" y1="7" x2="0" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="65%" stopColor="#ffffff" stopOpacity="0.06" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>

        {/* 动量折线：从沉静底色过渡至纯白突破光芒 */}
        <linearGradient id="mt-vec-stroke" x1="6" y1="22" x2="26" y2="7" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="rgba(240, 240, 250, 0.55)" />
          <stop offset="50%" stopColor="rgba(240, 240, 250, 0.9)" />
          <stop offset="100%" stopColor="#ffffff" />
        </linearGradient>

        {/* 信标微光滤波 */}
        <filter id="mt-vec-glow" x="14" y="1" width="16" height="16" filterUnits="userSpaceOnUse">
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
        fill="url(#mt-vec-bg)"
        stroke="rgba(240, 240, 250, 0.22)"
        strokeWidth="1"
        className="brand-logo-frame"
      />

      {/* 四角航天控制台测距卡座 (HUD Telemetry Brackets) */}
      <path
        d="M 4 8.5 V 5.5 C 4 4.67 4.67 4 5.5 4 H 8.5"
        stroke="rgba(240, 240, 250, 0.8)"
        strokeWidth="1.3"
        strokeLinecap="round"
        className="brand-logo-bracket"
      />
      <path
        d="M 23.5 4 H 26.5 C 27.33 4 28 4.67 28 5.5 V 8.5"
        stroke="rgba(240, 240, 250, 0.8)"
        strokeWidth="1.3"
        strokeLinecap="round"
        className="brand-logo-bracket"
      />
      <path
        d="M 4 23.5 V 26.5 C 4 27.33 4.67 28 5.5 28 H 8.5"
        stroke="rgba(240, 240, 250, 0.55)"
        strokeWidth="1.3"
        strokeLinecap="round"
        className="brand-logo-bracket"
      />
      <path
        d="M 23.5 28 H 26.5 C 27.33 28 28 27.33 28 26.5 V 23.5"
        stroke="rgba(240, 240, 250, 0.55)"
        strokeWidth="1.3"
        strokeLinecap="round"
        className="brand-logo-bracket"
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
        fill="url(#mt-vec-area)"
        className="brand-logo-area"
      />

      {/* 核心市场折线：「The line carries pace」—— 构成突破形态并隐含 M 形态 */}
      <path
        d="M 5.5 22.5 L 11 13 L 15.5 17 L 21.5 8.5 L 26.5 8.5"
        stroke="url(#mt-vec-stroke)"
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
        filter="url(#mt-vec-glow)"
        className="brand-logo-beacon"
      />
    </svg>
  );
};

export default BrandLogo;
