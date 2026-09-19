import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { login as loginRequest, register as registerRequest } from './api.ts';
import { UNAUTHORIZED_EVENT } from '../lib/api.ts';

/**
 * 认证上下文（游客模式的实现基础）
 *
 * 为什么 token 为 null 表示"游客"而不是引入单独的 guest 状态？
 *   所有需要登录的接口都依赖 token 本身，有没有 token 就是唯一判据；
 *   额外维护一个 isGuest 布尔只会引入两个状态不同步的可能。
 */

interface AuthContextValue {
  /** JWT 令牌；null = 游客模式（设置仅本地持久化，可正常游玩） */
  token: string | null;
  email: string | null;
  /** 登录/注册请求进行中，用于表单防止重复提交 */
  pending: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// 与 i18n / settings 同一 key 前缀风格，便于排查时一眼认出归属
const TOKEN_KEY = 'lazycraft:token';
const EMAIL_KEY = 'lazycraft:email';

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => readStored(TOKEN_KEY));
  const [email, setEmail] = useState<string | null>(() => readStored(EMAIL_KEY));
  const [pending, setPending] = useState(false);

  useEffect(() => {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
      if (email) localStorage.setItem(EMAIL_KEY, email);
      else localStorage.removeItem(EMAIL_KEY);
    } catch {
      // 存储失败不影响内存态的登录（隐私模式下当个临时会话用）
    }
  }, [token, email]);

  // 登录与注册成功后都会拿到 token，流程相同，只是先调用哪个接口的区别
  const apply = useCallback(async (action: () => Promise<{ accessToken: string }>, accountEmail: string) => {
    setPending(true);
    try {
      const { accessToken } = await action();
      setToken(accessToken);
      setEmail(accountEmail);
    } finally {
      setPending(false);
    }
  }, []);

  const login = useCallback(
    (email_: string, password: string) => apply(() => loginRequest(email_, password), email_),
    [apply],
  );

  const register = useCallback(
    (email_: string, password: string) =>
      apply(async () => {
        await registerRequest(email_, password);
        // 注册接口只返回 account 不发 token，注册成功后紧接着登录一次，少一步用户操作
        return loginRequest(email_, password);
      }, email_),
    [apply],
  );

  const logout = useCallback(() => {
    setToken(null);
    setEmail(null);
  }, []);

  /**
   * 401 自愈：任何请求收到 401 时清登录态，App 顶层随即切回 GuestView。
   *
   * 为什么不做"清完自动重登"：服务器拒绝说明凭据已失效（过期/换库/换密钥），
   * 客户端没有可用的新凭据，静默重试只会再次 401；交给用户重新输入最诚实。
   */
  useEffect(() => {
    window.addEventListener(UNAUTHORIZED_EVENT, logout);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, logout);
  }, [logout]);

  return createElement(
    AuthContext.Provider,
    { value: { token, email, pending, login, register, logout } },
    children,
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth() 必须在 <AuthProvider> 内使用');
  return ctx;
}
