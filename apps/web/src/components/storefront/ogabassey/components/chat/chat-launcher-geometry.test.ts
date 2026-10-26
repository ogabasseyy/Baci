import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clampChatLauncherPosition,
  getChatLauncherAnchorStyle,
  readChatLauncherOverflow,
} from './chat-launcher-geometry';

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
  it('applies the saved transform only while the launcher is closed', () => {
    expect(getChatLauncherAnchorStyle({ x: 24, y: 40 }, false)).toEqual({
      left: 0,
      top: 0,
      right: 'auto',
      bottom: 'auto',
      transform: 'translate3d(24px, 40px, 0)',
    });
    expect(getChatLauncherAnchorStyle({ x: 24, y: 40 }, true)).toBeUndefined();
  });

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
      clampChatLauncherPosition(0, 60, 80, 56, 0, 0, {
        left: 50,
        top: 0,
        right: 50,
        bottom: 0,
      }),
    ).toEqual({ x: 100, y: 66 });
  });
});

describe('readChatLauncherOverflow', () => {
  it('measures visible overflow and ignores hidden or empty bubbles', () => {
    const parent = document.createElement('div');
    const button = document.createElement('button');
    const visible = document.createElement('div');
    const hidden = document.createElement('div');
    const empty = document.createElement('div');
    visible.dataset.chatLauncherOverflow = '';
    hidden.dataset.chatLauncherOverflow = '';
    hidden.style.display = 'none';
    empty.dataset.chatLauncherOverflow = '';
    parent.append(button, visible, hidden, empty);
    vi.spyOn(visible, 'getBoundingClientRect').mockReturnValue({
      left: 180,
      top: 280,
      width: 100,
      height: 100,
      right: 280,
      bottom: 380,
      x: 180,
      y: 280,
      toJSON: () => ({}),
    });

    expect(
      readChatLauncherOverflow(button, {
        left: 200,
        top: 300,
        width: 56,
        height: 56,
        right: 256,
        bottom: 356,
        x: 200,
        y: 300,
        toJSON: () => ({}),
      } as DOMRect),
    ).toEqual({ left: 20, top: 20, right: 24, bottom: 24 });
  });
});
