import { useState } from 'react';
import type { CarriedItem, EquipmentInstance } from '@lazycraft/shared';
import { useT } from './i18n/index.ts';
import { SettingsPanel } from './settings/settings-panel.tsx';
import { LoginScreen, RegisterScreen } from './auth/auth-screens.tsx';
import { ActionProvider } from './action/action-context.tsx';
import { ContentProvider, useContent } from './content/content-context.tsx';
import { PlayerProvider, usePlayer } from './player/player-context.tsx';
import { ResourceBar } from './resource-bar/resource-bar.tsx';
import { SkillNavPanel } from './skills/skill-panel.tsx';
import { WorkPanel } from './work/work-panel.tsx';
import { InventoryGrid } from './inventory/inventory-grid.tsx';
import { StoragePanel } from './storage/storage-panel.tsx';
import { CenterOverlay } from './overlay/center-overlay.tsx';
import { ProfilePage } from './profile/profile-page.tsx';
import { ShopPage } from './shop/shop-page.tsx';

type ActiveOverlay = 'profile' | 'shop' | null;

/**
 * 三栏主界面（task-27 改版）。
 *
 * 结构：顶部资源条 + 三栏；右栏四段（简要个人信息 / 功能区 / 背包 / 仓库）。
 * 个人信息与商店以悬浮页只覆盖中栏，右栏保持可见可拖拽。
 *
 * Provider 嵌套：ActionProvider 最外（PlayerProvider 需要用它的 settleNonce
 *   在结算后刷新），Content 与 Player 在内——两者都只在登录后的三栏界面存在。
 */
export function GameLayout() {
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<ActiveOverlay>(null);
  // 被拖拽的装备：驱动装备槽高亮/置灰；拖拽结束或落下后清空
  const [draggedEquipment, setDraggedEquipment] = useState<EquipmentInstance | null>(null);

  return (
    <ActionProvider>
      <ContentProvider>
        <PlayerProvider>
          <GameShell
            selectedSkillId={selectedSkillId}
            onSelectSkill={setSelectedSkillId}
            overlay={overlay}
            setOverlay={setOverlay}
            draggedEquipment={draggedEquipment}
            setDraggedEquipment={setDraggedEquipment}
          />
        </PlayerProvider>
      </ContentProvider>
    </ActionProvider>
  );
}

interface GameShellProps {
  selectedSkillId: string | null;
  onSelectSkill: (skillId: string) => void;
  overlay: ActiveOverlay;
  setOverlay: (overlay: ActiveOverlay) => void;
  draggedEquipment: EquipmentInstance | null;
  setDraggedEquipment: (item: EquipmentInstance | null) => void;
}

