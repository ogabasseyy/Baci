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
  readChatLauncherOverflow,
  readChatLauncherMobileOffset,
  readChatLauncherSafeArea,
  type Overflow,
  type Position,
} from './chat-launcher-geometry';

const DRAG_THRESHOLD = 6;
type Gesture = {
  pointerId: number;
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  left: number;
  top: number;
  width: number;
  height: number;
  bottomSafeArea: number;
  mobileOffset: number;
  overflow: Overflow;
  base: Position;
  next: Position;
};

export function useChatLauncherDrag(
  initialPosition?: Position,
  isOpen = false,
  overflowKey: string | boolean = false,
  isHidden = false,
  constraintKey: string | boolean = false,
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
  const suppressedDragClick = useRef<{
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);
  const safeAreaProbe = useRef<HTMLDivElement | null>(null);

  function reclampPosition() {
    const button = buttonRef.current;
    const rect = button?.getBoundingClientRect();
    if (!button || !rect || rect.width === 0 || rect.height === 0) return;
    const overflow = readChatLauncherOverflow(button, rect);
    setPosition((current) => {
      if (!current) return current;
      const next = clampChatLauncherPosition(
        current.x,
        current.y,
        rect.width,
        rect.height,
        readChatLauncherSafeArea(safeAreaProbe.current),
        readChatLauncherMobileOffset(anchorRef.current),
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

  function handleOverflowAnimationEnd(event: Event) {
    if (
      event.target instanceof Element &&
      event.target.matches('[data-chat-launcher-overflow]')
    ) {
      scheduleViewportReclamp();
    }
  }

  useEffect(() => {
    const probe = document.createElement('div');
    probe.style.cssText =
      'height:env(safe-area-inset-bottom, 0px);position:fixed;visibility:hidden;pointer-events:none;width:0;';
    document.body.append(probe);
    safeAreaProbe.current = probe;
    window.addEventListener('resize', reclampPosition);
    const anchor = anchorRef.current;
    const button = buttonRef.current;
    const observer =
      button && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(reclampPosition)
        : null;
    if (button) observer?.observe(button);
    anchor?.addEventListener('animationend', handleOverflowAnimationEnd, true);
    const visualViewport = window.visualViewport;
    visualViewport?.addEventListener('resize', scheduleViewportReclamp);
    visualViewport?.addEventListener('scroll', scheduleViewportReclamp);
    return () => {
      window.removeEventListener('resize', reclampPosition);
      anchor?.removeEventListener('animationend', handleOverflowAnimationEnd, true);
      visualViewport?.removeEventListener('resize', scheduleViewportReclamp);
      visualViewport?.removeEventListener('scroll', scheduleViewportReclamp);
      observer?.disconnect();
      probe.remove();
      safeAreaProbe.current = null;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      if (viewportFrame.current !== null)
        cancelAnimationFrame(viewportFrame.current);
    };
  }, []);

  useLayoutEffect(() => {
    if (!isOpen && !isHidden && position) reclampPosition();
  }, [constraintKey, isHidden, isOpen, overflowKey, position]);

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (
      isOpen ||
      gesture.current ||
      event.button !== 0 ||
      event.isPrimary === false
    )
      return;
    const rect = event.currentTarget.getBoundingClientRect();
    const bottomSafeArea = readChatLauncherSafeArea(safeAreaProbe.current);
    const mobileOffset = readChatLauncherMobileOffset(anchorRef.current);
    const overflow = readChatLauncherOverflow(event.currentTarget, rect);
    gesture.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      bottomSafeArea,
      mobileOffset,
      overflow,
      base: position ?? { x: 0, y: 0 },
      next: { x: rect.left, y: rect.top },
    };
    dragged.current = false;
    suppressedDragClick.current = null;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function updateGesturePosition(x: number, y: number) {
    const start = gesture.current;
    if (!start) return;
    start.lastX = x;
    start.lastY = y;
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
      start.mobileOffset,
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
    suppressedDragClick.current = null;
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
      suppressedDragClick.current = {
        pointerId: start.pointerId,
        x: start.lastX,
        y: start.lastY,
      };
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
    const pending = suppressedDragClick.current;
    const nativeEvent = event.nativeEvent as MouseEvent & { pointerId?: number };
    // The storefront targets current Safari/iOS Safari releases, where clicks
    // are PointerEvents. Keep the correlation exact rather than guessing for
    // pointer-id-less clicks, which may be independent assistive activation.
    const matchesRelease =
      pending &&
      event.detail > 0 &&
      Math.abs(event.clientX - pending.x) <= 2 &&
      Math.abs(event.clientY - pending.y) <= 2;
    const suppress = Boolean(
      matchesRelease && nativeEvent.pointerId === pending.pointerId,
    );
    if (pending) suppressedDragClick.current = null;
    if (event.detail === 0) dragged.current = false;
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
      onPointerCancel: (event: PointerEvent<HTMLButtonElement>) =>
        gesture.current?.pointerId === event.pointerId && cancelGesture(),
      onLostPointerCapture: (event: PointerEvent<HTMLButtonElement>) =>
        gesture.current?.pointerId === event.pointerId && cancelGesture(),
      style: {
        touchAction: isOpen ? 'auto' : 'none',
        userSelect: 'none',
      } as CSSProperties,
      onDragStart: (event: DragEvent<HTMLButtonElement>) =>
        event.preventDefault(),
    },
  };
}
