import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { renderSprite, type IconDef } from '@lazycraft/icons';

/**
 * 图标 sprite 注册器。
 *
 * 为什么要用 Context 传"可用图标名"而不是让每个组件自己查目录？
 *   图标清单以 `GET /api/content` 的 `icons` 为准（DLC 可覆盖/新增），
 *   静态目录只是本体兜底。组件渲染 `<use>` 前需要知道该名是否存在，
 *   否则缺失的图标会静默渲染成空白；把名单放进 Context，
 *   组件只依赖注入的名单，不依赖具体是哪一次快照。
 *
 * 为什么在根部先注入本体 31 枚 sprite？
 *   登录/注册屏在 ContentProvider 之外，也必须能显示品牌图标；
 *   根部先注入本体，进入游戏后再按内容快照补差量，避免重复 symbol。
 */
const IconNamesContext = createContext<ReadonlySet<string>>(new Set());

export function useIconNames(): ReadonlySet<string> {
  return useContext(IconNamesContext);
}

interface IconRegistryProviderProps {
  icons: ReadonlyArray<IconDef>;
  children: ReactNode;
}

export function IconRegistryProvider({ icons, children }: IconRegistryProviderProps) {
  const parentNames = useContext(IconNamesContext);

  // 只渲染父级尚未提供的图标：本体 sprite 已在根部注册，这里补 DLC 差量，
  // 避免同一 symbol id 在 DOM 里出现两份（`<use>` 只认第一份，重复且无意义）
  const { names, sprite } = useMemo(() => {
    const merged = new Set(parentNames);
    const extra: IconDef[] = [];
    for (const icon of icons) {
      if (merged.has(icon.name)) continue;
      merged.add(icon.name);
      extra.push(icon);
    }
    return { names: merged, sprite: extra.length > 0 ? renderSprite(extra) : '' };
  }, [parentNames, icons]);

  return (
    <IconNamesContext.Provider value={names}>
      {sprite !== '' && (
        <div className="icon-sprite" aria-hidden="true" dangerouslySetInnerHTML={{ __html: sprite }} />
      )}
      {children}
    </IconNamesContext.Provider>
  );
}