function GameShell({
  selectedSkillId,
  onSelectSkill,
  overlay,
  setOverlay,
  draggedEquipment,
  setDraggedEquipment,
}: GameShellProps) {
  const { t } = useT();
  const { player, moveItem } = usePlayer();
  const { content, loading, error, refreshContent } = useContent();
  const [inventorySearch, setInventorySearch] = useState('');

  const onDragStartItem = (item: CarriedItem) =>
    setDraggedEquipment(item.kind === 'equipment' ? item : null);
  const onDragEndItem = () => setDraggedEquipment(null);

  // 内容未就绪：给出可恢复错误态而不是整页白屏（05 §8）
  if (error) {
    return (
      <main className="game-status-screen">
        <p>{t('content.load_failed')}</p>
        <button type="button" onClick={() => void refreshContent()}>
          {t('common.retry')}
        </button>
      </main>
    );
  }
  if (loading || !content) {
    return (
      <main className="game-status-screen">
        <p>{t('common.loading')}</p>
      </main>
    );
  }

  return (
    <main className="new-game-shell">
      <h1 className="visually-hidden">{t('app.title')}</h1>

      <ResourceBar />

      <div className="new-layout-grid">
        <nav className="new-layout-left" aria-label={t('layout.skill_list')}>
          <SkillNavPanel selectedSkillId={selectedSkillId} onSelectSkill={onSelectSkill} />
        </nav>

        <section className="new-layout-center" aria-label={t('layout.main_region')}>
          <WorkPanel selectedSkillId={selectedSkillId} />

          <CenterOverlay isOpen={overlay !== null} onClose={() => setOverlay(null)}>
            {overlay === 'profile' && (
              <ProfilePage draggedItem={draggedEquipment} onClose={() => setOverlay(null)} />
            )}
            {overlay === 'shop' && <ShopPage onClose={() => setOverlay(null)} />}
          </CenterOverlay>
        </section>

        <aside className="new-layout-right">
          {/* 第 1 段：简要个人信息（点击整块打开悬浮页） */}
          <button type="button" className="right-section right-profile-summary" onClick={() => setOverlay('profile')}>
            <span className="summary-avatar" aria-hidden="true">
              {player?.name?.charAt(0) ?? ''}
            </span>
            <span className="summary-info">
              <span className="summary-name">{player?.name ?? ''}</span>
              <span className="summary-level">
                {t('skills.level')} {player?.level ?? 1}
              </span>
            </span>
          </button>

          {/* 第 2 段：功能区按钮（个人信息 / 商店 / 设置） */}
          <div className="right-section right-actions-grid">
            <button type="button" className="action-entry-btn" onClick={() => setOverlay('profile')}>
              {t('profile.title')}
            </button>
            <button type="button" className="action-entry-btn" onClick={() => setOverlay('shop')}>
              {t('shop.title')}
            </button>
            <SettingsPanel />
          </div>

          {/* 第 3 段：背包（可拖出装备/物品，可接收仓库拖入） */}
          <div className="right-section right-inventory-section">
            <div className="section-header">
              <h3>{t('nav.inventory')}</h3>
              <span className="capacity-label">
                {player?.carry?.inventory_used ?? 0} / {player?.carry?.inventory_capacity ?? 0}
              </span>
            </div>
            <input
              type="text"
              className="inventory-search-input"
              placeholder={t('inventory.search')}
              value={inventorySearch}
              onChange={(e) => setInventorySearch(e.target.value)}
            />
            <InventoryGrid
              items={player?.inventory ?? []}
              capacity={player?.carry?.inventory_capacity ?? 0}
              containerType="inventory"
              searchQuery={inventorySearch}
              onDragStartItem={onDragStartItem}
              onDragEndItem={onDragEndItem}
              onDropFromOther={(uid, from) => void moveItem(uid, from, 'inventory')}
            />
            {(player?.carry?.inventory_used ?? 0) >= (player?.carry?.inventory_capacity ?? 0) && (
              <p className="inventory-full-warning">{t('inventory.full')}</p>
            )}
          </div>

          {/* 第 4 段：仓库 */}
          <div className="right-section right-storage-section">
            <StoragePanel onDragStartItem={onDragStartItem} onDragEndItem={onDragEndItem} />
          </div>
        </aside>
      </div>
    </main>
  );
}

/**
 * 游客（未登录）视图：只渲染登录表单，居中排版。
 *
 * 为什么单独抽出来：App 入口只负责分流，不关心视觉排版；
 * 游客视图的视觉规则（居中）与三栏游戏布局完全不同，分开写避免互相污染。
 */
/**
 * 游客（未登录）视图：登录 / 注册两个独立屏幕，居中排版。
 *
 * 为什么用本地 state 而不是路由：游客视图是游戏外唯一入口，
 * 两个屏幕互斥切换即可，引入 router 不值当（P3-7 决策）。
 */
export function GuestView() {
  const [view, setView] = useState<'login' | 'register'>('login');
  return (
    <main className="guest-layout">
      {view === 'login' ? (
        <LoginScreen onSwitch={() => setView('register')} />
      ) : (
        <RegisterScreen onSwitch={() => setView('login')} />
      )}
    </main>
  );
}
