import type { MouseEvent as ReactMouseEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  CHAT_LAUNCHER_DRAG_CLICK_MAX_DELAY_MS,
  clearChatLauncherDragClickOnNewInteraction,
  isSuppressedChatLauncherDragClick,
} from './chat-launcher-click-suppression';

function clickEvent({
  detail = 1,
  pointerId,
  pointerType,
  isTrusted = true,
  x = 100,
  y = 200,
}: {
  detail?: number;
  pointerId?: number;
  pointerType?: string;
  isTrusted?: boolean;
  x?: number;
  y?: number;
} = {}) {
  return {
    clientX: x,
    clientY: y,
    detail,
    nativeEvent: {
      ...(pointerId === undefined ? {} : { pointerId }),
      ...(pointerType === undefined ? {} : { pointerType }),
      isTrusted,
    },
  } as unknown as ReactMouseEvent<HTMLButtonElement>;
}

const release = {
  pointerId: 7,
  pointerType: 'mouse',
  x: 100,
  y: 200,
  expiresAt: Number.MAX_SAFE_INTEGER,
};

describe('chat launcher click suppression', () => {
  it('suppresses a release-correlated pointer click', () => {
    expect(
      isSuppressedChatLauncherDragClick(
        clickEvent({ pointerId: 7 }),
        release,
      ),
    ).toBe(true);
  });

  it('leaves keyboard activation independent', () => {
    expect(
      isSuppressedChatLauncherDragClick(
        clickEvent({ detail: 0 }),
        release,
      ),
    ).toBe(false);
  });

  it('allows a trusted pointerless click away from the release point', () => {
    expect(
      isSuppressedChatLauncherDragClick(
        clickEvent({ x: 104, y: 200 }),
        release,
      ),
    ).toBe(false);
  });

  it('suppresses a trusted pointerless click at the release point', () => {
    expect(
      isSuppressedChatLauncherDragClick(clickEvent(), release),
    ).toBe(true);
  });

  it('allows an untrusted pointerless click at the release point', () => {
    expect(
      isSuppressedChatLauncherDragClick(
        clickEvent({ isTrusted: false }),
        release,
      ),
    ).toBe(false);
  });

  it('suppresses a delayed trusted pointerless compatibility click', () => {
    vi.useFakeTimers();
    const delayedRelease = {
      ...release,
      expiresAt: Date.now() + CHAT_LAUNCHER_DRAG_CLICK_MAX_DELAY_MS,
    };
    vi.advanceTimersByTime(1000);
    expect(isSuppressedChatLauncherDragClick(clickEvent(), delayedRelease)).toBe(true);
    vi.useRealTimers();
  });

  it('allows a pointerless activation after the drag correlation expires', () => {
    vi.useFakeTimers();
    const staleRelease = {
      ...release,
      expiresAt: Date.now() + CHAT_LAUNCHER_DRAG_CLICK_MAX_DELAY_MS,
    };
    vi.advanceTimersByTime(CHAT_LAUNCHER_DRAG_CLICK_MAX_DELAY_MS + 1);
    expect(isSuppressedChatLauncherDragClick(clickEvent(), staleRelease)).toBe(false);
    vi.useRealTimers();
  });

  it('does not let a click-less drag token swallow a later pointerless activation', () => {
    const pending = { current: release };
    clearChatLauncherDragClickOnNewInteraction(pending);
    expect(
      isSuppressedChatLauncherDragClick(clickEvent(), pending.current),
    ).toBe(false);
  });

  it('suppresses Firefox touch clicks reported with pointer ID zero', () => {
    expect(
      isSuppressedChatLauncherDragClick(
        clickEvent({ pointerId: 0, pointerType: 'touch' }),
        { ...release, pointerType: 'touch' },
      ),
    ).toBe(true);
  });

  it('suppresses Firefox mouse clicks reported with pointer ID zero', () => {
    expect(
      isSuppressedChatLauncherDragClick(
        clickEvent({ pointerId: 0, pointerType: 'mouse' }),
        { ...release, pointerId: 0 },
      ),
    ).toBe(true);
  });

  it('does not suppress pointer ID zero away from the release point', () => {
    expect(
      isSuppressedChatLauncherDragClick(
        clickEvent({ pointerId: 0, pointerType: 'mouse', x: 104 }),
        release,
      ),
    ).toBe(false);
  });

  it('does not suppress pointer ID zero when the pointer type differs', () => {
    expect(
      isSuppressedChatLauncherDragClick(
        clickEvent({ pointerId: 0, pointerType: 'mouse' }),
        { ...release, pointerId: 0, pointerType: 'touch' },
      ),
    ).toBe(false);
  });
});
