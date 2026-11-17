import { renderHook } from '@testing-library/react';
import { useInsertionEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stashPrivateParamsForNavigation } from '@/lib/privacy/private-url-param-handoff';
import { currentPrivateParamsId } from '@/lib/privacy/private-url-param-stash';
import { usePrivateSearchParams } from './use-private-search-params';

const nav = vi.hoisted(() => ({ pathname: '/', search: '' }));

// What Next.js reports for the page being rendered, which for a navigation is
// the destination while window.location still shows the page it came from.
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const TARGET = '/shop/order-success?orderId=1&trackingToken=tok&email=a%40b.c';

function visit(url: string) {
  window.history.replaceState(null, '', url);
}

function navigateTo(pathname: string, search: string) {
  nav.pathname = pathname;
  nav.search = search;
}

beforeEach(() => {
  window.sessionStorage.clear();
  visit('/shop/checkout/bnpl?orderId=1');
});

afterEach(() => {
  vi.restoreAllMocks();
  visit('/');
});

describe('arrival through an off-URL hand-off', () => {
  it('returns the handed-over values on the very first render, before Next.js writes the history entry', () => {
    const cleaned = stashPrivateParamsForNavigation(TARGET);
    expect(cleaned).toBe('/shop/order-success?orderId=1');
    navigateTo('/shop/order-success', 'orderId=1');
    const seen: (string | null)[] = [];
    const entryExistsAtRender: boolean[] = [];

    renderHook(() => {
      const params = usePrivateSearchParams();
      seen.push(params.get('trackingToken'));
      entryExistsAtRender.push(
        window.location.pathname === '/shop/order-success'
      );
      // Next.js writes the new entry in an insertion effect, after the render.
      useInsertionEffect(() => {
        window.history.pushState({}, '', cleaned);
      });
      return params;
    });

    expect(entryExistsAtRender[0]).toBe(false);
    expect(seen[0]).toBe('tok');
    expect(seen.every((token) => token === 'tok')).toBe(true);
  });

  it('claims the hand-off for the new entry so a reload keeps the values', () => {
    const cleaned = stashPrivateParamsForNavigation(TARGET);
    navigateTo('/shop/order-success', 'orderId=1');
    const first = renderHook(() => {
      useInsertionEffect(() => {
        window.history.pushState({}, '', cleaned);
      });
      return usePrivateSearchParams();
    });

    expect(currentPrivateParamsId()).not.toBeNull();
    expect(window.location.href).not.toContain('tok');
    expect(
      window.sessionStorage.getItem('baci:private-url-params-pending')
    ).toBeNull();
    first.unmount();

    // Reload: same entry, no hand-off left, values come from the entry's stash.
    const reloaded = renderHook(() => usePrivateSearchParams());

    expect(reloaded.result.current.get('trackingToken')).toBe('tok');
    expect(reloaded.result.current.get('email')).toBe('a@b.c');
  });

  it('never gives the hand-off to another path or query', () => {
    stashPrivateParamsForNavigation(TARGET);

    navigateTo('/shop/track-order', 'orderId=1');
    expect(
      renderHook(() => usePrivateSearchParams()).result.current.get(
        'trackingToken'
      )
    ).toBeNull();

    navigateTo('/shop/order-success', 'orderId=2');
    expect(
      renderHook(() => usePrivateSearchParams()).result.current.get(
        'trackingToken'
      )
    ).toBeNull();
  });

  it('is consumed once: a later entry at the same URL does not inherit the values', () => {
    const cleaned = stashPrivateParamsForNavigation(TARGET);
    navigateTo('/shop/order-success', 'orderId=1');
    const { result, rerender } = renderHook(() => {
      useInsertionEffect(() => {
        if (window.location.pathname !== '/shop/order-success') {
          window.history.pushState({}, '', cleaned);
        }
      });
      return usePrivateSearchParams();
    });
    expect(result.current.get('trackingToken')).toBe('tok');

    window.history.pushState({}, '', '/shop/order-success?orderId=1');
    rerender();

    expect(result.current.get('trackingToken')).toBeNull();
  });
});
