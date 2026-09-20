import { useAuth } from './auth/auth.tsx';
import { GameLayout, GuestView } from './game-layout.tsx';
import { IconFormatsDemo } from './icons/icon-formats-demo.tsx';

/**
 * 应用入口：只负责"游客 / 玩家"的顶级分流
 *
 * 为什么用 token 而不是 email 判断登录态：AuthContext 的契约就是
 * "token 为 null = 游客"，token 是所有受保护资源的唯一钥匙，
 * 跟着同一判据走，避免两个字段不同步导致幽灵登录态。
 *
 * `?icon-demo` 是 task-35 的验收入口：无需注册/登录即可看到多形态渲染。
 */
function App() {
  const { token } = useAuth();
  if (new URLSearchParams(window.location.search).has('icon-demo')) {
    return <IconFormatsDemo />;
  }
  return token ? <GameLayout /> : <GuestView />;
}

export default App;
