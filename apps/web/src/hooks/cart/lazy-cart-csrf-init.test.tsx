import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeCustomerSessionHint } from '@/contexts/customer-session-hint';
import { useCart } from './cart-context';
import {
  clearCartDeviceSessionActive,
  markCartDeviceSessionActive,
} from './cart-device-session-markers';
import { readCartSessionHint, writeCartSessionHint } from './cart-session-hint';
import {
  clearAllCookies,
  createWrapper,
  MERCHANT_A_ID,
  MERCHANT_A_SLUG,
  MERCHANT_B_ID,
  MERCHANT_B_SLUG,
  makeProduct,
  makeSnapshot,
  stubNavigatorLocks,
} from './lazy-cart-csrf-init.test-support';

describe('Lazy storefront cart & CSRF initialization', () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearAllCookies();
    vi.clearAllMocks();
    stubNavigatorLocks();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    clearAllCookies();
    clearCartDeviceSessionActive(MERCHANT_A_SLUG);
    clearCartDeviceSessionActive(MERCHANT_B_SLUG);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('(a) anonymous cold visit makes 0 /api/storefront/cart and 0 /api/csrf requests on mount', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useCart(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });

    expect(result.current.isHydrated).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readCartSessionHint(MERCHANT_A_ID)).toBe('0');

    // Tab focus / visibilitychange on cold visit also makes 0 requests.
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('(b) visitor with active cart hint hydrates cart properly on mount', async () => {
    writeCartSessionHint(MERCHANT_A_ID, '1');
    const snapshot = makeSnapshot();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith('/api/storefront/cart')) {
        return new Response(JSON.stringify({ cart: snapshot, warnings: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify([makeProduct()]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useCart(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.cartCount).toBe(1));
    await waitFor(() => expect(result.current.cart[0]?.name).toBe('Phone'));
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).startsWith('/api/storefront/cart')
      )
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(([url]) => String(url) === '/api/csrf')
    ).toBe(false);
    expect(readCartSessionHint(MERCHANT_A_ID)).toBe('1');
  });

  it('(b2) authenticated customer hint probes once and stamps 0 when empty, preserving isolation across merchants', async () => {
    writeCartSessionHint(MERCHANT_A_ID, '1');
    writeCustomerSessionHint(MERCHANT_B_SLUG, '1');

    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useCart(), {
      wrapper: createWrapper(MERCHANT_B_ID, MERCHANT_B_SLUG),
    });

    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    await waitFor(() => expect(readCartSessionHint(MERCHANT_B_ID)).toBe('0'));
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      `/api/storefront/cart?merchantSlug=${MERCHANT_B_SLUG}`,
    ]);
    expect(readCartSessionHint(MERCHANT_A_ID)).toBe('1');
  });

  it('(b3) legacy device session marker without hint probes once and stamps 0 when empty', async () => {
    markCartDeviceSessionActive(MERCHANT_B_SLUG);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useCart(), {
      wrapper: createWrapper(MERCHANT_B_ID, MERCHANT_B_SLUG),
    });

    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    await waitFor(() => expect(readCartSessionHint(MERCHANT_B_ID)).toBe('0'));
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      `/api/storefront/cart?merchantSlug=${MERCHANT_B_SLUG}`,
    ]);
  });

  it('(b4) guest with cartHint 0 who signs in (customerSessionHint=1) still hydrates server cart and flips cartHint to 1', async () => {
    writeCartSessionHint(MERCHANT_A_ID, '0');
    writeCustomerSessionHint(MERCHANT_A_SLUG, '1');
    const snapshot = makeSnapshot();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith('/api/storefront/cart')) {
        return new Response(JSON.stringify({ cart: snapshot, warnings: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify([makeProduct()]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useCart(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.cartCount).toBe(1));
    await waitFor(() => expect(result.current.cart[0]?.name).toBe('Phone'));
    expect(readCartSessionHint(MERCHANT_A_ID)).toBe('1');
  });

  it('(b5) focus refresh recovers server cart when customerSessionHint flips to 1 after cold guest mount', async () => {
    const snapshot = makeSnapshot();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith('/api/storefront/cart')) {
        return new Response(JSON.stringify({ cart: snapshot, warnings: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify([makeProduct()]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useCart(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readCartSessionHint(MERCHANT_A_ID)).toBe('0');

    writeCustomerSessionHint(MERCHANT_A_SLUG, '1');
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(result.current.cartCount).toBe(1));
    await waitFor(() => expect(result.current.cart[0]?.name).toBe('Phone'));
    expect(readCartSessionHint(MERCHANT_A_ID)).toBe('1');
  });

  it('(c) first mutation lazily acquires CSRF token and flips cart hint to 1, and clear flips back to 0', async () => {
    const createdSnapshot = makeSnapshot({ version: 1 });
    const updatedSnapshot = makeSnapshot({ version: 2 });
    const clearedSnapshot = makeSnapshot({ lines: [], version: 3 });

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url === '/api/csrf') {
          document.cookie = 'csrf-token=lazy-csrf-token; Path=/';
          return new Response(
            JSON.stringify({ csrfToken: 'lazy-csrf-token' }),
            {
              status: 200,
            }
          );
        }
        if (url.startsWith('/api/storefront/cart/bootstrap')) {
          expect(new Headers(init?.headers).get('x-csrf-token')).toBe(
            'lazy-csrf-token'
          );
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        if (
          url.startsWith('/api/storefront/cart/commands') &&
          init?.method === 'POST'
        ) {
          const body = JSON.parse(String(init.body));
          const cart =
            body.command?.type === 'clear' ? clearedSnapshot : updatedSnapshot;
          return new Response(
            JSON.stringify({
              cart,
              operationId: body.operationId,
              replayed: false,
            }),
            { status: 200 }
          );
        }
        if (url.startsWith('/api/storefront/cart') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({ cart: createdSnapshot, replayed: false }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify([makeProduct()]), {
          status: 200,
        });
      }
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useCart(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readCartSessionHint(MERCHANT_A_ID)).toBe('0');

    act(() => {
      result.current.addToCart(makeProduct(), 1);
    });

    await waitFor(() => expect(readCartSessionHint(MERCHANT_A_ID)).toBe('1'));
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === '/api/csrf')
    ).toHaveLength(1);

    act(() => {
      result.current.clearCart();
    });

    await waitFor(() => expect(readCartSessionHint(MERCHANT_A_ID)).toBe('0'));
  });
});
