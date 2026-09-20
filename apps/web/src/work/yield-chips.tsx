import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useT } from '../i18n/index.ts';
import { useContent } from '../content/content-context.tsx';
import { Icon } from '../icons/icon.tsx';
import { itemIconName } from '../icons/resolve-icon.ts';
import { toQualityClass } from '../lib/quality.ts';

/**
 * 工作卡片产出区：标签独占一行，徽章另起一行，最多 3 行，超出显示「…」。
 *
 * 为什么悬浮用浮层而不是直接换行展开？
 *   卡片高度固定、.cards 有 overflow 裁剪；就地展开会把别的卡片顶下去，
 *   也让"最多 3 行"的收敛失去意义。浮层打开时切成 fixed 并用标签视口坐标定位，
 *   才能逃逸所有 overflow:hidden 祖先，靠底时向上翻转（原型同名逻辑）。
 */
interface YieldChipsProps {
  outputs: ReadonlyArray<[string, number]>;
}

export function YieldChips({ outputs }: YieldChipsProps) {
  const { t } = useT();
  const { content } = useContent();
  const [isClamped, setIsClamped] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [popUp, setPopUp] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const chipsRef = useRef<HTMLDivElement | null>(null);
  const labelRef = useRef<HTMLSpanElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  const qualityOf = (itemId: string): string => {
    const catalogItem = content?.itemCatalog?.find((i) => i.id === itemId);
    return toQualityClass(catalogItem?.quality?.[0]);
  };

  // 溢出测量：内容比裁剪高度高才显示「…」；resize 后卡片宽度变化需重测
  useEffect(() => {
    const measure = () => {
      const chips = chipsRef.current;
      if (chips) setIsClamped(chips.scrollHeight > chips.clientHeight + 1);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [outputs]);

  // 打开后再量浮层尺寸决定上下翻转。
  // 必须先切成 fixed 才量：.cards/.center/.grid3 都带 overflow:hidden，
  // absolute 浮层会被裁，且其坐标相对最近的定位祖先，量出来的是卡片内偏移。
  useLayoutEffect(() => {
    if (!isOpen) return;
    const label = labelRef.current;
    const pop = popRef.current;
    if (!label || !pop) return;
    pop.style.position = 'fixed';
    pop.style.left = '0px';
    pop.style.top = '0px';
    pop.style.right = 'auto';
    pop.style.bottom = 'auto';
    // 取 CSS 上限与视口的小者，避免多产出浮层横向撑爆
    pop.style.maxWidth = `${Math.min(320, window.innerWidth - 16)}px`;
    const lb = label.getBoundingClientRect();
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    const up = lb.bottom + 4 + ph + 8 > window.innerHeight && lb.top - 4 - ph - 8 > 0;
    const x = Math.max(8, Math.min(lb.left, window.innerWidth - pw - 8));
    const y = up ? lb.top - 4 - ph : lb.bottom + 4;
    pop.style.left = `${x}px`;
    pop.style.top = `${Math.max(8, Math.min(y, window.innerHeight - ph - 8))}px`;
    setPopUp(up);
  }, [isOpen, outputs]);

  const renderChips = () =>
    outputs.map(([itemId, qty]) => (
      <span key={itemId} className={`yield-chip ${qualityOf(itemId)}`}>
        <Icon name={itemIconName(itemId)} size={14} />
        <b>
          {t(`item.${itemId}.name`)} ×{qty}
        </b>
      </span>
    ));

  return (
    <div
      ref={boxRef}
      className={`wcard-yield ${isClamped ? 'is-clamped' : ''} ${isOpen ? 'is-open' : ''} ${popUp ? 'pop-up' : ''}`}
      onMouseLeave={() => setIsOpen(false)}
    >
      <span
        ref={labelRef}
        className="yield-label"
        onMouseEnter={() => setIsOpen(true)}
        onMouseMove={() => setIsOpen(true)}
      >
        {t('work.card.yield')}
      </span>
      <div ref={chipsRef} className="yield-chips">
        {renderChips()}
      </div>
      <span className="yield-more">…</span>
      <div ref={popRef} className="yield-pop">
        <div className="yield-pop-title">{t('work.card.yield_all')}</div>
        <div className="yield-chips">{renderChips()}</div>
      </div>
    </div>
  );
}
