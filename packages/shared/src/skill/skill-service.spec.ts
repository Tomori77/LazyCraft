/**
 * SkillService 单元测试：经验曲线 + 等级反查
 */

import { describe, expect, it } from 'vitest';

import { exp, expToNextLevel, levelFromExp } from './skill-service.js';

describe('exp()', () => {
  it('边界与整数幂值精确命中', () => {
    expect(exp(1)).toBe(1);
    expect(exp(2)).toBe(8);
    expect(exp(10)).toBe(1000);
    expect(exp(99)).toBe(970299);
  });

  it('非正数或非整数直接拒绝', () => {
    expect(() => exp(0)).toThrow(RangeError);
    expect(() => exp(-3)).toThrow(RangeError);
    expect(() => exp(2.5)).toThrow(RangeError);
  });
});

describe('levelFromExp()', () => {
  it('恰好落在边界时返回对应等级（左闭）', () => {
    expect(levelFromExp(1)).toBe(1);
    expect(levelFromExp(8)).toBe(2);
    expect(levelFromExp(1000)).toBe(10);
  });

  it('区间内取底（右开）：差 1 点也不升级', () => {
    expect(levelFromExp(7)).toBe(1); // 8-1 还是 1 级
    expect(levelFromExp(999)).toBe(9); // 1000-1 还是 9 级
    expect(levelFromExp(1001)).toBe(10);
  });

  it('大数值往返一致', () => {
    for (const level of [1, 5, 42, 99, 120]) {
      expect(levelFromExp(exp(level))).toBe(level);
      expect(levelFromExp(exp(level + 1) - 1)).toBe(level);
    }
  });

  it('非法输入拒绝；0 经验按新玩家处理视为 1 级', () => {
    expect(levelFromExp(0)).toBe(1); // 新玩家没有经验记录，但等级必须是 1
    expect(() => levelFromExp(-10)).toThrow(RangeError);
    expect(() => levelFromExp(Number.NaN)).toThrow(RangeError);
  });
});

describe('expToNextLevel()', () => {
  it('刚升级时缺口最大', () => {
    // 1 级：下一级 8 exp，当前 1 exp，缺口 7
    expect(expToNextLevel(1)).toBe(7);
    // 999 exp（9 级）：下一级 1000，缺口 1
    expect(expToNextLevel(999)).toBe(1);
  });
});
