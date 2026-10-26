'use client';

import {
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  clampChatLauncherPosition,
  getChatLauncherAnchorStyle,
  readChatLauncherOverflow,
  readChatLauncherMobileOffset,
  readChatLauncherSafeArea,
  type Position,
} from './chat-launcher-geometry';
import type { Gesture } from './chat-launcher-gesture';
import { isSuppressedChatLauncherDragClick } from './chat-launcher-click-suppression';
import { getChatLauncherKeyboardPosition } from './chat-launcher-keyboard';

const DRAG_THRESHOLD = 6;

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
  const isOpenRef = useRef(isOpen);
  const isHiddenRef = useRef(isHidden);
  const suppressedDragClick = useRef<{
    pointerId: number;
    pointerType: string;
    x: number;
    y: number;
  } | null>(null);
  const safeAreaProbe = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    isOpenRef.current = isOpen;
    isHiddenRef.current = isHidden;
  }, [isOpen, isHidden]);

  function reclampPosition() {
    if (isOpenRef.current || isHiddenRef.current) return;
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
    window.addEventListener('resize', scheduleViewportReclamp);
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
      window.removeEventListener('resize', scheduleViewportReclamp);
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
      pointerType: event.pointerType,
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
    anchorRef.current?.setAttribute('data-chat-launcher-dragging', '');
    dragged.current = false;
    suppressedDragClick.current = null;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onKeyboardMove(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (isOpen || isHidden) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const next = getChatLauncherKeyboardPosition(
      event.key,
      event.shiftKey,
      position ?? { x: rect.left, y: rect.top },
      rect,
      readChatLauncherSafeArea(safeAreaProbe.current),
      readChatLauncherMobileOffset(anchorRef.current),
      readChatLauncherOverflow(event.currentTarget, rect),
    );
    if (!next) return;
    event.preventDefault();
    setPosition(next);
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
    anchorRef.current?.removeAttribute('data-chat-launcher-dragging');
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
    anchorRef.current?.removeAttribute('data-chat-launcher-dragging');
    if (start && dragged.current) {
      if (anchorRef.current) {
        anchorRef.current.style.transform = `translate3d(${start.next.x}px, ${start.next.y}px, 0)`;
      }
      setPosition(start.next);
      suppressedDragClick.current = {
        pointerId: start.pointerId,
        pointerType: start.pointerType,
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

  function suppressClick(event: Parameters<typeof isSuppressedChatLauncherDragClick>[0]) {
    const suppress = isSuppressedChatLauncherDragClick(
      event,
      suppressedDragClick.current,
    );
    // Keyboard clicks keep the token; pointer clicks and pointerdown clear it.
    if (event.detail > 0) suppressedDragClick.current = null;
    if (event.detail === 0) dragged.current = false;
    return suppress;
  }

  const anchorStyle = getChatLauncherAnchorStyle(position, isOpen);

  return {
    position,
    anchorRef,
    buttonRef,
    anchorStyle,
    suppressClick,
    buttonProps: {
      ref: buttonRef,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onKeyDown: onKeyboardMove,
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
