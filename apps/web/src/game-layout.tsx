import { useState } from 'react';
import { useT } from './i18n/index.ts';
import { SettingsPanel } from './settings/settings-panel.tsx';
import { LoginForm } from './auth/login-form.tsx';
import { SkillPanel } from './skills/skill-panel.tsx';
import { ActivityPanel } from './activity/activity-panel.tsx';
import { InventoryPanel } from './inventory/inventory-panel.tsx';
import { ActionProvider } from './action/action-context.tsx';

/**
 * 游戏主界面布局（三栏）
 *
 * 为什么左栏用 nav 语义化标签：技能列表承担导航职能（task-11 接管中栏内容切换），
 * 用 nav 让辅助技术能识别出这是导航区域。
 *
 * 为什么中栏占位用 section 而不是 div：它是游戏玩法的核心画布（进度/结算都在这里），
 * 用 section 明确其"主要区域"语义。
 *
 * 为什么 ActionProvider 包在 GameLayout 里而不是 App 顶层？
 *   活动状态只在已登录的三栏界面里存在；GuestView（未登录）根本不需要
 *   这套 Provider。把它下移到 GameLayout，未登录路径就少一棵 Provider 子树，
 *   也能避免游客误触发 /api/action 请求。
 */
export function GameLayout() {
  const { t } = useT();
  // 左栏技能选择：仅本组件的中栏需要根据它渲染对应动作，因此放局部 state
  // （跨组件共享的"当前活动"状态在 ActionProvider 里）
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);

  return (
    <ActionProvider>
      <main className="game-layout">
        <h1 className="visually-hidden">{t('app.title')}</h1>
        <div className="layout-grid">
          <nav className="layout-sidebar" aria-label={t('layout.skill_list')}>
            <SkillPanel selectedSkillId={selectedSkillId} onSelectSkill={setSelectedSkillId} />
          </nav>

          <section className="layout-main" aria-label={t('layout.main_region')}>
            <ActivityPanel />
          </section>

          <aside className="layout-right">
            <InventoryPanel />
            <SettingsPanel />
          </aside>
        </div>
      </main>
    </ActionProvider>
  );
}

/**
 * 游客（未登录）视图：只渲染登录表单，居中排版
 *
 * 为什么单独抽出来：App 入口只负责分流，不关心视觉排版；
 * 游客视图的视觉规则（居中）与三栏游戏布局完全不同，分开写避免互相污染。
 */
export function GuestView() {
  return (
    <main className="guest-layout">
      <LoginForm />
    </main>
  );
}
