/**
 * 首个管理员的产生机制（task-24b）
 *
 * 为什么用环境变量白名单而不是"第一个注册者即 admin"或公开提权接口？
 *   - "第一个注册者"在已有库/公开部署下会把权力交给陌生人；
 *   - 公开提权接口是明显的越权入口。
 *   白名单由部署者掌握（ADMIN_EMAILS），注册时命中即授予 admin；
 *   已有账号的提权走一次性 SQL（见 .env.example 注释），不新增攻击面。
 *
 * 为什么做成纯函数？
 *   邮箱大小写不敏感、空白容错这类解析规则容易写错且属于纯逻辑，
 *   抽出来用 Vitest 固定行为，比在 AccountsService 里隐式处理更可靠。
 */

/** 解析 ADMIN_EMAILS（逗号分隔）为规范化小写邮箱集合 */
export function parseAdminEmails(raw: string | undefined | null): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0),
  );
}

/** 该邮箱是否应授予 admin（大小写不敏感） */
export function isAdminEmail(email: string, raw?: string | null): boolean {
  return parseAdminEmails(raw ?? process.env.ADMIN_EMAILS).has(email.trim().toLowerCase());
}

/** 注册时决定角色；命中白名单 = admin，否则 player */
export function roleForEmail(email: string, raw?: string | null): 'admin' | 'player' {
  return isAdminEmail(email, raw) ? 'admin' : 'player';
}
