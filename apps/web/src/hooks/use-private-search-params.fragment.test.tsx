import { act, renderHook } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePrivateSearchParams } from './use-private-search-params';

const nav = vi.hoisted(() => ({ listeners: new Set<() => void>() }));

// Stand-in for Next.js, which re-renders useSearchParams when the page calls
// history.replaceState or pushState.
vi.mock('next/navigation', () => {
  const subscribe = (listener: () => void) => {
    nav.listeners.add(listener);
    return () => nav.listeners.delete(listener);
  };
  return {
    usePathname: () =>
      useSyncExternalStore(
        subscribe,
        () => window.location.pathname,
        () => '/'
      ),
    useSearchParams: () =>
      new URLSearchParams(
        useSyncExternalStore(
          subscribe,
          () => window.location.search,
          () => ''
        )
      ),
  };
});

const originalPushState = window.history.pushState.bind(window.history);
const originalReplaceState = window.history.replaceState.bind(window.history);

function visit(url: string) {
  originalReplaceState(null, '', url);
}

/** A browser fragment-link click: a new entry with no state, then the events. */
function clickFragmentLink(url: string) {
  originalPushState(null, '', url);
  act(() => {
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

function notifyNext() {
  for (const listener of nav.listeners) listener();
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState = (...args) => {
    originalReplaceState(...args);
    notifyNext();
  };
  window.history.pushState = (...args) => {
    originalPushState(...args);
    notifyNext();
  };
});

afterEach(() => {
  window.history.replaceState = originalReplaceState;
  window.history.pushState = originalPushState;
  vi.restoreAllMocks();
  visit('/');
});

describe('bugfix: a fragment link dropped the stashed order token', () => {
  it('keeps the values after a same-document fragment navigation, and after a reload of it', () => {
    visit('/track-order?token=A');
    const first = renderHook(() => usePrivateSearchParams());
    expect(window.location.search).toBe('');
    expect(first.result.current.get('token')).toBe('A');

    // "Skip to main content": a new history entry, same path and query.
    clickFragmentLink('/track-order#main');

    expect(first.result.current.get('token')).toBe('A');
    first.unmount();
    const reloaded = renderHook(() => usePrivateSearchParams());
    expect(reloaded.result.current.get('token')).toBe('A');
  });

  it('does not hand the values to a same-URL entry that then gets a fragment', () => {
    visit('/track-order?token=A');
    const { result, rerender } = renderHook(() => usePrivateSearchParams());
    expect(result.current.get('token')).toBe('A');

    // A new entry at the same URL (no stash id), then a fragment on top of it.
    act(() => {
      window.history.pushState({}, '', '/track-order');
    });
    rerender();
    expect(result.current.get('token')).toBeNull();
    clickFragmentLink('/track-order#main');

    expect(result.current.get('token')).toBeNull();
  });

  it('does not hand the values to an entry at a different query', () => {
    visit('/track-order?token=A');
    const { result } = renderHook(() => usePrivateSearchParams());
    expect(result.current.get('token')).toBe('A');

    clickFragmentLink('/track-order?orderId=2#main');

    expect(result.current.get('token')).toBeNull();
  });
});
