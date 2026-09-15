import { SKILLS } from '@lazycraft/shared';
import { useT } from './i18n/index.ts';
import { SettingsPanel } from './settings/settings-panel.tsx';
import { LoginForm } from './auth/login-form.tsx';

/**
 * 游戏主界面布局（三栏）
 *
 * 为什么左栏用 nav 语义化标签：技能列表承担导航职能（task-11 会接管中栏内容切换），
 * 用 nav 让辅助技术能识别出这是导航区域。
 *
 * 为什么中栏占位用 section 而不是 div：它将是未来游戏玩法的核心画布，
 * 用 section 明确其"主要区域"语义。
 *
 * 为什么右栏背包和设置放同一个 aside：两者都是辅助性功能，集中放置
 * 符合梅尔沃放置的右侧边栏模式；设置按钮用 SettingsPanel 自带触发，
 * 避免重复实现弹窗逻辑。
 */
export function GameLayout() {
  const { t } = useT();

  return (
    <main className="game-layout">
      <h1 className="visually-hidden">{t('app.title')}</h1>
      <div className="layout-grid">
        <nav className="layout-sidebar" aria-label={t('layout.skill_list')}>
          <h2>{t('nav.skills')}</h2>
          <ul className="skill-list">
            {SKILLS.map((skill) => (
              <li key={skill.id}>
                <span className="skill-icon" aria-hidden="true">
                  {/* 无图标时回退为首字母，与 shared 包 AbstractResource.icon 的缺省策略一致 */}
                  {skill.name.charAt(0)}
                </span>
                <span className="skill-name">{t(`skill.${skill.id}.name`)}</span>
              </li>
            ))}
          </ul>
        </nav>

        <section className="layout-main" aria-label={t('layout.main_region')}>
          <div className="placeholder">
            <p>{t('layout.placeholder')}</p>
          </div>
        </section>

        <aside className="layout-right">
          <div className="inventory-placeholder">
            <h2>{t('nav.inventory')}</h2>
            <div className="placeholder">
              <p>{t('layout.placeholder')}</p>
            </div>
          </div>
          <SettingsPanel />
        </aside>
      </div>
    </main>
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
