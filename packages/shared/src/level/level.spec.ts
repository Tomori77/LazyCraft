/**
 * 人物等级计算器单测（task-34 / P4-4）。
 *
 * 覆盖：
 *   1. 默认实现 = 攻击技能等级（向后兼容）
 *   2. registerLevelCalculator 替换 / 恢复 / reset
 *   3. 替换后的实现能消费属性（DLC 战斗等级示例）
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_LEVEL_SKILL,
  attackSkillLevelCalculator,
  calculatePersonLevel,
  getLevelCalculator,
  registerLevelCalculator,
  resetLevelCalculator,
} from './index.js';

afterEach(() => {
  resetLevelCalculator();
});

describe('默认等级计算器', () => {
  it('返回攻击技能等级；缺记录/脏值回落到 1', () => {
    expect(DEFAULT_LEVEL_SKILL).toBe('attack');
    expect(calculatePersonLevel({ attack: 12 }, {})).toBe(12);
    expect(calculatePersonLevel({ attack: 0 }, {})).toBe(1);
    expect(calculatePersonLevel({ mining: 99 }, {})).toBe(1);
    expect(calculatePersonLevel({ attack: Number.NaN }, {})).toBe(1);
  });

  it('getLevelCalculator 默认就是攻击技能等级实现', () => {
    expect(getLevelCalculator()).toBe(attackSkillLevelCalculator);
  });
});

describe('替换等级计算器（DLC 扩展点）', () => {
  it('registerLevelCalculator 后 calculatePersonLevel 走新实现，undo 可还原', () => {
    const undo = registerLevelCalculator((skills) =>
      Object.values(skills).reduce((sum, level) => sum + level, 0),
    );
    expect(calculatePersonLevel({ mining: 3, fishing: 4 }, {})).toBe(7);

    undo();
    expect(calculatePersonLevel({ attack: 12 }, {})).toBe(12);
    expect(getLevelCalculator()).toBe(attackSkillLevelCalculator);
  });

  it('计算器可消费属性（示例：生命/10 加到总等级）', () => {
    registerLevelCalculator((_skills, attributes) => {
      const hp = attributes.hp ?? 0;
      return Math.floor(hp / 10);
    });
    expect(calculatePersonLevel({}, { hp: 55 })).toBe(5);
    resetLevelCalculator();
    expect(calculatePersonLevel({ attack: 2 }, {})).toBe(2);
  });
});
