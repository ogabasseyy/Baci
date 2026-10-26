'use client';

import {
  type CSSProperties,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  clampChatLauncherPosition,
  type Overflow,
  type Position,
} from './chat-launcher-geometry';

const DRAG_THRESHOLD = 6;
type Gesture = {
  pointerId: number;
  x: number;
  y: number;
  left: number;
  top: number;
  width: number;
  height: number;
  bottomSafeArea: number;
  overflow: Overflow;
  base: Position;
  next: Position;
};

/** No layout reads or React renders in the pointer-move path. */
export function useChatLauncherDrag(
  initialPosition?: Position,
  isOpen = false,
  overflowKey: string | boolean = false,
  isHidden = false,
) {
  const [position, setPosition] = useState<Position | undefined>(
    initialPosition,
  );
  const anchorRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const dragged = useRef(false);
  const frame = useRef<number | null>(null);
  const viewportFrame = useRef<number | null>(null);
  const clickSuppressionTimer = useRef<number | null>(null);
  const clickSuppressionUntil = useRef(0);

  function clearClickSuppressionTimer() {
    if (clickSuppressionTimer.current !== null) {
      window.clearTimeout(clickSuppressionTimer.current);
      clickSuppressionTimer.current = null;
    }
  }

  function readBottomSafeArea() {
    const anchor = anchorRef.current;
    if (!anchor) return 0;
    // A pseudo-element's height resolves env() where custom properties do not.
    const value = window.getComputedStyle(anchor, '::before').height;
    if (Number.isFinite(Number.parseFloat(value))) {
      return Number.parseFloat(value);
    }
    const fallback = window
      .getComputedStyle(anchor)
      .getPropertyValue('--ogabassey-chat-safe-area-bottom')
      .trim();
    return Number.parseFloat(fallback) || 0;
  }

  function readOverflow(
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

  function reclampPosition() {
    const button = buttonRef.current;
    const rect = button?.getBoundingClientRect();
    if (!button || !rect || rect.width === 0 || rect.height === 0) return;
    const overflow = readOverflow(button, rect);
    setPosition((current) => {
      if (!current) return current;
      const next = clampChatLauncherPosition(
        current.x,
        current.y,
        rect.width,
        rect.height,
        readBottomSafeArea(),
        overflow,
      );
      return next.x === current.x && next.y === current.y ? current : next;
    });
  }

  function scheduleViewportReclamp() {
    if (viewportFrame.current !== null) return;
    viewportFrame.current = requestAnimationFrame(() => {
      viewportFrame.current = null;
      reclampPosition();
    });
  }

  useEffect(() => {
    window.addEventListener('resize', reclampPosition);
    const button = buttonRef.current;
    const observer =
      button && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(reclampPosition)
        : null;
    if (button) observer?.observe(button);
    const visualViewport = window.visualViewport;
    visualViewport?.addEventListener('resize', scheduleViewportReclamp);
    visualViewport?.addEventListener('scroll', scheduleViewportReclamp);
    return () => {
      window.removeEventListener('resize', reclampPosition);
      visualViewport?.removeEventListener('resize', scheduleViewportReclamp);
      visualViewport?.removeEventListener('scroll', scheduleViewportReclamp);
      observer?.disconnect();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      if (viewportFrame.current !== null)
        cancelAnimationFrame(viewportFrame.current);
      clearClickSuppressionTimer();
    };
  }, []);

  useLayoutEffect(() => {
    if (!isOpen && !isHidden && position) reclampPosition();
  }, [isHidden, isOpen, overflowKey, position]);

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (
      isOpen ||
      gesture.current ||
      event.button !== 0 ||
      event.isPrimary === false
    )
      return;
    const rect = event.currentTarget.getBoundingClientRect();
    const bottomSafeArea = readBottomSafeArea();
    const overflow = readOverflow(event.currentTarget, rect);
    gesture.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      bottomSafeArea,
      overflow,
      base: position ?? { x: 0, y: 0 },
      next: { x: rect.left, y: rect.top },
    };
    dragged.current = false;
    clearClickSuppressionTimer();
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function updateGesturePosition(x: number, y: number) {
    const start = gesture.current;
    if (!start) return;
    const dx = x - start.x;
    const dy = y - start.y;
    if (!dragged.current && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    dragged.current = true;
    start.next = clampChatLauncherPosition(
      start.left + dx,
      start.top + dy,
      start.width,
      start.height,
      start.bottomSafeArea,
      start.overflow,
    );
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (!anchorRef.current || !gesture.current) return;
      const { next, base, left, top } = gesture.current;
      anchorRef.current.style.transform = `translate3d(${base.x + next.x - left}px, ${base.y + next.y - top}px, 0)`;
    });
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (gesture.current?.pointerId !== event.pointerId) return;
    updateGesturePosition(event.clientX, event.clientY);
  }

  function cancelGesture() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    gesture.current = null;
    dragged.current = false;
    clearClickSuppressionTimer();
    if (anchorRef.current) {
      anchorRef.current.style.transform = position
        ? `translate3d(${position.x}px, ${position.y}px, 0)`
        : '';
    }
  }

  function finishGesture() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const start = gesture.current;
    gesture.current = null;
    if (start && dragged.current) {
      setPosition(start.next);
      clearClickSuppressionTimer();
      clickSuppressionUntil.current = performance.now() + 500;
      clickSuppressionTimer.current = window.setTimeout(() => {
        clickSuppressionTimer.current = null;
        clickSuppressionUntil.current = 0;
        dragged.current = false;
      }, 500);
    }
  }

  function onPointerUp(event: PointerEvent<HTMLButtonElement>) {
    if (gesture.current?.pointerId !== event.pointerId) return;
    // Pointer-up can carry the only event for the final part of a fast flick.
    updateGesturePosition(event.clientX, event.clientY);
    finishGesture();
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function suppressClick(event: ReactMouseEvent<HTMLButtonElement>) {
    const suppress =
      dragged.current &&
      event.detail > 0 &&
      performance.now() <= clickSuppressionUntil.current;
    if (suppress || event.detail === 0) {
      dragged.current = false;
      clickSuppressionUntil.current = 0;
      clearClickSuppressionTimer();
    }
    return suppress;
  }

  const anchorStyle: CSSProperties | undefined =
    position && !isOpen
      ? {
          left: 0,
          top: 0,
          right: 'auto',
          bottom: 'auto',
          transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
        }
      : undefined;

  return {
    position,
    anchorRef,
    anchorStyle,
    suppressClick,
    buttonProps: {
      ref: buttonRef,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => {
        if (gesture.current?.pointerId === event.pointerId) cancelGesture();
      },
      onLostPointerCapture: (event: PointerEvent<HTMLButtonElement>) => {
        if (gesture.current?.pointerId === event.pointerId) cancelGesture();
      },
      style: {
        touchAction: isOpen ? 'auto' : 'none',
        userSelect: 'none',
      } as CSSProperties,
      onDragStart: (event: DragEvent<HTMLButtonElement>) =>
        event.preventDefault(),
    },
  };
}
