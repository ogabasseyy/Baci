import type { CSSProperties } from 'react';

const EDGE_GAP = 16;

export type Position = { x: number; y: number };
export type Overflow = { left: number; top: number; right: number; bottom: number };

export function getChatLauncherAnchorStyle(
  position: Position | undefined,
  isOpen: boolean,
): CSSProperties | undefined {
  if (!position || isOpen) return undefined;
  return {
    left: 0,
    top: 0,
    right: 'auto',
    bottom: 'auto',
    transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
  };
}

export function readChatLauncherOverflow(
  button: HTMLButtonElement,
  buttonRect: DOMRect,
): Overflow {
  const overflow: Overflow = { left: 0, top: 0, right: 0, bottom: 0 };
  const overlays = button.parentElement?.querySelectorAll<HTMLElement>(
    '[data-chat-launcher-overflow]',
  );
  overlays?.forEach((overlay) => {
    const style = window.getComputedStyle(overlay);
    if (style.display === 'none' || style.visibility === 'hidden') return;
    const rect = overlay.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    overflow.left = Math.max(overflow.left, buttonRect.left - rect.left);
    overflow.top = Math.max(overflow.top, buttonRect.top - rect.top);
    overflow.right = Math.max(overflow.right, rect.right - buttonRect.right);
    overflow.bottom = Math.max(overflow.bottom, rect.bottom - buttonRect.bottom);
  });
  return overflow;
}

export function readChatLauncherSafeArea(probe: HTMLElement | null) {
  return Number.parseFloat(
    probe ? window.getComputedStyle(probe).height : '0',
  ) || 0;
}

export function readChatLauncherMobileOffset(anchor: HTMLElement | null) {
  if (!anchor || window.innerWidth >= 768) return 0;
  return Number.parseFloat(window.getComputedStyle(anchor, '::after').height) || 0;
}

function clampAxis(
  value: number,
  min: number,
  max: number,
  fallbackMin: number,
  fallbackMax: number,
) {
  return min <= max
    ? Math.max(min, Math.min(value, max))
    : Math.max(fallbackMin, Math.min(value, Math.max(fallbackMin, fallbackMax)));
}

export function clampChatLauncherPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  bottomSafeArea = 0,
  mobileOffset = 0,
  overflow: Overflow = { left: 0, top: 0, right: 0, bottom: 0 },
): Position {
  const viewport = window.visualViewport;
  const viewportLeft = viewport?.offsetLeft ?? 0;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportWidth = viewport?.width ?? window.innerWidth;
  const viewportHeight = viewport?.height ?? window.innerHeight;
  const minX = viewportLeft + EDGE_GAP + overflow.left;
  const maxX = viewportLeft + viewportWidth - width - EDGE_GAP - overflow.right;
  const minY = viewportTop + EDGE_GAP + overflow.top;
  const maxY =
    viewportTop +
    viewportHeight -
    height -
    EDGE_GAP -
    bottomSafeArea -
    mobileOffset -
    overflow.bottom;

  return {
    x: clampAxis(
      x,
      minX,
      maxX,
      viewportLeft,
      viewportLeft + viewportWidth - width,
    ),
    y: clampAxis(
      y,
      minY,
      maxY,
      viewportTop,
      viewportTop + viewportHeight - height - bottomSafeArea - mobileOffset,
    ),
  };
}
