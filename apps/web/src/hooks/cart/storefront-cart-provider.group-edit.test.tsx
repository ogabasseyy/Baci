import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCart } from './cart-context';
import { StorefrontCartProvider } from './storefront-cart-provider';

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: vi.fn((url: RequestInfo | URL, options?: RequestInit) =>
    globalThis.fetch(url, options)
  ),
}));

// A pool-exhausted or zero-allocation edit cannot be built through the
// public add API (the add itself rejects first), so the capped-edit
// rejection is injected here; every other cap delegates to the real
// implementation. Flag-based (not once-based) so the probe, the
// updater, and StrictMode re-runs all observe the rejection.
const mockCapsState = vi.hoisted(() => ({ forceKeepPrevious: false }));
vi.mock('./cart-stock-caps', async (importOriginal) => {
  const original = await importOriginal<typeof import('./cart-stock-caps')>();
  const capUpdatedSimpleLineQuantity = vi.fn(
    (...args: Parameters<typeof original.capUpdatedSimpleLineQuantity>) =>
      mockCapsState.forceKeepPrevious
        ? { keepPrevious: true as const }
        : original.capUpdatedSimpleLineQuantity(...args)
  );
  return { ...original, capUpdatedSimpleLineQuantity };
});

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

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

global.fetch = vi.fn();

describe('StorefrontCartProvider group-deal edits', () => {
  const mockProduct = {
    id: 'prod-1',
    merchant_id: 'merch-1',
    name: 'Test Product',
    description: '',
    status: 'active' as const,
    price: 100,
    manage_stock: true,
    stock: 10,
    image: '',
    imageLarge: '',
    imageHint: '',
    brand: 'Test Brand',
    gtin: '',
    mpn: '',
    slug: 'test-product',
    images: [],
    category_id: 'cat-1',
    sku: 'SKU-1',
  };

  const wrapper = ({ children }: { children: ReactNode }) => (
    <StorefrontCartProvider merchantSlug="ogabassey" enableSmartCartPro>
      {children}
    </StorefrontCartProvider>
  );

  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  async function renderNegotiatedCart() {
    const { result } = renderHook(() => useCart(), { wrapper });
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    act(() => {
      result.current.addToCart(mockProduct, 1);
    });
    act(() => {
      result.current.applyCartWideNegotiation?.(90);
    });
    expect(result.current.cartWideNegotiationActive).toBe(true);
    return result;
  }

  it('preserves the group deal when a capped edit is rejected', async () => {
    const result = await renderNegotiatedCart();
    const targetId = result.current.cart[0]?.cartItemId;
    expect(targetId).toBeDefined();
    mockCapsState.forceKeepPrevious = true;
    try {
      act(() => {
        result.current.updateQuantity(targetId as string, 9);
      });
    } finally {
      mockCapsState.forceKeepPrevious = false;
    }

    expect(result.current.cart[0]?.quantity).toBe(1);
    expect(result.current.cartWideNegotiationActive).toBe(true);
    expect(result.current.cart[0]?.negotiatedPrice).toBeDefined();
    expect(result.current.cart[0]?.negotiationStatus).toBe('accepted');
  });

  it('preserves the group deal when the edit target is missing', async () => {
    const result = await renderNegotiatedCart();

    act(() => {
      result.current.updateQuantity('no-such-line', 9);
    });

    expect(result.current.cart).toHaveLength(1);
    expect(result.current.cartWideNegotiationActive).toBe(true);
    expect(result.current.cart[0]?.negotiatedPrice).toBeDefined();
  });

  it('still resets the group deal when the edit applies', async () => {
    const result = await renderNegotiatedCart();
    const targetId = result.current.cart[0]?.cartItemId;
    expect(targetId).toBeDefined();

    act(() => {
      result.current.updateQuantity(targetId as string, 2);
    });

    expect(result.current.cart[0]?.quantity).toBe(2);
    expect(result.current.cartWideNegotiationActive).toBe(false);
    expect(result.current.cart[0]?.negotiatedPrice).toBeUndefined();
  });
});
