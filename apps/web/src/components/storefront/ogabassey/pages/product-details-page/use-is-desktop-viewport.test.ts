import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useIsDesktopViewport } from './use-is-desktop-viewport';

function createMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>();
  const mediaQuery = {
    matches,
    media: '(min-width: 768px)',
    addEventListener: vi.fn((_event: string, listener: () => void) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_event: string, listener: () => void) => {
      listeners.delete(listener);
    }),
    addListener: vi.fn((listener: () => void) => {
      listeners.add(listener);
    }),
    removeListener: vi.fn((listener: () => void) => {
      listeners.delete(listener);
    }),
    dispatchEvent: vi.fn(),
  };

  return {
    mediaQuery,
    setMatches(nextMatches: boolean) {
      mediaQuery.matches = nextMatches;
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

describe('useIsDesktopViewport', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('syncs the initial viewport state from matchMedia', () => {
    const { mediaQuery } = createMatchMedia(true);
    vi.stubGlobal('matchMedia', vi.fn(() => mediaQuery));

    const { result } = renderHook(() => useIsDesktopViewport());

    expect(result.current).toBe(true);
  });

  it('updates when the media query changes', () => {
    const { mediaQuery, setMatches } = createMatchMedia(false);
    vi.stubGlobal('matchMedia', vi.fn(() => mediaQuery));

    const { result } = renderHook(() => useIsDesktopViewport());

    expect(result.current).toBe(false);

    act(() => {
      setMatches(true);
    });

    expect(result.current).toBe(true);
  });

  it('removes the media query listener on unmount', () => {
    const { mediaQuery } = createMatchMedia(true);
    vi.stubGlobal('matchMedia', vi.fn(() => mediaQuery));

    const { unmount } = renderHook(() => useIsDesktopViewport());

    unmount();

    expect(mediaQuery.removeEventListener).toHaveBeenCalled();
  });

  it('uses the legacy MediaQueryList listener APIs when addEventListener is unavailable', () => {
    const { mediaQuery } = createMatchMedia(true);
    Object.defineProperty(mediaQuery, 'addEventListener', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(mediaQuery, 'removeEventListener', {
      configurable: true,
      value: undefined,
    });
    vi.stubGlobal('matchMedia', vi.fn(() => mediaQuery));

    const { unmount } = renderHook(() => useIsDesktopViewport());

    expect(mediaQuery.addListener).toHaveBeenCalledTimes(1);
    const handler = vi.mocked(mediaQuery.addListener).mock.calls[0]?.[0];
    expect(typeof handler).toBe('function');

    unmount();

    expect(mediaQuery.removeListener).toHaveBeenCalledWith(handler);
  });
});
