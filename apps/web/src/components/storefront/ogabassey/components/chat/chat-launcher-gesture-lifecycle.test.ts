import { describe, expect, it, vi } from 'vitest';
import type { Gesture } from './chat-launcher-gesture';
import { createChatLauncherGestureLifecycle } from './chat-launcher-gesture-lifecycle';

function setup() {
  const gesture: { current: Gesture | null } = {
    current: {
      pointerId: 3,
      pointerType: 'touch',
      x: 10,
      y: 20,
      lastX: 30,
      lastY: 40,
      left: 5,
      top: 8,
      width: 56,
      height: 56,
      bottomSafeArea: 0,
      safeArea: { left: 0, top: 0, right: 0 },
      mobileOffset: 0,
      overflow: { left: 0, top: 0, right: 0, bottom: 0 },
      base: { x: 0, y: 0 },
      next: { x: 25, y: 28 },
    },
  };
  const anchor = document.createElement('div');
  anchor.setAttribute('data-chat-launcher-dragging', '');
  anchor.style.transform = 'translate3d(25px, 28px, 0)';
  const dragged = { current: true };
  const frame = { current: null as number | null };
  const viewportReclampPending = { current: false };
  const suppressedDragClick = {
    current: null as {
      pointerId: number;
      pointerType: string;
      x: number;
      y: number;
    } | null,
  };
  const commitPosition = vi.fn();
  const scheduleViewportReclamp = vi.fn();
  const lifecycle = createChatLauncherGestureLifecycle({
    gesture,
    dragged,
    frame,
    anchor: { current: anchor },
    position: () => ({ x: 5, y: 8 }),
    commitPosition,
    scheduleViewportReclamp,
    viewportReclampPending,
    suppressedDragClick,
  });
  return {
    anchor,
    dragged,
    gesture,
    lifecycle,
    scheduleViewportReclamp,
    suppressedDragClick,
    viewportReclampPending,
    commitPosition,
  };
}

describe('chat launcher gesture lifecycle', () => {
  it('commits a finished drag and stores its release correlation', () => {
    const state = setup();
    state.lifecycle.finishGesture();

    expect(state.commitPosition).toHaveBeenCalledWith({ x: 25, y: 28 });
    expect(state.suppressedDragClick.current).toEqual({
      pointerId: 3,
      pointerType: 'touch',
      x: 30,
      y: 40,
    });
    expect(state.gesture.current).toBeNull();
    expect(state.anchor.hasAttribute('data-chat-launcher-dragging')).toBe(false);
  });

  it('rolls back a cancelled drag and clears click suppression', () => {
    const state = setup();
    state.suppressedDragClick.current = {
      pointerId: 3,
      pointerType: 'touch',
      x: 30,
      y: 40,
    };
    state.lifecycle.cancelGesture();

    expect(state.commitPosition).not.toHaveBeenCalled();
    expect(state.suppressedDragClick.current).toBeNull();
    expect(state.dragged.current).toBe(false);
    expect(state.anchor.style.transform).toBe('translate3d(5px, 8px, 0)');
    expect(state.gesture.current).toBeNull();
  });

  it('re-clamps after finishing a drag when the viewport changed mid-gesture', () => {
    const state = setup();
    state.viewportReclampPending.current = true;
    state.lifecycle.finishGesture();

    expect(state.scheduleViewportReclamp).toHaveBeenCalledOnce();
    expect(state.viewportReclampPending.current).toBe(false);
  });
});
