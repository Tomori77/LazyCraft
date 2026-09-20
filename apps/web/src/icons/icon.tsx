import { useIconDef } from './icon-context.tsx';

/**
 * 多形态图标组件（task-35）。
 *
 * 为什么尺寸用 width/height 属性而不是 inline style？
 *   属性会被所在上下文的 CSS 覆盖（如装备槽要按槽位百分比缩放），
 *   inline style 优先级过高会让"同一枚图标在不同位置不同尺寸"失效。
 *
 * 三形态进 DOM 的方式：
 *   - svg（手绘/外部库）：引用根级 sprite 的 <symbol>，走 `<use href="#name">`；
 *   - emoji：渲染文本节点，字号跟 size 走；
 *   - raster：渲染 `<img src=url>`，宽高同样受 size / 所在 CSS 控制。
 */
interface IconProps {
  /** 图标名（`skill.*` / `item.*` / `slot.*` / `ui.*`），缺省或未注册时回退 fallback */
  name?: string;
  size?: number;
  className?: string;
  /** 图标缺失时的文字兜底（首字母），不传则渲染空 */
  fallback?: string;
}

export function Icon({ name, size = 18, className = '', fallback }: IconProps) {
  const def = useIconDef(name);

  if (!def) {
    return fallback === undefined ? null : (
      <span className={`icon-fallback ${className}`} style={{ width: size, height: size }}>
        {fallback}
      </span>
    );
  }

  if (def.source === 'emoji') {
    return (
      <span
        className={`i i-emoji ${className}`}
        style={{ fontSize: size, lineHeight: 1 }}
        aria-hidden="true"
      >
        {def.char}
      </span>
    );
  }

  if (def.source === 'raster') {
    return (
      <img
        className={`i i-raster ${className}`}
        src={def.url}
        width={size}
        height={size}
        alt=""
        aria-hidden="true"
      />
    );
  }

  return (
    <svg className={`i ${className}`} viewBox={def.viewBox ?? '0 0 24 24'} width={size} height={size} aria-hidden="true">
      <use href={`#${name}`} />
    </svg>
  );
}
