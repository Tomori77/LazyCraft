import { apiDelete, apiGet, apiPatch, apiPost } from '../lib/api.ts';

/**
 * 商店管理接口客户端（task-39）。
 *
 * 为什么单独开一个文件而不是沿用 admin/api.ts？
 *   admin/api.ts 是 task-38 审计页的客户端，task-40（玩家管理）会并行往同一文件里
 *   加玩家接口。若两个 agent 同时写同一个文件，合并冲突概率极高；把商店契约独立成
 *   本文件，各自闭包在自己的新增文件里，只有 admin-panel.tsx 需要最小接线。
 *
 * 契约与服务端 toAdminView 一一对应（apps/api/src/admin/admin-shop.service.ts）：
 *   GET    /admin/shop/entries           → AdminShopEntry[]
 *   POST   /admin/shop/entries           → AdminShopEntry
 *   PATCH  /admin/shop/entries/:id       → AdminShopEntry
 *   DELETE /admin/shop/entries/:id       → { id, deleted: true }
 * 服务端非 2xx 的 message（引用未注册 / id 冲突 / 未鉴权）由 lib/api.ts 抛成 Error，
 * 管理页只需把 Error.message 展示出来即可（引用校验权威在后端，前端不重做规则）。
 */
export type ShopEntryKind = 'item' | 'equipment';
export type ShopEntryQuality = 'common' | 'uncommon' | 'rare' | 'epic';

/** 管理视角的商店条目：含未上架、库存、回收价与排序 */
export interface AdminShopEntry {
  id: string;
  kind: ShopEntryKind;
  /** kind='item' 时的物品引用，否则 null */
  item_id: string | null;
  /** kind='equipment' 时的模板引用，否则 null */
  template_id: string | null;
  quality: ShopEntryQuality | null;
  buy_price: number;
  /** null = 不可回收（回收清单由 sell_price != null 推导，见 shared/data/shop.ts） */
  sell_price: number | null;
  required_level: number | null;
  /** -1 = 无限 */
  stock: number;
  listed: boolean;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

/** 新增条目入参（与服务端 CreateShopEntryDto 对齐；kind 一旦落库不可改） */
export interface CreateShopEntryInput {
  id: string;
  kind: ShopEntryKind;
  item_id?: string;
  template_id?: string;
  quality?: ShopEntryQuality;
  buy_price: number;
  sell_price?: number;
  required_level?: number;
  stock?: number;
  listed?: boolean;
  sort_order?: number;
}

/**
 * 部分更新入参（与服务端 UpdateShopEntryDto 对齐）。
 *
 * `sell_price: null` 与 `sell_price: 0` 语义不同：前者是"取消回收价"，
 * 后者是"回收价为 0"。所以类型里显式保留 null，调用方清空时必须传 null
 * 而不是省略字段——省略代表"不改"。
 */
export interface UpdateShopEntryInput {
  item_id?: string;
  template_id?: string;
  quality?: ShopEntryQuality | null;
  buy_price?: number;
  sell_price?: number | null;
  required_level?: number | null;
  stock?: number;
  listed?: boolean;
  sort_order?: number;
}

/** 列出全部条目（含未上架）；非 admin 后端 403 */
export function fetchShopEntries(token: string): Promise<AdminShopEntry[]> {
  return apiGet('/admin/shop/entries', token);
}

export function createShopEntry(
  token: string,
  input: CreateShopEntryInput,
): Promise<AdminShopEntry> {
  return apiPost('/admin/shop/entries', input, token);
}

export function updateShopEntry(
  token: string,
  id: string,
  patch: UpdateShopEntryInput,
): Promise<AdminShopEntry> {
  return apiPatch(`/admin/shop/entries/${encodeURIComponent(id)}`, patch, token);
}

export function deleteShopEntry(token: string, id: string): Promise<{ id: string; deleted: boolean }> {
  return apiDelete(`/admin/shop/entries/${encodeURIComponent(id)}`, token);
}
