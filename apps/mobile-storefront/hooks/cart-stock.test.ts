import { supabase } from '@/lib/supabase';
import { useCartStore } from '@/stores/cart-store';
import { checkStock, getTotalRequestedQuantityForStock } from './cart-stock';

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
  },
}));

jest.mock('../lib/storage', () => ({
  syncStorage: {
    getItem: jest.fn(() => null),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

describe('cart-stock helpers', () => {
  beforeEach(() => {
    useCartStore.setState({ items: [], isLoading: false, lineSequence: 0 });
    jest.clearAllMocks();
    mockNetInfoFetch.mockResolvedValue({
      isConnected: true,
      isInternetReachable: true,
    });
  });

  it('counts existing voucher lines plus the incoming paid quantity', () => {
    const voucherItem = {
      product_id: 'product-1',
      slug: 'redmi-note-14',
      variant_id: 'variant-128',
      name: 'Redmi Note 14',
      price: 0,
      quantity: 1,
      voucher_award_id: 'voucher-award-1',
    };

    useCartStore.getState().addItem(voucherItem);
    useCartStore.getState().addItem({
      ...voucherItem,
      voucher_award_id: 'voucher-award-2',
    });

    expect(
      getTotalRequestedQuantityForStock({
        product_id: 'product-1',
        slug: 'redmi-note-14',
        variant_id: 'variant-128',
        name: 'Redmi Note 14',
        price: 220000,
        quantity: 2,
      })
    ).toBe(4);
  });

  it('uses cached stock while offline', async () => {
    mockNetInfoFetch.mockResolvedValue({
      isConnected: false,
      isInternetReachable: false,
    });

    await expect(checkStock('product-1', 2, 3)).resolves.toEqual({
      available: true,
      currentStock: 3,
      requestedQuantity: 2,
    });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('blocks offline stock checks when no cache is available', async () => {
    mockNetInfoFetch.mockResolvedValue({
      isConnected: false,
      isInternetReachable: false,
    });

    await expect(checkStock('product-1', 2)).rejects.toThrow(
      'Cannot verify stock while offline.'
    );
  });

  it('treats null manage_stock as managed inventory at checkout', async () => {
    const single = jest.fn().mockResolvedValue({
      data: { stock_quantity: 0, manage_stock: null },
      error: null,
    });
    (supabase.from as jest.Mock).mockReturnValue({
      select: () => ({ eq: () => ({ single }) }),
    });

    await expect(checkStock('product-1', 1)).resolves.toEqual({
      available: false,
      currentStock: 0,
      requestedQuantity: 1,
    });
  });

  it('falls back to legacy stock when stock_quantity is zero', async () => {
    const single = jest.fn().mockResolvedValue({
      data: { stock_quantity: 0, stock: 5, manage_stock: null },
      error: null,
    });
    (supabase.from as jest.Mock).mockReturnValue({
      select: () => ({ eq: () => ({ single }) }),
    });

    await expect(checkStock('product-1', 2)).resolves.toEqual({
      available: true,
      currentStock: 5,
      requestedQuantity: 2,
    });
  });

  it('prefers stock_quantity over legacy stock when positive', async () => {
    const single = jest.fn().mockResolvedValue({
      data: { stock_quantity: 3, stock: 5, manage_stock: null },
      error: null,
    });
    (supabase.from as jest.Mock).mockReturnValue({
      select: () => ({ eq: () => ({ single }) }),
    });

    await expect(checkStock('product-1', 2)).resolves.toEqual({
      available: true,
      currentStock: 3,
      requestedQuantity: 2,
    });
  });

  it('bypasses stock checks only for explicitly unmanaged products', async () => {
    const single = jest.fn().mockResolvedValue({
      data: { stock_quantity: 0, manage_stock: false },
      error: null,
    });
    (supabase.from as jest.Mock).mockReturnValue({
      select: () => ({ eq: () => ({ single }) }),
    });

    await expect(checkStock('product-1', 1)).resolves.toEqual({
      available: true,
      currentStock: Number.MAX_SAFE_INTEGER,
      requestedQuantity: 1,
    });
  });

  function mockProductAndVariant(
    product: Record<string, unknown>,
    variant: { data: Record<string, unknown> | null; error: unknown }
  ) {
    const productSingle = jest.fn().mockResolvedValue({
      data: product,
      error: null,
    });
    const variantSingle = jest.fn().mockResolvedValue(variant);
    (supabase.from as jest.Mock).mockImplementation((table: string) => ({
      select: () => ({
        eq: () => ({
          single: table === 'product_variants' ? variantSingle : productSingle,
        }),
      }),
    }));
  }

  it('validates the variant stock instead of a zero parent total', async () => {
    mockProductAndVariant(
      { stock_quantity: 0, stock: 0, manage_stock: null },
      {
        data: { stock_quantity: 2, inventory_tracking_policy: 'tracked' },
        error: null,
      }
    );

    await expect(
      checkStock('product-1', 2, undefined, { variantId: 'variant-2' })
    ).resolves.toEqual({
      available: true,
      currentStock: 2,
      requestedQuantity: 2,
    });
    await expect(
      checkStock('product-1', 3, undefined, { variantId: 'variant-2' })
    ).resolves.toEqual({
      available: false,
      currentStock: 2,
      requestedQuantity: 3,
    });
  });

  it('lets a null variant quantity inherit the parent stock', async () => {
    mockProductAndVariant(
      { stock_quantity: 5, stock: 0, manage_stock: null },
      { data: { stock_quantity: null }, error: null }
    );

    await expect(
      checkStock('product-1', 4, undefined, { variantId: 'variant-9' })
    ).resolves.toEqual({
      available: true,
      currentStock: 5,
      requestedQuantity: 4,
    });
  });

  it('bypasses the quantity check for serialized variants', async () => {
    mockProductAndVariant(
      { stock_quantity: 0, stock: 0, manage_stock: null },
      {
        data: {
          stock_quantity: 0,
          inventory_tracking_policy: 'serialized_then_unlimited',
        },
        error: null,
      }
    );

    await expect(
      checkStock('product-1', 1, undefined, { variantId: 'variant-s' })
    ).resolves.toEqual({
      available: true,
      currentStock: Number.MAX_SAFE_INTEGER,
      requestedQuantity: 1,
    });
  });

  it('reports zero for a vanished variant instead of the parent total', async () => {
    mockProductAndVariant(
      { stock_quantity: 5, stock: 0, manage_stock: null },
      { data: null, error: { code: 'PGRST116', message: 'No rows' } }
    );

    await expect(
      checkStock('product-1', 1, undefined, { variantId: 'variant-gone' })
    ).resolves.toEqual({
      available: false,
      currentStock: 0,
      requestedQuantity: 1,
    });
  });
});
