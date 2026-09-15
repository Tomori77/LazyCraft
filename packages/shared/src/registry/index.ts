/**
 * 内容注册表实现 —— DLC 接入的唯一入口。
 *
 * 为什么需要 ContentRegistry 类而不是直接用 types.ts 的 Registry 接口？
 *   Registry 是"接口契约"，ContentRegistry 是"具体实现"。写视角（DLC 用）
 *   走 interface，读视角（引擎用）走 class，两者在同一类型上合并，
 *   调用方按需 import 其中一层即可。
 *
 * 为什么 validate() 收集全部错误而不是第一个就抛？
 *   DLC 作者一次打包几十个内容，启动失败时一次看到全部缺失引用，
 *   改一轮再启动；如果每次只报第一个错，DLC 调试会变成"启动-改一个-再启动"的循环。
 */

import type {
  Content,
  ContentKind,
  ContentPack,
  Enemy,
  Item,
  Registry,
  Skill,
  SkillAction,
  ValidateResult,
} from '../types.js';

/**
 * 内容注册表：进程内单例使用（引擎启动时 new 一次，逐包 register）。
 *
 * 为什么用 Map 按类别分桶而不是一张大表？
 *   get(id, type) 需要按类别精确取（同名 ID 在 skill 和 item 里可以共存，
 *   例如 'mining' 既是技能也可以是同名动作前缀），分桶后查询是 O(1) 且类型安全。
 */
export class ContentRegistry implements Registry {
  private readonly skills = new Map<string, Skill>();
  private readonly actions = new Map<string, SkillAction>();
  private readonly items = new Map<string, Item>();
  private readonly enemies = new Map<string, Enemy>();

  /** 已注册的内容包标识（用于重复注册防御和审计） */
  private readonly registeredPacks: string[] = [];

  /* ------------------------------------------------------------------ */
  /* 写视角：供 ContentPack.register 调用                                  */
  /* ------------------------------------------------------------------ */

  skill(skill: Skill): void {
    this.skills.set(skill.id, skill);
  }

  action(action: SkillAction): void {
    this.actions.set(action.id, action);
  }

  item(item: Item): void {
    this.items.set(item.id, item);
  }

  enemy(enemy: Enemy): void {
    this.enemies.set(enemy.id, enemy);
  }

  /* ------------------------------------------------------------------ */
  /* 读视角：引擎消费用                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * 整包注册一个内容包。
   *
   * 为什么不在 register 时立即 validate？
   *   内容包之间允许交叉引用（A 包的 action 可以用 B 包的 item），
   *   必须等全部包载入完毕再统一 validate，否则加载顺序会变成隐性契约。
   */
  register(pack: ContentPack): void {
    this.registeredPacks.push(`${pack.id}@${pack.version}`);
    pack.register(this);
  }

  /** 按 ID + 类别精确取内容，找不到返回 undefined（由调用方决定容错策略） */
  get(id: string, type: ContentKind): Content | undefined {
    return this.bucketOf(type).get(id);
  }

  /** 列出某类别的全部已注册内容（按注册顺序） */
  list(type: ContentKind): Content[] {
    return [...this.bucketOf(type).values()];
  }

  /** 返回已注册包的 "id@version" 列表（审计 / 启动日志用） */
  listPacks(): readonly string[] {
    return this.registeredPacks;
  }

  /* ------------------------------------------------------------------ */
  /* 一致性校验：启动时调用                                                */
  /* ------------------------------------------------------------------ */

  /**
   * 校验所有已注册内容的引用完整性：
   *   1. action.skill_id 必须指向已注册技能
   *   2. action.input_items / output_items 中的 item id 必须已注册
   *   3. item.source_skill 如果填写，必须指向已注册技能
   *   4. enemy.loot_table_id 如果填写，不能是空字符串
   *      （P1 loot_tables 落地前先做最弱校验，保证字段通路可用）
   *
   * 为什么 error 是字符串而不是结构化对象？
   *   启动阶段错误直接打印到控制台 / 写入日志，人读优先；
   *   不需要前端本地化，字符串是最低成本的"全错误列表"载体。
   */
  validate(): ValidateResult {
    const errors: string[] = [];

    // 校验动作：skill_id / input_items / output_items 引用
    for (const action of this.actions.values()) {
      if (!this.skills.has(action.skill_id)) {
        errors.push(
          `[action:${action.id}] 引用的技能 "${action.skill_id}" 未注册`,
        );
      }
      for (const itemId of Object.keys(action.input_items)) {
        if (!this.items.has(itemId)) {
          errors.push(
            `[action:${action.id}] input_items 引用的物品 "${itemId}" 未注册`,
          );
        }
      }
      for (const itemId of Object.keys(action.output_items)) {
        if (!this.items.has(itemId)) {
          errors.push(
            `[action:${action.id}] output_items 引用的物品 "${itemId}" 未注册`,
          );
        }
      }
    }

    // 校验物品：source_skill 引用（如果填写）
    for (const item of this.items.values()) {
      if (item.source_skill && !this.skills.has(item.source_skill)) {
        errors.push(
          `[item:${item.id}] 引用的 source_skill "${item.source_skill}" 未注册`,
        );
      }
    }

    // 校验敌人：loot_table_id（P1 落地前先校验"非空字符串"占位，保证数据通路可测）
    for (const enemy of this.enemies.values()) {
      if (enemy.loot_table_id !== undefined && enemy.loot_table_id.length === 0) {
        errors.push(`[enemy:${enemy.id}] loot_table_id 不能是空字符串`);
      }
    }

    return { ok: errors.length === 0, errors };
  }

  /* ------------------------------------------------------------------ */
  /* 内部工具                                                              */
  /* ------------------------------------------------------------------ */

  private bucketOf(kind: ContentKind): Map<string, Content> {
    switch (kind) {
      case 'skill':
        return this.skills;
      case 'action':
        return this.actions;
      case 'item':
        return this.items;
      case 'enemy':
        return this.enemies;
      default:
        // 类型层已穷尽，防御未知运行时字符串
        throw new Error(`unknown content kind: ${String(kind)}`);
    }
  }
}

/** 便捷工厂：引擎启动路径里的标准用法 `createRegistry()` */
export function createRegistry(): ContentRegistry {
  return new ContentRegistry();
}

/* 重新导出读视角相关类型，方便调用方只从 registry 入口 import */
export type { Content, ContentKind, ContentPack, ValidateResult };
