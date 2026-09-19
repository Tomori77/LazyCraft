export const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

/**
 * 身份失效事件名。
 *
 * 为什么由 http 层公告、而不是在这里直接清 localStorage？
 *   登录态的存储格式（key 名、email 等）由 AuthProvider 单独持有；
 *   http 层重复记一份 key 就出现了第二个"真相来源"，将来改 key 必漏一处。
 *   所以这里只广播"服务器已拒绝身份"，清理动作交给监听方。
 */
export const UNAUTHORIZED_EVENT = 'lazycraft:unauthorized';

interface ApiErrorBody {
  message?: string | string[];
}

/**
 * 统一处理非 2xx 响应：优先取后端返回的 message（NestJS 校验错误是数组），
 * 拿不到就用 HTTP 状态码兜底——保证上层永远得到 Error 而不是 undefined
 */
async function throwIfNotOk(res: Response): Promise<void> {
  if (res.ok) return;
  // 401 = token 失效（过期 / 换了数据库 / 换了 JWT_SECRET）。广播事件让
  // AuthProvider 清掉登录态回到登录页，否则前端会一直卡在"有 token 但全 401"。
  if (res.status === 401 && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
  let message = `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as ApiErrorBody;
    if (Array.isArray(body.message)) {
      message = body.message.join('；');
    } else if (body.message) {
      message = body.message;
    }
  } catch {
    // 响应体不是 JSON（如网关 502 页面）时保留状态码兜底
  }
  throw new Error(message);
}

export async function apiGet<T>(path: string, token?: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  await throwIfNotOk(res);
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  await throwIfNotOk(res);
  return res.json() as Promise<T>;
}
