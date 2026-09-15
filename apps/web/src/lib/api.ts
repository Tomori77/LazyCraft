export const API_BASE = 'http://localhost:3000';

interface ApiErrorBody {
  message?: string | string[];
}

/**
 * 统一处理非 2xx 响应：优先取后端返回的 message（NestJS 校验错误是数组），
 * 拿不到就用 HTTP 状态码兜底——保证上层永远得到 Error 而不是 undefined
 */
async function throwIfNotOk(res: Response): Promise<void> {
  if (res.ok) return;
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
