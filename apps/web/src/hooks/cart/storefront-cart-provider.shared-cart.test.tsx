import type { CartLine, CartSnapshot } from '@baci/shared/cart';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '@/lib/products';
import { useCart } from './cart-context';
import { clearCartStorage } from './cart-persistence';
import {
  bootstrapSharedCart,
  createSharedCart,
  fetchSharedCartProducts,
  fetchSharedCartSnapshot,
  sendSharedCartCommand,
} from './shared-cart-client';
import { StorefrontCartProvider } from './storefront-cart-provider';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: vi.fn((url: RequestInfo | URL, options?: RequestInit) =>
    globalThis.fetch(url, options)
  ),
}));

vi.mock('./shared-cart-client', () => ({
  bootstrapSharedCart: vi.fn(),
  createSharedCart: vi.fn(),
  fetchSharedCartProducts: vi.fn(),
  fetchSharedCartSnapshot: vi.fn(),
  sendSharedCartCommand: vi.fn(),
}));

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });
global.fetch = vi.fn();

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';
const SLUG = 'ogabassey';
const CART_ID = '22222222-2222-4222-8222-222222222222';

function product(overrides: Record<string, unknown> = {}): Product {
  return {
    brand: 'Brand',
    description: '',
    gtin: '',
    id: 'prod-1',
    image: '/prod-1.png',
    imageHint: 'product',
    imageLarge: '/prod-1-large.png',
    manage_stock: false,
    merchant_id: MERCHANT_ID,
    mpn: '',
    name: 'Phone',
    price: 100,
    slug: 'phone',
    status: 'active',
    stock: 10,
    ...overrides,
  } as Product;
}

function cartLine(overrides: Record<string, unknown> = {}): CartLine {
  return {
    id: 'line-1',
    item: { productId: 'prod-1' },
    lineTotalMinor: 10000,
    quantity: 1,
    unitPriceMinor: 10000,
    ...overrides,
  } as CartLine;
}

function snapshot(overrides: Record<string, unknown> = {}): CartSnapshot {
  const lines = (overrides.lines as CartLine[] | undefined) ?? [cartLine()];
  const subtotalMinor = lines.reduce(
    (sum, line) => sum + line.lineTotalMinor,
    0
  );
  return {
    cartId: CART_ID,
    currency: 'NGN',
    estimatedTotals: false,
    expiresAt: '2026-10-19T04:00:00.000Z',
    lines,
    merchantId: MERCHANT_ID,
    state: 'active',
    subtotalMinor,
    totalMinor: subtotalMinor,
    version: 3,
    ...overrides,
  } as CartSnapshot;
}

function mockAdopted(lines: CartLine[] = [cartLine()], version = 3) {
  vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
    ok: true,
    snapshot: snapshot({ lines, version }),
    warnings: [],
  });
}

function delegatedWrapper(extra: Record<string, unknown> = {}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StorefrontCartProvider
        enableSmartCartPro
        merchantId={MERCHANT_ID}
        merchantSlug={SLUG}
        sharedCartEnabled
        {...extra}
      >
        {children}
      </StorefrontCartProvider>
    );
  };
}

function validateCalls(): string[] {
  return vi
    .mocked(global.fetch)
    .mock.calls.map(([url]) => String(url))
    .filter((url) => url.includes('/api/cart/validate'));
}

