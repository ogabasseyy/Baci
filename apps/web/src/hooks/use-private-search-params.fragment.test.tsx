import { act, renderHook } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stashPrivateParamsForNavigation } from '@/lib/privacy/private-url-param-handoff';
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

/** A real session-history traversal; resolves once the browser fired popstate. */
async function traverse(direction: 'back' | 'forward') {
  await act(async () => {
    const popped = new Promise((resolve) =>
      window.addEventListener('popstate', resolve, { once: true })
    );
    window.history[direction]();
    await popped;
  });
}

function notifyNext() {
  for (const listener of nav.listeners) listener();
}

// Next.js re-renders its hooks when the session history moves.
window.addEventListener('popstate', notifyNext);

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

  it('keeps working when going Back and Forward between the owner entry and its fragment entry', async () => {
    visit('/track-order?token=A');
    const { result } = renderHook(() => usePrivateSearchParams());
    clickFragmentLink('/track-order#main');
    expect(result.current.get('token')).toBe('A');

    await traverse('back');
    expect(result.current.get('token')).toBe('A');
    await traverse('forward');
    expect(result.current.get('token')).toBe('A');
  });
});

describe('bugfix: Back to a tokenless entry inherited the next order token', () => {
  async function openTokenlessThenOrderThenBack() {
    // Tokenless manual-lookup entry, with the hook mounted on it.
    visit('/track-order#main');
    const first = renderHook(() => usePrivateSearchParams());
    expect(first.result.current.get('token')).toBeNull();

    // Open an order link in the same tab: Next pushes a new entry, scrubbed.
    act(() => {
      window.history.pushState({}, '', '/track-order?token=A');
    });
    first.rerender();
    expect(first.result.current.get('token')).toBe('A');
    expect(window.location.href).not.toContain('token');

    await traverse('back');
    return first;
  }

  it('does not give the token to the earlier tokenless entry, also after a reload', async () => {
    const first = await openTokenlessThenOrderThenBack();

    expect(window.location.hash).toBe('#main');
    expect(first.result.current.get('token')).toBeNull();
    first.unmount();
    const reloaded = renderHook(() => usePrivateSearchParams());
    expect(reloaded.result.current.get('token')).toBeNull();
  });

  it('still gives the token back to its own entry when going Forward', async () => {
    const first = await openTokenlessThenOrderThenBack();

    await traverse('forward');

    expect(first.result.current.get('token')).toBe('A');
  });
});

describe('bugfix: Back to an order entry while another order hand-off was pending', () => {
  it("returns that entry's own token, not the pending one", async () => {
    visit('/shop/track-order?token=A');
    const { result, rerender } = renderHook(() => usePrivateSearchParams());
    expect(result.current.get('token')).toBe('A');
    expect(window.location.search).toBe('');

    // Leave for another page, which starts a hand-off to the same clean URL
    // for order B (the navigation is still pending) ...
    act(() => {
      window.history.pushState({}, '', '/shop/cart');
    });
    rerender();
    stashPrivateParamsForNavigation('/shop/track-order?token=B', 'shop');

    // ... and the shopper goes Back to order A's entry instead.
    await traverse('back');

    expect(result.current.get('token')).toBe('A');
  });
});

describe('bugfix: Back with no hook mounted left another order hand-off pending', () => {
  it("returns the entry's own token when the hook mounts on it after the Back", async () => {
    visit('/shop/track-order?token=A');
    const first = renderHook(() => usePrivateSearchParams());
    expect(first.result.current.get('token')).toBe('A');
    first.unmount(); // the shopper is now on a page without the hook

    originalPushState({}, '', '/shop/cart');
    stashPrivateParamsForNavigation('/shop/track-order?token=B', 'shop');
    await traverse('back'); // no hook instance is listening

    const second = renderHook(() => usePrivateSearchParams());
    expect(second.result.current.get('token')).toBe('A');
  });
});
