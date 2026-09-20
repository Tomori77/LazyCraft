import { useIconNames } from './icon-context.tsx';

/**
 * 手绘图标组件：引用根级 sprite 里的 symbol。
 *
 * 为什么尺寸用 width/height 属性而不是 inline style？
 *   属性会被所在上下文的 CSS 覆盖（如装备槽要按槽位百分比缩放），
 *   inline style 优先级过高会让"同一枚图标在不同位置不同尺寸"失效。
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
  const names = useIconNames();

  if (!name || !names.has(name)) {
    return fallback === undefined ? null : (
      <span className={`icon-fallback ${className}`} style={{ width: size, height: size }}>
        {fallback}
      </span>
    );
  }

  return (
    <svg className={`i ${className}`} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <use href={`#${name}`} />
    </svg>
  );
}
