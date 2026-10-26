import { afterEach, describe, expect, it, vi } from 'vitest';
import { clampChatLauncherPosition } from './chat-launcher-geometry';

afterEach(() => {
  vi.unstubAllGlobals();
});

function setVisualViewport(
  offsetLeft: number,
  offsetTop: number,
  width: number,
  height: number,
) {
  const viewport = Object.assign(new EventTarget(), {
    offsetLeft,
    offsetTop,
    width,
    height,
  }) as unknown as VisualViewport;
  vi.stubGlobal('visualViewport', viewport);
}

describe('clampChatLauncherPosition', () => {
  it('keeps the launcher inside visual viewport offsets', () => {
    setVisualViewport(40, 20, 200, 300);
    expect(clampChatLauncherPosition(0, 0, 56, 56)).toEqual({ x: 56, y: 36 });
  });

  it('preserves the bottom safe-area inset', () => {
    setVisualViewport(0, 0, 320, 480);
    expect(clampChatLauncherPosition(200, 900, 56, 56, 34).y).toBe(374);
  });

  it('keeps the launcher reachable when bubble overflow cannot fit', () => {
    setVisualViewport(100, 50, 120, 300);
    expect(
      clampChatLauncherPosition(0, 60, 80, 56, 0, {
        left: 50,
        top: 0,
        right: 50,
        bottom: 0,
      }),
    ).toEqual({ x: 100, y: 66 });
  });
});
