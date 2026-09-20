import { useState, type FormEvent } from 'react';
import { useAuth } from './auth.tsx';
import { useT } from '../i18n/index.ts';
import { Icon } from '../icons/icon.tsx';

/**
 * 登录 / 注册：两个独立屏幕（P3-7），样式统一到匠人工坊。
 *
 * 为什么用两个屏幕而不是一个表单切换 mode？
 *   两者字段不同（注册多"用户名"）、提交语义不同（注册还要抢唯一名），
 *   合在一起会让条件字段与错误分支互相纠缠；拆开各自线性、可独立演进。
 *
 * 为什么仍不引入路由库？
 *   游客视图只有一个入口，用 GuestView 的本地 state 切换即可；
 *   引入 router 只为两个屏幕不值当，也与现有无路由架构一致。
 */

interface AuthScreenProps {
  /** 切换到另一个屏幕（由 GuestView 持有当前视图） */
  onSwitch: () => void;
}

/** 品牌头：登录/注册屏共用的 LazyCraft 标识 */
function AuthBrand() {
  const { t } = useT();
  return (
    <div className="auth-logo">
      <div className="brand-mark">
        <Icon name="ui.flame-brand" size={18} />
      </div>
      <div className="brand-name">{t('app.brand')}</div>
    </div>
  );
}

/** 注册屏幕：用户名 + 邮箱 + 密码 */
export function RegisterScreen({ onSwitch }: AuthScreenProps) {
  const { t } = useT();
  const { pending, register } = useAuth();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await register(username, email, password);
    } catch (err) {
      // 后端已返回本地化中文错误（如"用户名已被占用"），直接展示不重复翻译
      setError(err instanceof Error ? err.message : t('auth.failed'));
    }
  };

  return (
    <form className="auth-card" onSubmit={submit}>
      <AuthBrand />
      <h2>{t('auth.register_title')}</h2>
      <div className="auth-sub">{t('auth.register_sub')}</div>

      <div className="field">
        <label htmlFor="register-username">{t('auth.username')}</label>
        <input
          id="register-username"
          type="text"
          required
          minLength={2}
          maxLength={20}
          placeholder={t('auth.username_hint')}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
        />
      </div>
      <div className="field">
        <label htmlFor="register-email">{t('auth.email')}</label>
        <input
          id="register-email"
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
      </div>
      <div className="field">
        <label htmlFor="register-password">{t('auth.password')}</label>
        <input
          id="register-password"
          type="password"
          required
          minLength={8}
          placeholder={t('auth.password_hint')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
      </div>

      {error && (
        <p className="login-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn auth-submit" disabled={pending}>
        {pending ? t('auth.pending') : t('auth.register')}
      </button>
      <div className="auth-foot">
        {t('auth.have_account')}
        <button type="button" disabled={pending} onClick={onSwitch}>
          {t('auth.to_login_link')}
        </button>
      </div>
    </form>
  );
}

/** 登录屏幕：邮箱 + 密码 */
export function LoginScreen({ onSwitch }: AuthScreenProps) {
  const { t } = useT();
  const { pending, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.failed'));
    }
  };

  return (
    <form className="auth-card" onSubmit={submit}>
      <AuthBrand />
      <h2>{t('auth.login_title')}</h2>
      <div className="auth-sub">{t('auth.login_sub')}</div>

      <div className="field">
        <label htmlFor="login-email">{t('auth.email')}</label>
        <input
          id="login-email"
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
      </div>
      <div className="field">
        <label htmlFor="login-password">{t('auth.password')}</label>
        <input
          id="login-password"
          type="password"
          required
          placeholder={t('auth.password_hint')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      </div>

      {error && (
        <p className="login-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn auth-submit" disabled={pending}>
        {pending ? t('auth.pending') : t('auth.login')}
      </button>
      <div className="auth-foot">
        {t('auth.no_account')}
        <button type="button" disabled={pending} onClick={onSwitch}>
          {t('auth.to_register_link')}
        </button>
      </div>
    </form>
  );
}
