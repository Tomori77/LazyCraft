import { apiGet, apiPost } from '../lib/api.ts';

/**
 * 市场 HTTP 客户端（task-15）
 *
 * 服务端约定（与 apps/api/src/market/market.controller.ts 一一对应）：
 *   POST /api/market/list       挂单（item/quality/quantity/price）
 *   POST /api/market/cancel/:id 撤单（仅卖家自己）
 *   POST /api/market/buy/:id    购买（付总价，卖家得 95%，5% 税系统回收）
 *   GET  /api/market/my-listings 我的挂单（含已过期待撤单的）
 *   GET  /api/market/listings   浏览（分页 + itemId/quality 筛选；默认过滤过期）
 *   GET  /api/market/history/:itemId 价格历史（按日聚合）
 *
 * 为什么服务端返回 unit_price 而不是 price：
 *   浏览/比价语义只关心"单价"，total_price = unit_price * quantity 在前端乘法得出；
 *   DB 列叫 price 是历史命名，API 层把语义明示成 unit_price 让前端不易误用。
 */

export type Quality = 'common' | 'uncommon' | 'rare' | 'epic';

/** 一张挂单（浏览/我的挂单共用） */
export interface Listing {
  id: string;
  seller_id: string;
  /** 卖家显示名；服务端联表 players.name 派生，匿名场景为 null */
  seller_name: string | null;
  item_id: string;
  quality: Quality;
  quantity: number;
  unit_price: number;
  total_price: number;
  /** 上架 / 到期时间：epoch 毫秒 */
  created_at: number;
  expires_at: number;
}

export interface ListingsPage {
  listings: Listing[];
  page: number;
  limit: number;
  total: number;
}

export interface HistoryRow {
  date: string;
  avg_price: number;
  volume: number;
  quality: Quality;
}

export interface ListResponse {
  listing: Listing;
  fee: number;
}

export interface BuyResponse {
  listing_id: string;
  item_id: string;
  quality: Quality;
  quantity: number;
  unit_price: number;
  total_price: number;
  /** 系统回收的 5% 税 */
  tax: number;
  /** 卖家所得（total_price - tax） */
  seller_gets: number;
}

export interface CancelResponse {
  listing_id: string;
  returned: { item_id: string; quality: Quality; quantity: number };
}

export function listItem(
  token: string,
  payload: { itemId: string; quality?: Quality; quantity: number; price: number },
): Promise<ListResponse> {
  return apiPost('/market/list', payload, token);
}

export function cancelListing(token: string, id: string): Promise<CancelResponse> {
  return apiPost(`/api/market/cancel/${id}`, {}, token);
}

export function buyListing(token: string, id: string): Promise<BuyResponse> {
  return apiPost(`/api/market/buy/${id}`, {}, token);
}

export function fetchMyListings(token: string): Promise<{ listings: Listing[] }> {
  return apiGet('/market/my-listings', token);
}

export function browseListings(
  token: string,
  opts: { itemId?: string; quality?: Quality; page?: number; limit?: number } = {},
): Promise<ListingsPage> {
  const params = new URLSearchParams();
  if (opts.itemId) params.set('itemId', opts.itemId);
  if (opts.quality) params.set('quality', opts.quality);
  if (opts.page && opts.page > 1) params.set('page', String(opts.page));
  if (opts.limit && opts.limit !== 20) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return apiGet(`/api/market/listings${qs ? `?${qs}` : ''}`, token);
}

export function fetchHistory(
  token: string,
  itemId: string,
  quality?: Quality,
  limit = 30,
): Promise<{ item_id: string; history: HistoryRow[] }> {
  const params = new URLSearchParams();
  if (quality) params.set('quality', quality);
  if (limit !== 30) params.set('limit', String(limit));
  const qs = params.toString();
  return apiGet(`/api/market/history/${encodeURIComponent(itemId)}${qs ? `?${qs}` : ''}`, token);
}
