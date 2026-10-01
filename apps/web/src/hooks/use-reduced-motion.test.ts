import { act, renderHook } from '@testing-library/react';
import { createElement } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useReducedMotion } from './use-reduced-motion';

describe('useReducedMotion', () => {
  let listeners: Map<string, (e: MediaQueryListEvent) => void>;
  let matchesValue: boolean;

  beforeEach(() => {
    listeners = new Map();
    matchesValue = false;

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: matchesValue,
        addEventListener: vi.fn(
          (_event: string, handler: (e: MediaQueryListEvent) => void) => {
            listeners.set('change', handler);
          }
        ),
        removeEventListener: vi.fn((_event: string) => {
          listeners.delete('change');
        }),
      })),
    });
  });

  it('returns false when user does not prefer reduced motion', () => {
    matchesValue = false;
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it('returns true when user prefers reduced motion', () => {
    matchesValue = true;
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it('updates when media query changes', () => {
    matchesValue = false;
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);

    matchesValue = true;
    const handler = listeners.get('change');
    if (handler) {
      act(() => {
        handler({ matches: true } as MediaQueryListEvent);
      });
    }
    expect(result.current).toBe(true);
  });

  it('keeps the server snapshot through hydration for reduced-motion clients', async () => {
    matchesValue = true;

    function Probe() {
      return createElement(
        'span',
        null,
        useReducedMotion() ? 'reduced' : 'full'
      );
    }

    const originalWindow = globalThis.window;
    vi.stubGlobal('window', undefined);
    let serverMarkup: string;
    try {
      serverMarkup = renderToString(createElement(Probe));
    } finally {
      vi.stubGlobal('window', originalWindow);
    }

    const container = document.createElement('div');
    container.innerHTML = serverMarkup;
    document.body.appendChild(container);
    const recoverableErrors: unknown[] = [];

    const root = hydrateRoot(container, createElement(Probe), {
      onRecoverableError: (error) => recoverableErrors.push(error),
    });

    try {
      await act(async () => {
        await Promise.resolve();
      });

      expect(recoverableErrors).toHaveLength(0);
      expect(container.textContent).toBe('reduced');
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });
});
