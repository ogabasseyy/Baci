'use client';

import {
  type CSSProperties,
  type DragEvent,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react';

const EDGE_GAP = 16;
const DRAG_THRESHOLD = 6;
type Position = { x: number; y: number };
type Gesture = {
  pointerId: number;
  x: number;
  y: number;
  left: number;
  top: number;
  width: number;
  height: number;
  bottomSafeArea: number;
  base: Position;
  next: Position;
};

function clamp(
  x: number,
  y: number,
  width: number,
  height: number,
  bottomSafeArea = 0,
): Position {
  return {
    x: Math.max(EDGE_GAP, Math.min(x, window.innerWidth - width - EDGE_GAP)),
    y: Math.max(
      EDGE_GAP,
      Math.min(y, window.innerHeight - height - EDGE_GAP - bottomSafeArea),
    ),
  };
}

/** No layout reads or React renders in the pointer-move path. */
export function useChatLauncherDrag(
  initialPosition?: Position,
  isOpen = false,
) {
  const [position, setPosition] = useState<Position | undefined>(
    initialPosition,
  );
  const anchorRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const dragged = useRef(false);
  const frame = useRef<number | null>(null);

  function readBottomSafeArea() {
    const anchor = anchorRef.current;
    if (!anchor) return 0;
    const value =
      window
        .getComputedStyle(anchor)
        .getPropertyValue('--ogabassey-chat-safe-area-bottom')
        .trim() ||
      anchor.style.getPropertyValue('--ogabassey-chat-safe-area-bottom').trim();
    return Number.parseFloat(value) || 0;
  }

  useEffect(() => {
    const resize = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;
      setPosition((current) =>
        current
          ? clamp(
              current.x,
              current.y,
              rect.width,
              rect.height,
              readBottomSafeArea(),
            )
          : current,
      );
    };
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, []);

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
    gesture.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      bottomSafeArea,
      base: position ?? { x: 0, y: 0 },
      next: { x: rect.left, y: rect.top },
    };
    dragged.current = false;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const start = gesture.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!dragged.current && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    dragged.current = true;
    start.next = clamp(
      start.left + dx,
      start.top + dy,
      start.width,
      start.height,
      start.bottomSafeArea,
    );
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (!anchorRef.current || !gesture.current) return;
      const { next, base, left, top } = gesture.current;
      anchorRef.current.style.transform = `translate3d(${base.x + next.x - left}px, ${base.y + next.y - top}px, 0)`;
    });
  }

  function cancelGesture() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    gesture.current = null;
    dragged.current = false;
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
    if (start && dragged.current) setPosition(start.next);
  }

  function onPointerUp(event: PointerEvent<HTMLButtonElement>) {
    if (gesture.current?.pointerId !== event.pointerId) return;
    finishGesture();
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function suppressClick() {
    const suppress = dragged.current;
    dragged.current = false;
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
