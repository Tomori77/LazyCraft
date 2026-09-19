import { describe, expect, it } from 'vitest';
import { isAdminEmail, parseAdminEmails, roleForEmail } from './admin-emails.js';

/**
 * 首个管理员授予逻辑（task-24b）的纯逻辑单测。
 *
 * 邮箱白名单的解析容错（大小写 / 空白 / 空项）决定"谁能拿到 admin"，
 * 一旦写错就是真实的越权风险，必须固定行为。
 */
describe('parseAdminEmails', () => {
  it('空值返回空集合', () => {
    expect(parseAdminEmails(undefined).size).toBe(0);
    expect(parseAdminEmails('').size).toBe(0);
    expect(parseAdminEmails(null).size).toBe(0);
  });

  it('按逗号拆分并规范化为小写、去空白', () => {
    const set = parseAdminEmails(' Boss@Example.com , ops@example.com ,');
    expect([...set].sort()).toEqual(['boss@example.com', 'ops@example.com']);
  });
});

describe('roleForEmail', () => {
  it('命中白名单（大小写不敏感）为 admin', () => {
    expect(roleForEmail('Admin@Example.com', 'admin@example.com')).toBe('admin');
  });

  it('未命中为 player', () => {
    expect(roleForEmail('player@example.com', 'admin@example.com')).toBe('player');
    expect(roleForEmail('player@example.com', '')).toBe('player');
  });

  it('isAdminEmail 与 roleForEmail 判定一致', () => {
    expect(isAdminEmail('a@b.com', 'a@b.com')).toBe(true);
    expect(isAdminEmail('a@b.com', 'x@y.com')).toBe(false);
  });
});
