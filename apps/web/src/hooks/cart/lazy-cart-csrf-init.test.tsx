import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetCustomerSessionHintForTests,
  writeCustomerSessionHint,
} from '@/contexts/customer-session-hint';
import type { Product } from '@/lib/products';
import { useCart } from './cart-context';
import {
  clearCartDeviceSessionActive,
  markCartDeviceSessionActive,
} from './cart-device-session-markers';
import {
  readCartSessionHint,
  resetCartSessionHintForTests,
  writeCartSessionHint,
} from './cart-session-hint';
import { StorefrontCartProvider } from './storefront-cart-provider';

const MERCHANT_A_ID = '11111111-1111-4111-8111-111111111111';
const MERCHANT_A_SLUG = 'store-a';
const MERCHANT_B_ID = '22222222-2222-4222-8222-222222222222';
const MERCHANT_B_SLUG = 'store-b';
const CART_ID = '33333333-3333-4333-8333-333333333333';

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    brand: 'Brand',
    description: '',
    gtin: '',
    id: 'prod-1',
    image: '/prod-1.png',
    imageHint: 'product',
    imageLarge: '/prod-1-large.png',
    manage_stock: false,
    merchant_id: MERCHANT_A_ID,
    mpn: '',
    name: 'Phone',
    price: 100,
    slug: 'phone',
    status: 'active',
    stock: 10,
    ...overrides,
  } as Product;
}

function makeSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    cartId: CART_ID,
    currency: 'NGN',
    estimatedTotals: false,
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    lines: [
      {
        id: 'line-1',
        item: { productId: 'prod-1' },
        lineTotalMinor: 10000,
        quantity: 1,
        unitPriceMinor: 10000,
      },
    ],
    merchantId: MERCHANT_A_ID,
    state: 'active',
    subtotalMinor: 10000,
    totalMinor: 10000,
    version: 1,
    ...overrides,
  };
}

function clearAllCookies() {
  document.cookie = 'csrf-token=; Path=/; Max-Age=0';
  document.cookie = '__Host-csrf-token=; Path=/; Max-Age=0';
  resetCartSessionHintForTests();
  resetCustomerSessionHintForTests();
}

function createWrapper(
  merchantId = MERCHANT_A_ID,
  merchantSlug = MERCHANT_A_SLUG
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StorefrontCartProvider
        merchantId={merchantId}
        merchantSlug={merchantSlug}
        sharedCartEnabled={true}
      >
        {children}
      </StorefrontCartProvider>
    );
  };
}

describe('Lazy storefront cart & CSRF initialization', () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearAllCookies();
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: async (
          _name: string,
          optionsOrCb: unknown,
          maybeCb?: (lock: unknown) => Promise<unknown>
        ) => {
          const cb = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb;
          return (cb as (lock: unknown) => Promise<unknown>)({});
        },
      },
    });
  });

  afterEach(() => {
    clearAllCookies();
    clearCartDeviceSessionActive(MERCHANT_A_SLUG);
    clearCartDeviceSessionActive(MERCHANT_B_SLUG);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('(a) anonymous cold visit makes 0 /api/storefront/cart and 0 /api/csrf requests on mount', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useCart(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(readCartSessionHint(MERCHANT_A_ID)).toBe('0');

    // Tab focus / visibilitychange on cold visit also makes 0 requests.
    window.dispatchEvent(new Event('focus'));
    await new Promise((resolve) => setTimeout(resolve, 20));
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
      return new Response(JSON.stringify({ products: [makeProduct()] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useCart(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.cartCount).toBe(1));
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
    // Merchant A has an active hint, Merchant B does not.
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      `merchantSlug=${MERCHANT_B_SLUG}`
    );
    // Merchant A's hint remains untouched.
    expect(readCartSessionHint(MERCHANT_A_ID)).toBe('1');
  });

  it('(b3) legacy device session marker without hint probes once and stamps 0 when empty', async () => {
    markCartDeviceSessionActive(MERCHANT_B_SLUG);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useCart(), {
      wrapper: createWrapper(MERCHANT_B_ID, MERCHANT_B_SLUG),
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(readCartSessionHint(MERCHANT_B_ID)).toBe('0');
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
      return new Response(JSON.stringify({ products: [makeProduct()] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useCart(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.cartCount).toBe(1));
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
        return new Response(JSON.stringify({ products: [makeProduct()] }), {
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

    // First mutation: addToCart lazily fetches /api/csrf and creates cart.
    act(() => {
      result.current.addToCart(makeProduct(), 1);
    });

    await waitFor(() => expect(readCartSessionHint(MERCHANT_A_ID)).toBe('1'));
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === '/api/csrf')
    ).toHaveLength(1);

    // Clear cart flips hint back to '0'.
    act(() => {
      result.current.clearCart();
    });

    await waitFor(() => expect(readCartSessionHint(MERCHANT_A_ID)).toBe('0'));
  });
});
