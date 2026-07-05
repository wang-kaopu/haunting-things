import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@renderer/shared/components/ui/button';
import { cn } from '@renderer/shared/lib/utils';

export const COLLAPSED_MESSAGE_LINES = 12;

export type CollapsibleMessageContentProps = {
  children: ReactNode;
  maxLines?: number;
  className?: string;
  contentClassName?: string;
  actionsClassName?: string;
};

/**
 * 聊天正文折叠容器，用当前字体行高计算最多展示行数，避免长消息撑满对话流。
 */
export function CollapsibleMessageContent({
  children,
  maxLines = COLLAPSED_MESSAGE_LINES,
  className,
  contentClassName,
  actionsClassName,
}: CollapsibleMessageContentProps): React.ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const pendingScrollAdjustmentRef = useRef<{
    scrollParent: HTMLElement;
    rootTop: number;
  } | null>(null);
  const [canCollapse, setCanCollapse] = useState(false);
  const [collapsedHeight, setCollapsedHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element) return;

    const measurement = measureCollapsibleContent(element, maxLines);
    updateMeasurement(measurement, setCollapsedHeight, setCanCollapse);
  }, [children, maxLines]);

  useEffect(() => {
    const element = contentRef.current;
    if (!element) return undefined;

    const observer = new ResizeObserver(() => {
      const measurement = measureCollapsibleContent(element, maxLines);
      updateMeasurement(measurement, setCollapsedHeight, setCanCollapse);
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [maxLines]);

  useLayoutEffect(() => {
    const adjustment = pendingScrollAdjustmentRef.current;
    const root = rootRef.current;
    if (!adjustment || !root) return;

    pendingScrollAdjustmentRef.current = null;
    adjustment.scrollParent.scrollTop += root.getBoundingClientRect().top - adjustment.rootTop;

    requestAnimationFrame(() => {
      root.scrollIntoView({
        block: 'nearest',
        behavior: 'auto',
      });
    });
  }, [expanded]);

  const collapsed = canCollapse && !expanded;

  /**
   * 切换前记录消息顶部位置，切换后补偿滚动容器，避免浏览器锚定到按钮导致正文跑出视口。
   */
  function toggleExpanded(): void {
    const root = rootRef.current;
    const scrollParent = root ? getScrollableParent(root) : null;
    pendingScrollAdjustmentRef.current =
      root && scrollParent
        ? {
          scrollParent,
          rootTop: root.getBoundingClientRect().top,
        }
        : null;
    setExpanded((current) => !current);
  }

  return (
    <div ref={rootRef} className={cn('min-w-0', className)}>
      <div
        className={cn('min-w-0', collapsed && 'overflow-hidden')}
        style={collapsed && collapsedHeight ? { maxHeight: collapsedHeight } : undefined}
      >
        <div ref={contentRef} className={cn('flow-root min-w-0', contentClassName)}>
          {children}
        </div>
      </div>
      {canCollapse ? (
        <div className={cn('mt-1 flex justify-end', actionsClassName)}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 rounded-full px-2 text-xs font-medium text-muted-foreground"
            onClick={toggleExpanded}
          >
            {expanded ? (
              <>
                收起
                <ChevronUpIcon aria-hidden="true" className="size-3.5" />
              </>
            ) : (
              <>
                展开
                <ChevronDownIcon aria-hidden="true" className="size-3.5" />
              </>
            )}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 按当前渲染字体计算折叠高度，保证中文、英文和 Markdown 块内容共用同一行数规则。
 */
function measureCollapsibleContent(
  element: HTMLElement,
  maxLines: number
): { collapsedHeight: number; canCollapse: boolean } {
  const computedStyle = window.getComputedStyle(element);
  const fontSize = Number.parseFloat(computedStyle.fontSize) || 15;
  const parsedLineHeight = Number.parseFloat(computedStyle.lineHeight);
  const lineHeight = Number.isFinite(parsedLineHeight) ? parsedLineHeight : fontSize * 1.6;
  const collapsedHeight = Math.ceil(lineHeight * maxLines);

  return {
    collapsedHeight,
    canCollapse: element.scrollHeight > collapsedHeight + 1,
  };
}

/**
 * 只在测量结果真实变化时更新状态，降低 ResizeObserver 引起的重复重排。
 */
function updateMeasurement(
  measurement: { collapsedHeight: number; canCollapse: boolean },
  setCollapsedHeight: React.Dispatch<React.SetStateAction<number | null>>,
  setCanCollapse: React.Dispatch<React.SetStateAction<boolean>>
): void {
  setCollapsedHeight((current) =>
    current === measurement.collapsedHeight ? current : measurement.collapsedHeight
  );
  setCanCollapse((current) =>
    current === measurement.canCollapse ? current : measurement.canCollapse
  );
}

/**
 * 找到承载消息流的最近滚动容器，用于展开长消息后保持视口位置稳定。
 */
function getScrollableParent(element: HTMLElement): HTMLElement | null {
  let current = element.parentElement;
  while (current) {
    const overflowY = window.getComputedStyle(current).overflowY;
    const scrollable = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
    if (scrollable && current.scrollHeight > current.clientHeight) return current;
    current = current.parentElement;
  }
  return null;
}
