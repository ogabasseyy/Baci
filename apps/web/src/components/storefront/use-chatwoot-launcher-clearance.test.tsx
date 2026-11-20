import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHATWOOT_BUBBLE_CLEARANCE_PROPERTY,
  useChatwootLauncherClearance,
} from './use-chatwoot-launcher-clearance';

const clearance = () =>
  document.documentElement.style.getPropertyValue(
    CHATWOOT_BUBBLE_CLEARANCE_PROPERTY
  );

type Rect = { top: number; width: number; height: number };

describe('useChatwootLauncherClearance', () => {
  let bar: HTMLDivElement;
  let rect: Rect;
  let frames: FrameRequestCallback[];
  let notifyResize: () => void;
  let observer: {
    observe: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  };

  const flushFrames = () => {
    const pending = frames.splice(0);
    for (const callback of pending) callback(0);
  };
  const mount = () =>
    renderHook(() => useChatwootLauncherClearance({ current: bar }));

  beforeEach(() => {
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 812,
    });
    frames = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
      frames = [];
    });
    observer = { observe: vi.fn(), disconnect: vi.fn() };
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          notifyResize = callback;
        }
        observe = observer.observe;
        disconnect = observer.disconnect;
      }
    );
    // A bar 176px tall measured from the bottom: fixed bottom-24 plus its own height.
    rect = { top: 636, width: 375, height: 80 };
    bar = document.createElement('div');
    bar.getBoundingClientRect = () => ({ ...rect }) as DOMRect;
    document.body.append(bar);
  });

  afterEach(() => {
    bar.remove();
    document.documentElement.style.removeProperty(
      CHATWOOT_BUBBLE_CLEARANCE_PROPERTY
    );
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lifts the launcher to just above the bar it measured', () => {
    mount();

    // 812 - 636 = 176 from the bottom, +8 of air, minus the SDK's own 20.
    expect(clearance()).toBe('164px');
  });

  it('publishes nothing while the bar is hidden (desktop layout)', () => {
    rect = { top: 0, width: 0, height: 0 };
    mount();

    expect(clearance()).toBe('');
  });

  it('never publishes a negative clearance', () => {
    rect = { top: 900, width: 375, height: 80 };
    mount();

    expect(clearance()).toBe('0px');
  });

  it('follows the bar when it resizes, in one frame', () => {
    mount();
    rect = { top: 600, width: 375, height: 116 };
    notifyResize();
    notifyResize();
    window.dispatchEvent(new Event('resize'));

    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
    flushFrames();
    expect(clearance()).toBe('200px');
  });

  it('drops the clearance when the bar becomes hidden', () => {
    mount();
    rect = { top: 0, width: 0, height: 0 };
    window.dispatchEvent(new Event('resize'));
    flushFrames();

    expect(clearance()).toBe('');
  });

  it('cleans up everything on unmount', () => {
    const { unmount } = mount();
    unmount();

    expect(clearance()).toBe('');
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('resize'));
    expect(frames).toHaveLength(0);
  });

  it('still works in browsers without ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    mount();

    expect(clearance()).toBe('164px');
  });

  it('does nothing without a bar element', () => {
    renderHook(() => useChatwootLauncherClearance({ current: null }));

    expect(clearance()).toBe('');
  });
});
