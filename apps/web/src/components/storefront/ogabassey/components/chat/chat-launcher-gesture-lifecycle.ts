import type { PointerEvent } from 'react';
import type { Gesture } from './chat-launcher-gesture';

export type SuppressedDragClick = {
  pointerId: number;
  pointerType: string;
  x: number;
  y: number;
};

type GestureLifecycleOptions = {
  gesture: { current: Gesture | null };
  dragged: { current: boolean };
  frame: { current: number | null };
  anchor: { current: HTMLDivElement | null };
  position: () => { x: number; y: number } | undefined;
  commitPosition: (position: { x: number; y: number }) => void;
  scheduleViewportReclamp: () => void;
  viewportReclampPending: { current: boolean };
  suppressedDragClick: { current: SuppressedDragClick | null };
};

export function createChatLauncherGestureLifecycle({
  gesture,
  dragged,
  frame,
  anchor,
  position,
  commitPosition,
  scheduleViewportReclamp,
  viewportReclampPending,
  suppressedDragClick,
}: GestureLifecycleOptions) {
  function finishGesture() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const start = gesture.current;
    gesture.current = null;
    anchor.current?.removeAttribute('data-chat-launcher-dragging');
    if (start && dragged.current) {
      if (anchor.current) {
        anchor.current.style.transform = `translate3d(${start.next.x}px, ${start.next.y}px, 0)`;
      }
      commitPosition(start.next);
      suppressedDragClick.current = {
        pointerId: start.pointerId,
        pointerType: start.pointerType,
        x: start.lastX,
        y: start.lastY,
      };
    }
    if (viewportReclampPending.current) {
      viewportReclampPending.current = false;
      scheduleViewportReclamp();
    }
  }

  function cancelGesture() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    gesture.current = null;
    dragged.current = false;
    suppressedDragClick.current = null;
    anchor.current?.removeAttribute('data-chat-launcher-dragging');
    if (anchor.current) {
      const current = position();
      anchor.current.style.transform = current
        ? `translate3d(${current.x}px, ${current.y}px, 0)`
        : '';
    }
    if (viewportReclampPending.current) {
      viewportReclampPending.current = false;
      scheduleViewportReclamp();
    }
  }

  function onPointerUp(event: PointerEvent<HTMLButtonElement>) {
    if (gesture.current?.pointerId !== event.pointerId) return;
    const start = gesture.current;
    if (start) {
      start.lastX = event.clientX;
      start.lastY = event.clientY;
    }
    finishGesture();
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return { finishGesture, cancelGesture, onPointerUp };
}