describe('StorefrontCartProvider shared-cart delegation', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    vi.mocked(fetchSharedCartProducts).mockResolvedValue(new Map());
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 })
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps legacy carts fully local without enrollment', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StorefrontCartProvider merchantSlug={SLUG}>
        {children}
      </StorefrontCartProvider>
    );
    const { result } = renderHook(() => useCart(), { wrapper });
    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    act(() => {
      result.current.addToCart(product(), 1);
    });

    expect(result.current.cart.map((line) => line.id)).toEqual(['prod-1']);
    expect(result.current.sharedCartEnabled).not.toBe(true);
    expect(fetchSharedCartSnapshot).not.toHaveBeenCalled();
    expect(sendSharedCartCommand).not.toHaveBeenCalled();
    expect(bootstrapSharedCart).not.toHaveBeenCalled();
    expect(createSharedCart).not.toHaveBeenCalled();
  });

  it('stays legacy when the enrollment flag is missing', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StorefrontCartProvider merchantId={MERCHANT_ID} merchantSlug={SLUG}>
        {children}
      </StorefrontCartProvider>
    );
    const { result } = renderHook(() => useCart(), { wrapper });
    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    act(() => {
      result.current.addToCart(product(), 1);
    });

    expect(result.current.cart).toHaveLength(1);
    expect(result.current.sharedCartEnabled).not.toBe(true);
    expect(fetchSharedCartSnapshot).not.toHaveBeenCalled();
  });

  it('adopts the server snapshot for enrolled merchants', async () => {
    mockAdopted();
    vi.mocked(fetchSharedCartProducts).mockResolvedValue(
      new Map([['prod-1', product()]])
    );
    const { result } = renderHook(() => useCart(), {
      wrapper: delegatedWrapper(),
    });

    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    // Hydration flips on the cache seed; the adopted snapshot lands after.
    await waitFor(() => expect(result.current.cart).toHaveLength(1));

    expect(result.current.sharedCartEnabled).toBe(true);
    expect(result.current.syncStatus).toBe('synced');
    expect(result.current.cart.map((line) => line.id)).toEqual(['prod-1']);
    expect(result.current.cart[0]?.name).toBe('Phone');
    expect(result.current.cartCount).toBe(1);
    expect(result.current.cartTotal).toBe(100);
  });

  it('restarts delegated adoption after an external session clear', async () => {
    mockAdopted();
    const { result } = renderHook(() => useCart(), {
      wrapper: delegatedWrapper(),
    });
    await waitFor(() => expect(result.current.sharedCartRef).not.toBeNull());
    const reads = vi.mocked(fetchSharedCartSnapshot).mock.calls.length;
    vi.mocked(fetchSharedCartSnapshot).mockResolvedValue({
      ok: false,
      code: 'not_found',
      retryable: false,
      snapshot: null,
    });
    act(() => clearCartStorage(SLUG));
    await waitFor(() =>
      expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(reads + 1)
    );
    await waitFor(() => expect(result.current.sharedCartRef).toBeNull());
  });

  it('exposes the shared cart ref and refresh for checkout binding', async () => {
    mockAdopted();
    vi.mocked(fetchSharedCartProducts).mockResolvedValue(
      new Map([['prod-1', product()]])
    );
    const { result } = renderHook(() => useCart(), {
      wrapper: delegatedWrapper(),
    });

    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    await waitFor(() => expect(result.current.cart).toHaveLength(1));

    expect(result.current.sharedCartRef).toEqual({
      cartId: CART_ID,
      version: 3,
    });
    expect(typeof result.current.refreshSharedCart).toBe('function');
  });

  it('leaves the shared cart ref empty in legacy mode', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StorefrontCartProvider merchantId={MERCHANT_ID} merchantSlug={SLUG}>
        {children}
      </StorefrontCartProvider>
    );
    const { result } = renderHook(() => useCart(), { wrapper });
    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    expect(result.current.sharedCartEnabled).not.toBe(true);
    expect(result.current.sharedCartRef ?? null).toBeNull();
  });

  it('sends versioned commands for delegated actions', async () => {
    mockAdopted([], 3);
    vi.mocked(sendSharedCartCommand).mockResolvedValue({
      ok: true,
      replayed: false,
      snapshot: snapshot({ lines: [cartLine()], version: 4 }),
      warnings: [],
    });
    const { result } = renderHook(() => useCart(), {
      wrapper: delegatedWrapper(),
    });
    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    act(() => {
      result.current.addToCart(product({ id: 'prod-1' }), 1);
    });

    // Optimistic feedback lands before the round trip.
    expect(result.current.cart.map((line) => line.id)).toEqual(['prod-1']);
    await waitFor(() => expect(sendSharedCartCommand).toHaveBeenCalledTimes(1));
    // No cartId travels: the server resolves the cart from the session proof.
    expect(vi.mocked(sendSharedCartCommand).mock.calls[0]?.[0]).toMatchObject({
      command: { item: { productId: 'prod-1' }, type: 'add' },
      expectedVersion: 3,
      operationId: expect.any(String),
    });
  });

  it('resolves default variants before delegating the add', async () => {
    mockAdopted([], 3);
    vi.mocked(sendSharedCartCommand).mockResolvedValue({
      ok: true,
      replayed: false,
      snapshot: snapshot({ lines: [], version: 4 }),
      warnings: [],
    });
    const skuMatrixProduct = product({
      has_variants: true,
      id: 'iphone-15',
      manage_stock: true,
      price: 900000,
      variants: [
        {
          attributes: {
            color: 'Black',
            sim_type: 'eSIM Only',
            storage: '128GB',
          },
          condition: 'open_box',
          id: 'iphone15-openbox-128-black-esim',
          merchant_id: MERCHANT_ID,
          price_override: 829000,
          product_id: 'iphone-15',
          stock_quantity: 3,
        },
      ],
    });
    const { result } = renderHook(() => useCart(), {
      wrapper: delegatedWrapper(),
    });
    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    act(() => {
      result.current.addToCart(skuMatrixProduct, 1);
    });

    await waitFor(() => expect(sendSharedCartCommand).toHaveBeenCalledTimes(1));
    expect(vi.mocked(sendSharedCartCommand).mock.calls[0]?.[0]).toMatchObject({
      command: {
        item: expect.objectContaining({
          variantId: 'iphone15-openbox-128-black-esim',
        }),
        type: 'add',
      },
    });
  });

  it('blocks variant products without a resolved variant in delegated mode', async () => {
    mockAdopted([], 3);
    const { result } = renderHook(() => useCart(), {
      wrapper: delegatedWrapper(),
    });
    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    act(() => {
      result.current.addToCart(product({ has_variants: true }), 1);
    });

    expect(result.current.cart).toHaveLength(0);
    expect(sendSharedCartCommand).not.toHaveBeenCalled();
  });

  it('applies per-line negotiation through server repricing', async () => {
    mockAdopted();
    vi.mocked(fetchSharedCartProducts).mockResolvedValue(
      new Map([['prod-1', product()]])
    );
    vi.mocked(sendSharedCartCommand).mockResolvedValueOnce({
      ok: true,
      replayed: false,
      snapshot: snapshot({
        lines: [
          cartLine({
            lineTotalMinor: 7500,
            negotiatedUnitPriceMinor: 7500,
            negotiationStatus: 'accepted',
          }),
        ],
        version: 4,
      }),
      warnings: [],
    });
    const { result } = renderHook(() => useCart(), {
      wrapper: delegatedWrapper(),
    });
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    await waitFor(() => expect(result.current.cart[0]?.id).toBe('prod-1'));
    // Adopted lines carry the server line ID as their cart identity.
    const cartItemId = result.current.cart[0]?.cartItemId ?? '';
    expect(cartItemId).toBe('line-1');

    act(() => {
      result.current.applyNegotiatedPrice?.(cartItemId, 75);
    });

    // One atomic in-place reprice replaces the old remove-plus-add pair.
    await waitFor(() => expect(sendSharedCartCommand).toHaveBeenCalledTimes(1));
    expect(vi.mocked(sendSharedCartCommand).mock.calls[0]?.[0]).toMatchObject({
      command: {
        lineId: 'line-1',
        negotiatedUnitPriceMinor: 7500,
        type: 'set_negotiated_price',
      },
    });
    await waitFor(() =>
      expect(result.current.cart[0]?.negotiatedPrice).toBe(75)
    );
  });

  it('applies cart-wide negotiation as proportional server reprices', async () => {
    mockAdopted(
      [
        cartLine({ id: 'line-1', lineTotalMinor: 10000 }),
        cartLine({
          id: 'line-2',
          item: { productId: 'prod-2' },
          lineTotalMinor: 30000,
          quantity: 1,
          unitPriceMinor: 30000,
        }),
      ],
      3
    );
    vi.mocked(fetchSharedCartProducts).mockResolvedValue(
      new Map([
        ['prod-1', product()],
        ['prod-2', product({ id: 'prod-2', name: 'Charger', price: 300 })],
      ])
    );
    // Stateful responses: every reconciliation keeps both lines live so the
    // later in-place reprices still resolve their line targets. A static
    // empty snapshot would strand the queue on a stale-target failure.
    const liveLines = [
      cartLine({ id: 'line-1', lineTotalMinor: 10000 }),
      cartLine({
        id: 'line-2',
        item: { productId: 'prod-2' },
        lineTotalMinor: 30000,
        quantity: 1,
        unitPriceMinor: 30000,
      }),
    ];
    let version = 3;
    vi.mocked(sendSharedCartCommand).mockImplementation(async () => {
      version += 1;
      return {
        ok: true,
        replayed: false,
        snapshot: snapshot({ lines: liveLines, version }),
        warnings: [],
      };
    });
    const { result } = renderHook(() => useCart(), {
      wrapper: delegatedWrapper(),
    });
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    await waitFor(() => expect(result.current.cart).toHaveLength(2));

    act(() => {
      result.current.applyCartWideNegotiation?.(200);
    });

    // Two lines, one atomic in-place reprice each.
    await waitFor(() => expect(sendSharedCartCommand).toHaveBeenCalledTimes(2));
    const reprices = vi
      .mocked(sendSharedCartCommand)
      .mock.calls.map((call) => call[0]?.command)
      .filter((command) => command?.type === 'set_negotiated_price');
    expect(reprices).toHaveLength(2);
    // ₦400 of cart repriced to ₦200: each line halves.
    expect(reprices[0]).toMatchObject({ negotiatedUnitPriceMinor: 5000 });
    expect(reprices[1]).toMatchObject({ negotiatedUnitPriceMinor: 15000 });
    expect(result.current.cartWideNegotiationActive).toBe(true);
  });

  it('toggles assurance in the display and persists it while delegated', async () => {
    mockAdopted();
    vi.mocked(fetchSharedCartProducts).mockResolvedValue(
      new Map([['prod-1', product()]])
    );
    const { result } = renderHook(() => useCart(), {
      wrapper: delegatedWrapper(),
    });
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    await waitFor(() => expect(result.current.cart[0]?.id).toBe('prod-1'));
    const cartItemId = result.current.cart[0]?.cartItemId ?? '';

    act(() => {
      result.current.toggleAssurance?.(cartItemId);
    });

    expect(result.current.cart[0]?.hasAssurance).toBe(true);
    expect(sendSharedCartCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: {
          hasAssurance: true,
          lineId: 'line-1',
          type: 'set_assurance',
        },
      }),
      'ogabassey'
    );
  });

  it('keeps merchant identity on delegated clear', async () => {
    mockAdopted();
    vi.mocked(sendSharedCartCommand).mockResolvedValue({
      ok: true,
      replayed: false,
      snapshot: snapshot({ lines: [], version: 4 }),
      warnings: [],
    });
    const { result } = renderHook(() => useCart(), {
      wrapper: delegatedWrapper(),
    });
    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    act(() => {
      result.current.clearCart();
    });

    await waitFor(() => expect(sendSharedCartCommand).toHaveBeenCalledTimes(1));
    expect(vi.mocked(sendSharedCartCommand).mock.calls[0]?.[0]).toMatchObject({
      command: { type: 'clear' },
    });
    expect(result.current.merchantSlug).toBe(SLUG);
    expect(result.current.sharedCartEnabled).toBe(true);
  });

  it('fences the old merchant session when the slug switches away', async () => {
    localStorageMock.setItem(
      'baci-cart-second-guest',
      JSON.stringify([{ ...product(), id: 'second', quantity: 1 }])
    );
    mockAdopted([cartLine()], 3);
    vi.mocked(fetchSharedCartProducts).mockResolvedValue(
      new Map([['prod-1', product()]])
    );
    let resolveSend!: (
      value: Awaited<ReturnType<typeof sendSharedCartCommand>>
    ) => void;
    vi.mocked(sendSharedCartCommand).mockReturnValue(
      new Promise((resolve) => {
        resolveSend = resolve;
      })
    );
    const { result } = renderHook(() => useCart(), {
      wrapper: delegatedWrapper(),
    });
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    await waitFor(() => expect(result.current.cart).toHaveLength(1));

    // Queue a command, then switch to an unenrolled merchant before it lands.
    act(() => {
      result.current.addToCart(product({ id: 'prod-9' }), 1);
    });
    expect(sendSharedCartCommand).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.setMerchantSlug('second');
    });
    await waitFor(() => expect(result.current.merchantSlug).toBe('second'));
    expect(result.current.sharedCartEnabled).not.toBe(true);
    expect(result.current.cart.map((line) => line.id)).toEqual(['second']);

    await act(async () => {
      resolveSend({
        ok: true,
        replayed: false,
        snapshot: snapshot({
          lines: [cartLine(), cartLine({ id: 'line-9' })],
          version: 4,
        }),
        warnings: [],
      });
      await Promise.resolve();
    });

    // The late first-merchant response never touches the second cart.
    expect(result.current.cart.map((line) => line.id)).toEqual(['second']);
  });

  it('re-delegates when the slug switches back to the enrolled merchant', async () => {
    mockAdopted([cartLine()], 3);
    vi.mocked(fetchSharedCartProducts).mockResolvedValue(
      new Map([['prod-1', product()]])
    );
    const { result } = renderHook(() => useCart(), {
      wrapper: delegatedWrapper(),
    });
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    await waitFor(() => expect(result.current.cart).toHaveLength(1));
    expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.setMerchantSlug('second');
    });
    await waitFor(() => expect(result.current.merchantSlug).toBe('second'));
    expect(result.current.sharedCartEnabled).not.toBe(true);

    act(() => {
      result.current.setMerchantSlug(SLUG);
    });
    await waitFor(() => expect(result.current.sharedCartEnabled).toBe(true));
    expect(fetchSharedCartSnapshot).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.cart).toHaveLength(1));
  });

  it('validates legacy carts but never delegated carts', async () => {
    const legacyWrapper = ({ children }: { children: ReactNode }) => (
      <StorefrontCartProvider merchantSlug={SLUG}>
        {children}
      </StorefrontCartProvider>
    );
    const legacy = renderHook(() => useCart(), { wrapper: legacyWrapper });
    await waitFor(() => expect(legacy.result.current.isHydrated).toBe(true));

    vi.useFakeTimers();
    // Separate acts: the validation effect schedules its debounce only
    // after the add's render commits.
    await act(async () => {
      legacy.result.current.addToCart(product(), 1);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(validateCalls()).toHaveLength(1);
    legacy.unmount();
    vi.useRealTimers();
    vi.mocked(global.fetch).mockClear();

    mockAdopted([], 3);
    vi.mocked(sendSharedCartCommand).mockResolvedValue({
      ok: true,
      replayed: false,
      snapshot: snapshot({ lines: [], version: 4 }),
      warnings: [],
    });
    const delegated = renderHook(() => useCart(), {
      wrapper: delegatedWrapper(),
    });
    await waitFor(() => expect(delegated.result.current.isHydrated).toBe(true));

    vi.useFakeTimers();
    await act(async () => {
      delegated.result.current.addToCart(product({ id: 'prod-9' }), 1);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(validateCalls()).toHaveLength(0);
    delegated.unmount();
  });
});
