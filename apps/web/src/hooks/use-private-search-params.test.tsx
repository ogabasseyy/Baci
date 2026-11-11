import { act, renderHook, waitFor } from '@testing-library/react';
import { useEffect, useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePrivateSearchParams } from './use-private-search-params';

const nav = vi.hoisted(() => ({ listeners: new Set<() => void>() }));

// Stand-in for Next.js, which re-renders useSearchParams when the page calls
// history.replaceState.
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

window.addEventListener('popstate', () => {
  for (const listener of nav.listeners) listener();
});

const originalPushState = window.history.pushState.bind(window.history);
const originalReplaceState = window.history.replaceState.bind(window.history);

function visit(url: string) {
  originalReplaceState(null, '', url);
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState = (...args) => {
    originalReplaceState(...args);
    for (const listener of nav.listeners) listener();
  };
  window.history.pushState = (...args) => {
    originalPushState(...args);
    for (const listener of nav.listeners) listener();
  };
});

afterEach(() => {
  window.history.replaceState = originalReplaceState;
  window.history.pushState = originalPushState;
  vi.restoreAllMocks();
  visit('/');
});

describe('usePrivateSearchParams', () => {
  it('returns the token from the URL', () => {
    visit('/track-order?token=abc&orderId=1');

    const { result } = renderHook(() => usePrivateSearchParams());

    expect(result.current.get('token')).toBe('abc');
    expect(result.current.get('orderId')).toBe('1');
  });

  it('still returns the values after the address bar is cleaned', () => {
    visit('/checkout/bnpl?orderId=1&trackingToken=abc&email=a%40b.c');

    const { result } = renderHook(() => usePrivateSearchParams());

    expect(window.location.search).toBe('?orderId=1');
    expect(result.current.get('trackingToken')).toBe('abc');
    expect(result.current.get('email')).toBe('a@b.c');
    expect(result.current.get('orderId')).toBe('1');
  });

  it('keeps one object identity across the address bar rewrite', () => {
    visit('/checkout/bnpl?orderId=1&trackingToken=abc');
    const seen = new Set<URLSearchParams>();

    renderHook(() => {
      const params = usePrivateSearchParams();
      seen.add(params);
      return params;
    });

    expect(seen.size).toBe(1);
  });

  it('reads values from the stash on a reload of a cleaned address', () => {
    visit('/track-order?token=abc&orderId=1');
    renderHook(() => usePrivateSearchParams()).unmount();
    expect(window.location.search).toBe('?orderId=1');

    const { result } = renderHook(() => usePrivateSearchParams());

    expect(result.current.get('token')).toBe('abc');
    expect(result.current.get('orderId')).toBe('1');
  });

  it('does not hand a stale token to a different order on the same path', () => {
    visit('/order-success?orderId=1&trackingToken=old');
    renderHook(() => usePrivateSearchParams()).unmount();

    visit('/order-success?orderId=2');
    const { result } = renderHook(() => usePrivateSearchParams());

    expect(result.current.get('trackingToken')).toBeNull();
    expect(result.current.get('orderId')).toBe('2');
  });

  it('keeps working with the URL untouched when storage is unavailable', () => {
    visit('/track-order?token=abc');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    const { result } = renderHook(() => usePrivateSearchParams());

    expect(window.location.search).toBe('?token=abc');
    expect(result.current.get('token')).toBe('abc');
  });
});

describe('bugfix: shopper details in page links reach ad scripts', () => {
  it('keeps the order token and email out of window.location.href while the page still reads them', () => {
    visit('/checkout/bnpl?trackingToken=abc&email=a@b.c&orderId=1');

    const { result } = renderHook(() => usePrivateSearchParams());

    expect(window.location.href).not.toContain('abc');
    expect(window.location.href).not.toContain('a@b.c');
    expect(window.location.href).not.toContain('a%40b.c');
    expect(window.location.href).toContain('orderId=1');
    expect(result.current.get('trackingToken')).toBe('abc');
    expect(result.current.get('email')).toBe('a@b.c');
  });
});

describe('bugfix: reload ran consumer effects with the token and email missing', () => {
  it('returns the stashed values on the very first render of a reloaded page', () => {
    visit('/checkout/bnpl?orderId=1&trackingToken=abc&email=a%40b.c');
    renderHook(() => usePrivateSearchParams()).unmount();
    expect(window.location.search).toBe('?orderId=1'); // reload: clean address

    const renders: (string | null)[] = [];
    renderHook(() => {
      const params = usePrivateSearchParams();
      renders.push(params.get('trackingToken'));
      return params;
    });

    expect(renders.length).toBeGreaterThan(0);
    expect(renders.every((token) => token === 'abc')).toBe(true);
  });

  it('never lets an effect observe the values as missing and then present', () => {
    visit('/checkout/bnpl?orderId=1&trackingToken=abc');
    renderHook(() => usePrivateSearchParams()).unmount();
    const seenByEffects: (string | null)[] = [];

    renderHook(() => {
      const params = usePrivateSearchParams();
      useEffect(() => {
        seenByEffects.push(params.get('trackingToken'));
      }, [params]);
      return params;
    });

    expect(seenByEffects).toEqual(['abc']);
  });
});

describe('bugfix: Back to an earlier order restored the later order token', () => {
  it('returns order A token after opening A, then B, then going Back', async () => {
    visit('/track-order?token=A');
    const { result } = renderHook(() => usePrivateSearchParams());
    expect(result.current.get('token')).toBe('A');

    act(() => {
      window.history.pushState(null, '', '/track-order?token=B');
    });
    expect(result.current.get('token')).toBe('B');
    expect(window.location.search).toBe('');

    act(() => {
      window.history.back();
    });
    await waitFor(() => expect(result.current.get('token')).toBe('A'));
  });

  it('keeps the entry token across a reload of that entry', () => {
    visit('/track-order?token=A');
    renderHook(() => usePrivateSearchParams()).unmount();

    const { result } = renderHook(() => usePrivateSearchParams());

    expect(result.current.get('token')).toBe('A');
  });

  it('gives a fresh visit to the same path no token', () => {
    visit('/track-order?token=A');
    renderHook(() => usePrivateSearchParams()).unmount();

    visit('/track-order'); // state is null: a new entry

    const { result } = renderHook(() => usePrivateSearchParams());
    expect(result.current.get('token')).toBeNull();
  });
});
