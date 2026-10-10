import { getStorefrontProductVariantsByProductIds } from '@/lib/storefront-product-variants';
import { supabase } from '@/lib/supabase';
import { useCartStore } from '@/stores/cart-store';
import {
  checkStock,
  getExistingCartQuantityForStock,
  getExistingProductQuantityForStock,
} from './cart-stock';

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

function mockVariants(rows: Record<string, unknown>[]) {
  (getStorefrontProductVariantsByProductIds as jest.Mock).mockResolvedValue({
    'product-1': rows,
  });
}

describe('cart-stock helpers', () => {
  beforeEach(() => {
    useCartStore.setState({ items: [], isLoading: false, lineSequence: 0 });
    jest.clearAllMocks();
    mockNetInfoFetch.mockResolvedValue({
      isConnected: true,
      isInternetReachable: true,
    });
  });

  it('excludes existing voucher lines from the optimistic paid total', () => {
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
    // onMutate already applied the incoming paid line before validation.
    // The reserved voucher units left the live pool at award time, so only
    // the optimistic paid line counts toward live stock.
    useCartStore.getState().addItem({
      product_id: 'product-1',
      slug: 'redmi-note-14',
      variant_id: 'variant-128',
      name: 'Redmi Note 14',
      price: 220000,
      quantity: 2,
    });

    expect(
      getExistingCartQuantityForStock({
        product_id: 'product-1',
        slug: 'redmi-note-14',
        variant_id: 'variant-128',
        name: 'Redmi Note 14',
        price: 220000,
        quantity: 2,
      })
    ).toBe(2);
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
    (supabase.rpc as jest.Mock).mockResolvedValue({
      data: [
        {
          product_id: 'product-1',
          effective_policy: 'legacy',
          available_units: 0,
        },
      ],
      error: null,
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
    (supabase.rpc as jest.Mock).mockResolvedValue({
      data: [
        {
          product_id: 'product-1',
          effective_policy: 'legacy',
          available_units: 0,
        },
      ],
      error: null,
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
    (supabase.rpc as jest.Mock).mockResolvedValue({
      data: [
        {
          product_id: 'product-1',
          effective_policy: 'legacy',
          available_units: 0,
        },
      ],
      error: null,
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

  it('validates the variant stock instead of a zero parent total', async () => {
    mockProductAndRpc(parent(), {});
    mockVariants([
      {
        id: 'variant-2',
        product_id: 'product-1',
        stock_quantity: 2,
        effective_policy: 'off',
      },
    ]);

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

  it('compares strict variant units on unmanaged parents', async () => {
    mockProductAndRpc(parent({ manage_stock: false }), {});
    mockVariants([
      {
        id: 'variant-x',
        product_id: 'product-1',
        stock_quantity: 0,
        effective_policy: 'serialized_strict',
        available_units: 1,
      },
    ]);

    await expect(
      checkStock('product-1', 1, undefined, { variantId: 'variant-x' })
    ).resolves.toEqual({
      available: true,
      currentStock: 1,
      requestedQuantity: 1,
    });
    await expect(
      checkStock('product-1', 2, undefined, { variantId: 'variant-x' })
    ).resolves.toEqual({
      available: false,
      currentStock: 1,
      requestedQuantity: 2,
    });
  });

  it('leaves legacy variants unbounded on unmanaged parents', async () => {
    mockProductAndRpc(parent({ manage_stock: false }), {});
    mockVariants([
      {
        id: 'variant-2',
        product_id: 'product-1',
        stock_quantity: 0,
        effective_policy: 'off',
      },
    ]);

    await expect(
      checkStock('product-1', 40, undefined, { variantId: 'variant-2' })
    ).resolves.toEqual({
      available: true,
      currentStock: Number.MAX_SAFE_INTEGER,
      requestedQuantity: 40,
    });
  });

  it('lets a null variant quantity inherit the parent stock', async () => {
    mockProductAndRpc(parent({ stock_quantity: 5 }), {});
    mockVariants([
      {
        id: 'variant-9',
        product_id: 'product-1',
        stock_quantity: null,
        effective_policy: 'off',
      },
    ]);

    await expect(
      checkStock('product-1', 4, undefined, { variantId: 'variant-9' })
    ).resolves.toEqual({
      available: true,
      currentStock: 5,
      requestedQuantity: 4,
    });
  });

  it('bypasses the quantity check for unlimited serialized variants', async () => {
    mockProductAndRpc(parent(), {});
    mockVariants([
      {
        id: 'variant-s',
        product_id: 'product-1',
        stock_quantity: 0,
        effective_policy: 'serialized_then_unlimited',
      },
    ]);

    await expect(
      checkStock('product-1', 1, undefined, { variantId: 'variant-s' })
    ).resolves.toEqual({
      available: true,
      currentStock: Number.MAX_SAFE_INTEGER,
      requestedQuantity: 1,
    });
  });

  it('compares strict serialized variants against exact unit counts', async () => {
    mockProductAndRpc(parent(), {});
    mockVariants([
      {
        id: 'variant-strict',
        product_id: 'product-1',
        available_units: 3,
        effective_policy: 'serialized_strict',
      },
    ]);

    await expect(
      checkStock('product-1', 3, undefined, { variantId: 'variant-strict' })
    ).resolves.toEqual({
      available: true,
      currentStock: 3,
      requestedQuantity: 3,
    });
    await expect(
      checkStock('product-1', 4, undefined, { variantId: 'variant-strict' })
    ).resolves.toEqual({
      available: false,
      currentStock: 3,
      requestedQuantity: 4,
    });
  });

  it('reports zero for a strict variant with no available units', async () => {
    mockProductAndRpc(parent({ stock_quantity: 5 }), {});
    mockVariants([
      {
        id: 'variant-strict',
        product_id: 'product-1',
        available_units: 0,
        effective_policy: 'serialized_strict',
      },
    ]);

    await expect(
      checkStock('product-1', 1, undefined, { variantId: 'variant-strict' })
    ).resolves.toEqual({
      available: false,
      currentStock: 0,
      requestedQuantity: 1,
    });
  });

  it('reports zero for a variant missing from the projection', async () => {
    mockProductAndRpc(parent({ stock_quantity: 5 }), {});
    mockVariants([
      {
        id: 'variant-other',
        product_id: 'product-1',
        stock_quantity: 9,
        effective_policy: 'off',
      },
    ]);

    await expect(
      checkStock('product-1', 1, undefined, { variantId: 'variant-gone' })
    ).resolves.toEqual({
      available: false,
      currentStock: 0,
      requestedQuantity: 1,
    });
  });

  it('throws when the variant projection lookup fails', async () => {
    mockProductAndRpc(parent(), {});
    (getStorefrontProductVariantsByProductIds as jest.Mock).mockResolvedValue(
      null
    );

    await expect(
      checkStock('product-1', 1, undefined, { variantId: 'variant-2' })
    ).rejects.toThrow('Cannot verify stock availability');
  });

  it('validates variants beyond the search projection row cap', async () => {
    mockProductAndRpc(parent(), {});
    mockVariants(
      Array.from({ length: 130 }, (_, index) => ({
        id: `variant-${index}`,
        product_id: 'product-1',
        stock_quantity: 4,
        effective_policy: 'off',
      }))
    );

    await expect(
      checkStock('product-1', 4, undefined, { variantId: 'variant-129' })
    ).resolves.toEqual({
      available: true,
      currentStock: 4,
      requestedQuantity: 4,
    });
  });

  it('validates the offer stock instead of a zero parent total', async () => {
    mockProductAndRpc(parent(), {
      get_product_offers: [{ offer_id: 'offer-7', stock_quantity: 2 }],
      get_storefront_product_base_inventory: [
        { product_id: 'product-1', effective_policy: 'legacy' },
      ],
    });

    await expect(
      checkStock('product-1', 2, undefined, { offerId: 'offer-7' })
    ).resolves.toEqual({
      available: true,
      currentStock: 2,
      requestedQuantity: 2,
    });
    await expect(
      checkStock('product-1', 3, undefined, { offerId: 'offer-7' })
    ).resolves.toEqual({
      available: false,
      currentStock: 2,
      requestedQuantity: 3,
    });
  });

  it('honors the offer scalar on explicitly unmanaged parents', async () => {
    mockProductAndRpc(parent({ manage_stock: false }), {
      get_product_offers: [{ offer_id: 'offer-7', stock_quantity: 2 }],
      get_storefront_product_base_inventory: [
        { product_id: 'product-1', effective_policy: 'legacy' },
      ],
    });

    await expect(
      checkStock('product-1', 2, undefined, { offerId: 'offer-7' })
    ).resolves.toEqual({
      available: true,
      currentStock: 2,
      requestedQuantity: 2,
    });
    await expect(
      checkStock('product-1', 3, undefined, { offerId: 'offer-7' })
    ).resolves.toEqual({
      available: false,
      currentStock: 2,
      requestedQuantity: 3,
    });
  });

  it('lets a null offer quantity inherit the parent stock', async () => {
    mockProductAndRpc(parent({ stock_quantity: 5 }), {
      get_product_offers: [{ offer_id: 'offer-7', stock_quantity: null }],
      get_storefront_product_base_inventory: [
        { product_id: 'product-1', effective_policy: 'legacy' },
      ],
    });

    await expect(
      checkStock('product-1', 4, undefined, { offerId: 'offer-7' })
    ).resolves.toEqual({
      available: true,
      currentStock: 5,
      requestedQuantity: 4,
    });
  });

  it('reports zero for an offer missing from the projection', async () => {
    mockProductAndRpc(parent({ stock_quantity: 5 }), {
      get_product_offers: [{ offer_id: 'offer-other', stock_quantity: 9 }],
    });

    await expect(
      checkStock('product-1', 1, undefined, { offerId: 'offer-gone' })
    ).resolves.toEqual({
      available: false,
      currentStock: 0,
      requestedQuantity: 1,
    });
  });

  it('throws when the offer lookup fails', async () => {
    mockProductAndRpc(parent(), {
      get_product_offers: { error: { message: 'boom' } },
    });

    await expect(
      checkStock('product-1', 1, undefined, { offerId: 'offer-7' })
    ).rejects.toThrow('Cannot verify stock availability');
  });

  it('caps the offer stock at strict serialized base units', async () => {
    mockProductAndRpc(parent(), {
      get_product_offers: [{ offer_id: 'offer-7', stock_quantity: 5 }],
      get_storefront_product_base_inventory: [
        {
          product_id: 'product-1',
          effective_policy: 'serialized_strict',
          available_units: 2,
        },
      ],
    });

    await expect(
      checkStock('product-1', 2, undefined, { offerId: 'offer-7' })
    ).resolves.toEqual({
      available: true,
      currentStock: 2,
      requestedQuantity: 2,
    });
    await expect(
      checkStock('product-1', 3, undefined, { offerId: 'offer-7' })
    ).resolves.toEqual({
      available: false,
      currentStock: 2,
      requestedQuantity: 3,
    });
  });

  it('lets a null offer quantity inherit strict serialized units', async () => {
    mockProductAndRpc(parent(), {
      get_product_offers: [{ offer_id: 'offer-7', stock_quantity: null }],
      get_storefront_product_base_inventory: [
        {
          product_id: 'product-1',
          effective_policy: 'serialized_strict',
          available_units: 3,
        },
      ],
    });

    await expect(
      checkStock('product-1', 3, undefined, { offerId: 'offer-7' })
    ).resolves.toEqual({
      available: true,
      currentStock: 3,
      requestedQuantity: 3,
    });
  });

  it('caps strict sibling offers at the shared serialized units', async () => {
    mockProductAndRpc(parent(), {
      get_product_offers: [{ offer_id: 'offer-7', stock_quantity: 5 }],
      get_storefront_product_base_inventory: [
        {
          product_id: 'product-1',
          effective_policy: 'serialized_strict',
          available_units: 1,
        },
      ],
    });

    // The per-offer total fits its scalar, but a sibling line already
    // claims the single shared unit.
    await expect(
      checkStock('product-1', 1, undefined, {
        offerId: 'offer-7',
        aggregateQuantity: 2,
      })
    ).resolves.toEqual({
      available: false,
      currentStock: 1,
      requestedQuantity: 1,
    });
    await expect(
      checkStock('product-1', 1, undefined, {
        offerId: 'offer-7',
        aggregateQuantity: 1,
      })
    ).resolves.toEqual({
      available: true,
      currentStock: 1,
      requestedQuantity: 1,
    });
  });

  it('keeps the per-offer scalar binding under shared strict units', async () => {
    mockProductAndRpc(parent(), {
      get_product_offers: [{ offer_id: 'offer-7', stock_quantity: 1 }],
      get_storefront_product_base_inventory: [
        {
          product_id: 'product-1',
          effective_policy: 'serialized_strict',
          available_units: 5,
        },
      ],
    });

    await expect(
      checkStock('product-1', 2, undefined, {
        offerId: 'offer-7',
        aggregateQuantity: 2,
      })
    ).resolves.toEqual({
      available: false,
      currentStock: 1,
      requestedQuantity: 2,
    });
  });

  it('caps the strict base line by sibling offer quantities', async () => {
    mockProductAndRpc(parent(), {
      get_product_offers: [],
      get_storefront_product_base_inventory: [
        {
          product_id: 'product-1',
          effective_policy: 'serialized_strict',
          available_units: 1,
        },
      ],
    });

    await expect(
      checkStock('product-1', 1, undefined, { aggregateQuantity: 2 })
    ).resolves.toEqual({
      available: false,
      currentStock: 1,
      requestedQuantity: 1,
    });
  });

  it('ignores the product aggregate without strict serialized units', async () => {
    mockProductAndRpc(parent(), {
      get_product_offers: [{ offer_id: 'offer-7', stock_quantity: 5 }],
      get_storefront_product_base_inventory: [
        { product_id: 'product-1', effective_policy: 'legacy' },
      ],
    });

    await expect(
      checkStock('product-1', 2, undefined, {
        offerId: 'offer-7',
        aggregateQuantity: 99,
      })
    ).resolves.toEqual({
      available: true,
      currentStock: 5,
      requestedQuantity: 2,
    });
  });

  it('throws when a strict offer has no unit count', async () => {
    mockProductAndRpc(parent(), {
      get_product_offers: [{ offer_id: 'offer-7', stock_quantity: 5 }],
      get_storefront_product_base_inventory: [
        {
          product_id: 'product-1',
          effective_policy: 'serialized_strict',
          available_units: null,
        },
      ],
    });

    await expect(
      checkStock('product-1', 1, undefined, { offerId: 'offer-7' })
    ).rejects.toThrow('Cannot verify stock availability');
  });

  it('lets unlimited offers bypass the unit cap', async () => {
    mockProductAndRpc(parent(), {
      get_product_offers: [{ offer_id: 'offer-7', stock_quantity: null }],
      get_storefront_product_base_inventory: [
        {
          product_id: 'product-1',
          effective_policy: 'serialized_then_unlimited',
          available_units: 0,
        },
      ],
    });

    await expect(
      checkStock('product-1', 4, undefined, { offerId: 'offer-7' })
    ).resolves.toEqual({
      available: true,
      currentStock: Number.MAX_SAFE_INTEGER,
      requestedQuantity: 4,
    });
  });

  it('reports zero when the offer base inventory row is missing', async () => {
    mockProductAndRpc(parent(), {
      get_product_offers: [{ offer_id: 'offer-7', stock_quantity: 5 }],
      get_storefront_product_base_inventory: [],
    });

    await expect(
      checkStock('product-1', 1, undefined, { offerId: 'offer-7' })
    ).resolves.toEqual({
      available: false,
      currentStock: 0,
      requestedQuantity: 1,
    });
  });

  it('throws when the offer base inventory lookup fails', async () => {
    mockProductAndRpc(parent(), {
      get_product_offers: [{ offer_id: 'offer-7', stock_quantity: 5 }],
      get_storefront_product_base_inventory: { error: { message: 'boom' } },
    });

    await expect(
      checkStock('product-1', 1, undefined, { offerId: 'offer-7' })
    ).rejects.toThrow('Cannot verify stock availability');
  });

  it('bypasses the quantity check for unlimited serialized base options', async () => {
    mockProductAndRpc(parent(), {
      get_storefront_product_base_inventory: [
        {
          product_id: 'product-1',
          effective_policy: 'serialized_then_unlimited',
          available_units: 0,
        },
      ],
    });

    await expect(checkStock('product-1', 1)).resolves.toEqual({
      available: true,
      currentStock: Number.MAX_SAFE_INTEGER,
      requestedQuantity: 1,
    });
  });

  it('compares strict serialized base options against exact unit counts', async () => {
    mockProductAndRpc(parent(), {
      get_storefront_product_base_inventory: [
        {
          product_id: 'product-1',
          effective_policy: 'serialized_strict',
          available_units: 2,
        },
      ],
    });

    await expect(checkStock('product-1', 2)).resolves.toEqual({
      available: true,
      currentStock: 2,
      requestedQuantity: 2,
    });
    await expect(checkStock('product-1', 3)).resolves.toEqual({
      available: false,
      currentStock: 2,
      requestedQuantity: 3,
    });
  });

  it('reports zero for a base option missing from the projection', async () => {
    mockProductAndRpc(parent({ stock_quantity: 5 }), {
      get_storefront_product_base_inventory: [],
    });

    await expect(checkStock('product-1', 1)).resolves.toEqual({
      available: false,
      currentStock: 0,
      requestedQuantity: 1,
    });
  });

  it('throws when the base inventory lookup fails', async () => {
    mockProductAndRpc(parent(), {
      get_storefront_product_base_inventory: { error: { message: 'boom' } },
    });

    await expect(checkStock('product-1', 1)).rejects.toThrow(
      'Cannot verify stock availability'
    );
  });

  it('prefers the variant identity when both option ids are present', async () => {
    mockProductAndRpc(parent(), {
      get_product_offers: [{ offer_id: 'offer-7', stock_quantity: 9 }],
    });
    mockVariants([
      {
        id: 'variant-2',
        product_id: 'product-1',
        stock_quantity: 2,
        effective_policy: 'off',
      },
    ]);

    await expect(
      checkStock('product-1', 3, undefined, {
        variantId: 'variant-2',
        offerId: 'offer-7',
      })
    ).resolves.toEqual({
      available: false,
      currentStock: 2,
      requestedQuantity: 3,
    });
    expect(getStorefrontProductVariantsByProductIds).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('counts existing quantities per offer line', async () => {
    useCartStore.setState({
      items: [
        {
          id: 'line-1',
          product_id: 'product-1',
          slug: 'slug',
          name: 'Item',
          price: 100,
          quantity: 2,
          offer_id: 'offer-7',
        },
        {
          id: 'line-2',
          product_id: 'product-1',
          slug: 'slug',
          name: 'Item',
          price: 100,
          quantity: 4,
          offer_id: 'offer-8',
        },
      ],
      isLoading: false,
      lineSequence: 2,
    });

    // onMutate already applied the incoming offer line before validation.
    useCartStore.getState().addItem({
      product_id: 'product-1',
      slug: 'slug',
      name: 'Item',
      price: 100,
      quantity: 1,
      offer_id: 'offer-7',
    });

    expect(
      getExistingCartQuantityForStock({
        product_id: 'product-1',
        slug: 'slug',
        name: 'Item',
        price: 100,
        quantity: 1,
        offer_id: 'offer-7',
      })
    ).toBe(3);
  });

  it('totals the product aggregate across base and sibling offer lines', () => {
    useCartStore.setState({
      items: [
        {
          id: 'line-1',
          product_id: 'product-1',
          slug: 'slug',
          name: 'Item',
          price: 100,
          quantity: 2,
        },
        {
          id: 'line-2',
          product_id: 'product-1',
          slug: 'slug',
          name: 'Item',
          price: 90,
          quantity: 1,
          offer_id: 'offer-7',
        },
        {
          id: 'line-3',
          product_id: 'product-2',
          slug: 'other',
          name: 'Other',
          price: 50,
          quantity: 4,
        },
      ],
      isLoading: false,
      lineSequence: 3,
    });

    expect(getExistingProductQuantityForStock('product-1')).toBe(3);
    expect(getExistingProductQuantityForStock('product-2')).toBe(4);
  });

  it('excludes pre-reserved voucher lines from the strict shared-pool total', () => {
    // One of two units reserved for a voucher: the live pool holds one
    // public unit, so the aggregate a paid add validates against is one,
    // not two.
    useCartStore.setState({
      items: [
        {
          id: 'voucher-line',
          product_id: 'product-1',
          slug: 'slug',
          name: 'Item',
          price: 0,
          quantity: 1,
          voucher_award_id: 'award-1',
        },
        {
          id: 'paid-line',
          product_id: 'product-1',
          slug: 'slug',
          name: 'Item',
          price: 100,
          quantity: 1,
        },
      ],
      isLoading: false,
      lineSequence: 2,
    });

    expect(getExistingProductQuantityForStock('product-1')).toBe(1);
  });

  it('excludes pre-reserved voucher lines from the per-identity total', () => {
    useCartStore.setState({
      items: [
        {
          id: 'voucher-line',
          product_id: 'product-1',
          slug: 'slug',
          name: 'Item',
          price: 0,
          quantity: 1,
          variant_id: 'variant-1',
          voucher_token: 'token-1',
        },
      ],
      isLoading: false,
      lineSequence: 1,
    });

    expect(
      getExistingCartQuantityForStock({
        product_id: 'product-1',
        slug: 'slug',
        name: 'Item',
        price: 100,
        quantity: 1,
        variant_id: 'variant-1',
      })
    ).toBe(0);
  });

  it('does not double-count the optimistic offer line', () => {
    // Fresh add: the store holds only the optimistic line when validation
    // runs, so the requested total equals that line alone.
    useCartStore.getState().addItem({
      product_id: 'product-1',
      slug: 'slug',
      name: 'Item',
      price: 100,
      quantity: 3,
      offer_id: 'offer-7',
    });

    expect(
      getExistingCartQuantityForStock({
        product_id: 'product-1',
        slug: 'slug',
        name: 'Item',
        price: 100,
        quantity: 3,
        offer_id: 'offer-7',
      })
    ).toBe(3);
  });
});
