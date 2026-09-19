import { useEffect, type ReactNode } from 'react';

/**
 * 中栏悬浮页容器。
 *
 * 为什么用 absolute 而非 fixed？
 *   它必须只覆盖中栏（`position: relative` 的中栏容器内 `inset: 0`），
 *   右栏保持可见可交互，装备才能从背包/仓库拖进个人信息页的槽位。
 * 支持 Esc / 点遮罩关闭；同时只渲染一个（由父级 activeOverlay 决定）。
 */
interface CenterOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function CenterOverlay({ isOpen, onClose, children }: CenterOverlayProps) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="center-overlay-root">
      <div className="center-overlay-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="center-overlay-content" role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}
