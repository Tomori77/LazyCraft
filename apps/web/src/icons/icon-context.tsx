import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { isSvgIcon, renderSprite, type IconDef } from '@lazycraft/icons';

/**
 * 图标注册器（多形态）。
 *
 * 为什么要用 Context 传"图标定义表"而不是只传名字集合？
 *   图标清单以 `GET /api/content` 的 `icons` 为准（DLC 可覆盖/新增），
 *   静态目录只是本体兜底。task-35 起图标有 svg / emoji / raster 三形态，
 *   光知道"名字存在"不足以渲染：位图要知道 url、emoji 要知道字符。
 *   因此这里存 `name → IconDef`，组件按定义收窄后各自渲染。
 *
 * 为什么在根部先注入本体 31 枚 sprite？
 *   登录/注册屏在 ContentProvider 之外，也必须能显示品牌图标；
 *   根部先注入本体，进入游戏后再按内容快照补差量，避免重复 symbol。
 */
const IconRegistryContext = createContext<ReadonlyMap<string, IconDef>>(new Map());

/** 取完整图标定义表（需要自行按形态分支时用） */
export function useIconRegistry(): ReadonlyMap<string, IconDef> {
  return useContext(IconRegistryContext);
}

/** 按名取单个图标定义；未注册或名为空时返回 undefined */
export function useIconDef(name?: string): IconDef | undefined {
  const registry = useContext(IconRegistryContext);
  return name ? registry.get(name) : undefined;
}

interface IconRegistryProviderProps {
  icons: ReadonlyArray<IconDef>;
  children: ReactNode;
}

export function IconRegistryProvider({ icons, children }: IconRegistryProviderProps) {
  const parent = useContext(IconRegistryContext);

  // 只渲染父级尚未提供的图标：本体 sprite 已在根部注册，这里补 DLC 差量，
  // 避免同一 symbol id 在 DOM 里出现两份（`<use>` 只认第一份，重复且无意义）。
  // 且只对 svg 形态产 symbol：emoji / raster 本就不走 sprite。
  const { registry, sprite } = useMemo(() => {
    const merged = new Map(parent);
    const extraSvg: IconDef[] = [];
    for (const icon of icons) {
      if (merged.has(icon.name)) continue;
      merged.set(icon.name, icon);
      if (isSvgIcon(icon)) extraSvg.push(icon);
    }
    return { registry: merged, sprite: extraSvg.length > 0 ? renderSprite(extraSvg) : '' };
  }, [parent, icons]);

  return (
    <IconRegistryContext.Provider value={registry}>
      {sprite !== '' && (
        <div className="icon-sprite" aria-hidden="true" dangerouslySetInnerHTML={{ __html: sprite }} />
      )}
      {children}
    </IconRegistryContext.Provider>
  );
}
