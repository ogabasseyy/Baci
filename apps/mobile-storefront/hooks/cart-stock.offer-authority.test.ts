import { supabase } from '@/lib/supabase';
import { useCartStore } from '@/stores/cart-store';
import { checkStock } from './cart-stock';

const mockNetInfoFetch = jest.fn();

jest.mock('@react-native-community/netinfo', () => ({
  fetch: () => mockNetInfoFetch(),
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    error: jest.fn(),
    warn: jest.fn(),
  }),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

jest.mock('../lib/storage', () => ({
  syncStorage: {
    getItem: jest.fn(() => null),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

jest.mock('@/lib/storefront-product-variants', () => ({
  getStorefrontProductVariantsByProductIds: jest.fn(),
}));

describe('cart-stock offer authority', () => {
  beforeEach(() => {
    useCartStore.setState({ items: [], isLoading: false, lineSequence: 0 });
    jest.clearAllMocks();
    mockNetInfoFetch.mockResolvedValue({
      isConnected: true,
      isInternetReachable: true,
    });
  });

  function mockProductAndRpc(
    product: Record<string, unknown>,
    rowsByRpc: Record<string, unknown[] | { error: unknown }>
  ) {
    const productSingle = jest.fn().mockResolvedValue({
      data: product,
      error: null,
    });
    (supabase.from as jest.Mock).mockReturnValue({
      select: () => ({ eq: () => ({ single: productSingle }) }),
    });
    (supabase.rpc as jest.Mock).mockImplementation((name: string) => {
      const stub = rowsByRpc[name] ?? [];
      if (!Array.isArray(stub))
        return Promise.resolve({
          data: null,
          error: (stub as { error: unknown }).error,
        });
      return Promise.resolve({ data: stub, error: null });
    });
  }

  const parent = (overrides: Record<string, unknown> = {}) => ({
    stock_quantity: 0,
    stock: 0,
    manage_stock: null,
    merchant_id: 'merchant-1',
    ...overrides,
  });

  it('throws retryable when a strict offer has no unit count', async () => {
    mockProductAndRpc(parent(), {
      get_storefront_offer_resolution: [
        {
          product_id: 'product-1',
          offer_id: 'offer-7',
          allocatable_stock: 0,
          effective_policy: 'serialized_strict',
          available_units: null,
          parent_eligible: true,
        },
      ],
    });

    await expect(
      checkStock('product-1', 1, undefined, { offerId: 'offer-7' })
    ).rejects.toThrow('Cannot verify stock availability. Please try again.');
  });

  it('reports zero for a genuine strict sell-out without throwing', async () => {
    mockProductAndRpc(parent(), {
      get_storefront_offer_resolution: [
        {
          product_id: 'product-1',
          offer_id: 'offer-7',
          allocatable_stock: 0,
          effective_policy: 'serialized_strict',
          available_units: 0,
          parent_eligible: true,
        },
      ],
    });

    await expect(
      checkStock('product-1', 1, undefined, { offerId: 'offer-7' })
    ).resolves.toEqual({
      available: false,
      currentStock: 0,
      requestedQuantity: 1,
    });
  });

  it('reports zero when strict units are exhausted', async () => {
    mockProductAndRpc(parent(), {
      get_storefront_offer_resolution: [
        {
          product_id: 'product-1',
          offer_id: 'offer-7',
          allocatable_stock: 0,
          effective_policy: 'serialized_strict',
          available_units: 0,
          parent_eligible: true,
        },
      ],
    });

    await expect(
      checkStock('product-1', 1, undefined, { offerId: 'offer-7' })
    ).resolves.toEqual({
      available: false,
      currentStock: 0,
      requestedQuantity: 1,
    });
  });
});
