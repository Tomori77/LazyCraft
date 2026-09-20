/**
 * 外部图标源的许可与署名元数据。
 *
 * 为什么署名要建模进代码而不是只写 README？
 *   抽取脚本产出的 sprite 一旦被 DLC 带进运行时，署名义务就跟着走；
 *   把许可信息挂在抽取结果上，页脚/关于页可以直接消费，
 *   避免"换了素材忘了换署名"这类只在法务时才暴露的问题。
 */

/** 外部源许可信息 */
export interface IconAttribution {
  source: 'game-icons' | 'lucide';
  /** 许可名称 */
  license: string;
  /** 许可全文地址 */
  licenseUrl: string;
  /** 是否强制署名（CC BY 3.0 = 是；ISC = 否，仍建议列出） */
  requiresAttribution: boolean;
  /** 项目主页 */
  homepage: string;
  /** 给页脚/关于页直接用的中文署名文案 */
  credit: string;
}

/** 两个外部源（也是本库唯一认可的外部源）的署名元数据 */
export const EXTERNAL_ATTRIBUTIONS: Readonly<
  Record<'game-icons' | 'lucide', IconAttribution>
> = {
  'game-icons': {
    source: 'game-icons',
    license: 'CC BY 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    requiresAttribution: true,
    homepage: 'https://game-icons.net',
    credit: '部分图标来自 game-icons.net（CC BY 3.0），作者见各图标页署名。',
  },
  lucide: {
    source: 'lucide',
    license: 'ISC',
    licenseUrl: 'https://github.com/lucide-icons/lucide/blob/main/LICENSE',
    requiresAttribution: false,
    homepage: 'https://lucide.dev',
    credit: '部分图标来自 lucide（ISC 许可）。',
  },
};

/** 取某个外部源的署名信息 */
export function attributionFor(source: 'game-icons' | 'lucide'): IconAttribution {
  return EXTERNAL_ATTRIBUTIONS[source];
}
