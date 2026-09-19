import { apiPost } from '../lib/api.ts';

/**
 * 认证 HTTP 客户端
 *
 * 后端 AuthService 约定（task-02）：
 *   register → { account }，login → { accessToken }
 * 这里只做"发请求 + 拿回 token"，token 的持久化由 AuthProvider 负责，
 * 保持 http 层无状态，方便后续替换存储介质
 */
export function login(email: string, password: string): Promise<{ accessToken: string }> {
  return apiPost('/auth/login', { email, password });
}

export function register(
  username: string,
  email: string,
  password: string,
): Promise<{ account: { id: string; email: string } }> {
  return apiPost('/auth/register', { username, email, password });
}
