import { apiGet } from '../lib/api.ts';
import type { ContentSnapshot } from '@lazycraft/shared';

/**
 * 内容接口客户端。
 *
 * `GET /api/content` 公开且无玩家数据，但本改版仍只在登录后的 GameLayout 里拉，
 * 让游客路径完全不碰内容子树（见 05 §8 的 Provider 约定）。
 */
export function fetchContent(): Promise<ContentSnapshot> {
  return apiGet('/content');
}
