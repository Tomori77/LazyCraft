import { useState, type FormEvent } from 'react';
import { useAuth } from './auth.tsx';
import { useT } from '../i18n/index.ts';

/**
 * 内联登录/注册表单 + 已登录状态条
 *
 * 为什么放内联而不是独立路由页：项目还没有路由层（task-10 才做布局），
 * 一个表单块即可验证"登录 → 云端覆盖设置"的完整链路，不提前引入路由。
 */
export function LoginForm() {
  const { t } = useT();
  const { email, pending, login, register, logout } = useAuth();
  const [emailInput, setEmailInput] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (mode === 'login') {
        await login(emailInput, password);
      } else {
        await register(emailInput, password);
      }
    } catch (err) {
      // 后端已返回本地化中文错误（如"邮箱或密码错误"），直接展示不重复翻译
      setError(err instanceof Error ? err.message : t('auth.failed'));
    }
  };

  if (email) {
    return (
      <div className="auth-bar">
        <span>{t('auth.logged_in_as')}{email}</span>
        <button type="button" onClick={logout}>{t('auth.logout')}</button>
      </div>
    );
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <h2>{mode === 'login' ? t('auth.login') : t('auth.register')}</h2>
      <input
        type="email"
        required
        placeholder={t('auth.email')}
        value={emailInput}
        onChange={(e) => setEmailInput(e.target.value)}
        autoComplete="email"
      />
      <input
        type="password"
        required
        minLength={mode === 'register' ? 8 : undefined}
        placeholder={t('auth.password')}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
      />
      {error && <p className="login-error" role="alert">{error}</p>}
      <button type="submit" disabled={pending}>
        {pending ? t('auth.pending') : mode === 'login' ? t('auth.login') : t('auth.register')}
      </button>
      <button
        type="button"
        className="login-switch"
        disabled={pending}
        onClick={() => {
          setMode(mode === 'login' ? 'register' : 'login');
          setError(null);
        }}
      >
        {mode === 'login' ? t('auth.to_register') : t('auth.to_login')}
      </button>
    </form>
  );
}
