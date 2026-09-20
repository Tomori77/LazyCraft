import { FORMAT_DEMO_ICONS, formatLabel } from './demo-icons.ts';
import { IconRegistryProvider } from './icon-context.tsx';
import { Icon } from './icon.tsx';

/**
 * 多形态图标演示（task-35）。
 *
 * 为什么需要这个页面？
 *   本体内容里没有引用演示素材（item.demo_*），光注册进 Registry
 *   不会出现在任何真实组件上；验收要求"页面能渲染 emoji 与 raster"，
 *   故提供一个仅由 `?icon-demo` 触发的独立浮层，不影响正常游戏界面。
 *   它同时是新增形态的活文档：改 formats.ts 即可在这里看到效果。
 */
export function IconFormatsDemo() {
  return (
    <IconRegistryProvider icons={FORMAT_DEMO_ICONS}>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          background: '#f6efe1',
          color: '#3b2a17',
          padding: '24px 32px',
          fontFamily: 'system-ui, sans-serif',
          overflow: 'auto',
        }}
      >
        <h1 style={{ fontSize: 20, margin: '0 0 4px' }}>图标多形态演示（task-35）</h1>
        <p style={{ fontSize: 13, opacity: 0.7, margin: '0 0 20px' }}>
          ?icon-demo —— emoji / webp / png / jpg。位图来自 apps/web/public/icons/，项目自绘。
        </p>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          {FORMAT_DEMO_ICONS.map((icon) => (
            <div
              key={icon.name}
              style={{
                width: 150,
                padding: 16,
                border: '1px solid #d8c7a8',
                borderRadius: 8,
                background: '#fdf8ee',
                textAlign: 'center',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                <Icon name={icon.name} size={48} />
              </div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{icon.name}</div>
              <div style={{ fontSize: 11, opacity: 0.65 }}>{formatLabel(icon)}</div>
            </div>
          ))}
        </div>
      </div>
    </IconRegistryProvider>
  );
}
