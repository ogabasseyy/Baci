'use client';

import {
  type CSSProperties,
  type DragEvent,
  type PointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

const EDGE_GAP = 16;
const DRAG_THRESHOLD = 6;
type Position = { x: number; y: number };
type Overflow = { left: number; top: number; right: number; bottom: number };
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

function clamp(
  x: number,
  y: number,
  width: number,
  height: number,
  bottomSafeArea = 0,
  overflow: Overflow = { left: 0, top: 0, right: 0, bottom: 0 },
): Position {
  return {
    x: Math.max(
      EDGE_GAP + overflow.left,
      Math.min(
        x,
        window.innerWidth - width - EDGE_GAP - overflow.right,
      ),
    ),
    y: Math.max(
      EDGE_GAP + overflow.top,
      Math.min(
        y,
        window.innerHeight -
          height -
          EDGE_GAP -
          bottomSafeArea -
          overflow.bottom,
      ),
    ),
  };
}

/** No layout reads or React renders in the pointer-move path. */
export function useChatLauncherDrag(
  initialPosition?: Position,
  isOpen = false,
  overflowKey: string | boolean = false,
) {
  const [position, setPosition] = useState<Position | undefined>(
    initialPosition,
  );
  const anchorRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const dragged = useRef(false);
  const frame = useRef<number | null>(null);
  const clickSuppressionTimer = useRef<number | null>(null);

  function clearClickSuppressionTimer() {
    if (clickSuppressionTimer.current !== null) {
      window.clearTimeout(clickSuppressionTimer.current);
      clickSuppressionTimer.current = null;
    }
  }

  function readBottomSafeArea() {
    const anchor = anchorRef.current;
    if (!anchor) return 0;
    // Custom properties preserve env() as an unresolved token in some
    // browsers. A pseudo-element's normal height property resolves the inset.
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
      const next = clamp(
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

  useEffect(() => {
    window.addEventListener('resize', reclampPosition);
    const button = buttonRef.current;
    const observer =
      button && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(reclampPosition)
        : null;
    if (button) observer?.observe(button);
    return () => {
      window.removeEventListener('resize', reclampPosition);
      observer?.disconnect();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      clearClickSuppressionTimer();
    };
  }, []);

  useLayoutEffect(() => {
    if (!isOpen && position) reclampPosition();
  }, [isOpen, overflowKey, position]);

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (
      isOpen ||
      gesture.current ||
      event.button !== 0 ||
      event.isPrimary === false
    )
      return;
    // Measure once, before writing styles. The move path uses cached geometry.
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
    start.next = clamp(
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
    // Commit once at release, including when release beats the queued frame.
    if (start && dragged.current) {
      setPosition(start.next);
      clearClickSuppressionTimer();
      clickSuppressionTimer.current = window.setTimeout(() => {
        clickSuppressionTimer.current = null;
        dragged.current = false;
      }, 0);
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

  function suppressClick() {
    const suppress = dragged.current;
    dragged.current = false;
    clearClickSuppressionTimer();
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
