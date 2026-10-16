import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { CartItem } from '@/stores/cart-store';

type ProductsResponse = {
  data: Array<{
    id: string;
    price: number | string;
    has_condition_offers?: boolean;
    condition?: string | null;
    has_variants?: boolean | null;
    variant_model?: string | null;
  }> | null;
  error: { message: string } | null;
};

type VariantsResponse = {
  data: Array<{
    id: string;
    product_id: string;
    price_override: number | string | null;
  }> | null;
  error: { message: string } | null;
};

type ProductQuery = {
  select: jest.MockedFunction<(columns: string) => ProductQuery>;
  eq: jest.MockedFunction<(column: string, value: unknown) => ProductQuery>;
  in: jest.MockedFunction<
    (column: string, values: string[]) => Promise<ProductsResponse>
  >;
};

const mockWarn = jest.fn();
// The variant-override RPC resolves `{ data, error }` directly while the
// live-variant presence probe chains `.range()` off the builder.
const mockRange =
  jest.fn<
    (...args: unknown[]) => Promise<{
      data: Array<{ product_id: string }> | null;
      count: number | null;
      error: { message: string } | null;
    }>
  >();
const mockRpc = jest.fn<(name: string, ...args: unknown[]) => unknown>();
let overridesResult: VariantsResponse = { data: [], error: null };
function applyRpcMock() {
  mockRpc.mockImplementation((name: string) =>
    name === 'get_storefront_product_variants'
      ? { range: (...args: unknown[]) => mockRange(...args) }
      : Promise.resolve(overridesResult)
  );
}
function setVariantOverrides(result: VariantsResponse) {
  overridesResult = result;
  applyRpcMock();
}
const mockGetOffers =
  jest.fn<
    (productIds: string[]) => Promise<Record<
      string,
      Array<{
        id: string;
        price: number | null;
        condition?: string | null;
        stock_quantity?: number | null;
      }>
    > | null>
  >();
const productQuery = {} as ProductQuery;
const mockFrom = jest.fn(() => productQuery);

async function repriceCartItems(
  ...args: Parameters<typeof import('./cart-reprice').repriceCartItems>
) {
  const repriceModule = await import('./cart-reprice');
  return repriceModule.repriceCartItems(...args);
}

productQuery.select = jest.fn(() => productQuery);
productQuery.eq = jest.fn(() => productQuery);
productQuery.in = jest.fn();

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    warn: mockWarn,
  }),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: mockFrom,
    rpc: mockRpc,
  },
}));

jest.mock('@/lib/fetch-storefront-product-offers', () => ({
  getStorefrontProductOffersByProductIds: mockGetOffers,
}));

const mockGetBaseInventory =
  jest.fn<
    (productIds: string[]) => Promise<Record<
      string,
      {
        product_id: string;
        effective_policy?: string | null;
        available_units?: number | null;
      }
    > | null>
  >();
jest.mock('@/lib/fetch-storefront-product-base-inventory', () => ({
  getStorefrontProductBaseInventoryByProductIds: (...args: [string[]]) =>
    mockGetBaseInventory(...args),
}));

function createCartItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: 'line-1',
    product_id: 'product-1',
    slug: 'iphone-13',
    name: 'iPhone 13',
    price: 390000,
    quantity: 1,
    ...overrides,
  };
}

describe('repriceCartItems', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    productQuery.select.mockClear();
    productQuery.eq.mockClear();
    productQuery.in.mockReset();
    mockRpc.mockReset();
    mockRange.mockReset();
    mockGetOffers.mockReset();
    mockGetBaseInventory.mockReset();
    mockGetBaseInventory.mockResolvedValue({});
    productQuery.in.mockResolvedValue({ data: [], error: null });
    setVariantOverrides({ data: [], error: null });
    mockRange.mockResolvedValue({ data: [], count: 0, error: null });
    mockGetOffers.mockResolvedValue({});
  });

  it('skips catalog reads when the merchant scope is missing', async () => {
    const result = await repriceCartItems([createCartItem()], '');

    expect(result).toEqual({
      priceById: {},
      conditionById: {},
      changes: [],
      conditionChanges: [],
      unavailable: [],
      offerIdById: {},
      adoptions: [],
    });
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('skips catalog reads when the cart is empty even with a valid merchant', async () => {
    const result = await repriceCartItems([], 'merchant-1');

    expect(result).toEqual({
      priceById: {},
      conditionById: {},
      changes: [],
      conditionChanges: [],
      unavailable: [],
      offerIdById: {},
      adoptions: [],
    });
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('uses live product prices and variant overrides as authoritative unit prices', async () => {
    const items = [
      createCartItem({ id: 'base-line', product_id: 'base-product' }),
      createCartItem({
        id: 'variant-line',
        product_id: 'variant-product',
        variant_id: 'variant-1',
        name: 'Galaxy A27 8GB',
        price: 420000,
      }),
    ];
    productQuery.in.mockResolvedValue({
      data: [
        { id: 'base-product', price: '410000' },
        { id: 'variant-product', price: 450000 },
      ],
      error: null,
    });
    setVariantOverrides({
      data: [
        {
          id: 'variant-1',
          product_id: 'variant-product',
          price_override: '475000',
        },
      ],
      error: null,
    });

    const result = await repriceCartItems(items, 'merchant-1');

    expect(mockFrom).toHaveBeenCalledWith('products');
    expect(productQuery.select).toHaveBeenCalledWith(
      'id, price, has_condition_offers, condition, has_variants, variant_model'
    );
    expect(productQuery.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(productQuery.eq).toHaveBeenCalledWith('status', 'active');
    expect(productQuery.in).toHaveBeenCalledWith('id', [
      'base-product',
      'variant-product',
    ]);
    expect(mockRpc).toHaveBeenCalledWith('get_order_variant_overrides', {
      p_variant_ids: ['variant-1'],
    });
    expect(result.priceById).toEqual({
      'base-line': 410000,
      'variant-line': 475000,
    });
    expect(result.changes).toEqual([
      {
        id: 'base-line',
        name: 'iPhone 13',
        oldPrice: 390000,
        newPrice: 410000,
      },
      {
        id: 'variant-line',
        name: 'Galaxy A27 8GB',
        oldPrice: 420000,
        newPrice: 475000,
      },
    ]);
  });

  it('does not report a price change within the one-naira tolerance', async () => {
    productQuery.in.mockResolvedValue({
      data: [{ id: 'product-1', price: 390001 }],
      error: null,
    });

    const result = await repriceCartItems([createCartItem()], 'merchant-1');

    expect(result.priceById).toEqual({ 'line-1': 390001 });
    expect(result.changes).toEqual([]);
  });

  it('reports a sub-tolerance unit drift when the extended line total exceeds tolerance', async () => {
    productQuery.in.mockResolvedValue({
      data: [{ id: 'product-1', price: 390000.75 }],
      error: null,
    });

    const result = await repriceCartItems(
      [createCartItem({ quantity: 2 })],
      'merchant-1'
    );

    expect(result.priceById).toEqual({ 'line-1': 390000.75 });
    expect(result.changes).toEqual([
      {
        id: 'line-1',
        name: 'iPhone 13',
        oldPrice: 390000,
        newPrice: 390000.75,
      },
    ]);
  });

  it('reports a sub-tolerance unit drift on offer lines by extended total', async () => {
    const offerLine = createCartItem({
      id: 'offer-line',
      product_id: 'offer-product',
      offer_id: 'offer-7',
      price: 300000,
      quantity: 2,
    });
    productQuery.in.mockResolvedValue({
      data: [
        { id: 'offer-product', price: 430000, has_condition_offers: true },
      ],
      error: null,
    });
    mockGetOffers.mockResolvedValue({
      'offer-product': [{ id: 'offer-7', price: 300000.75 }],
    });

    const result = await repriceCartItems([offerLine], 'merchant-1');

    expect(result.priceById).toEqual({ 'offer-line': 300000.75 });
    expect(result.changes).toEqual([
      {
        id: 'offer-line',
        name: 'iPhone 13',
        oldPrice: 300000,
        newPrice: 300000.75,
      },
    ]);
  });

  it('flags every line on an offer depleted below the aggregate take', async () => {
    const lines = [
      createCartItem({
        id: 'offer-line-a',
        product_id: 'offer-product',
        offer_id: 'offer-7',
        price: 300000,
        quantity: 2,
      }),
      createCartItem({
        id: 'offer-line-b',
        product_id: 'offer-product',
        offer_id: 'offer-7',
        price: 300000,
        quantity: 1,
      }),
    ];
    productQuery.in.mockResolvedValue({
      data: [
        { id: 'offer-product', price: 430000, has_condition_offers: true },
      ],
      error: null,
    });
    mockGetOffers.mockResolvedValue({
      'offer-product': [
        { id: 'offer-7', price: 300000, condition: 'used', stock_quantity: 2 },
      ],
    });

    const result = await repriceCartItems(lines, 'merchant-1');

    expect(result.unavailable).toEqual([
      { id: 'offer-line-a', name: 'iPhone 13' },
      { id: 'offer-line-b', name: 'iPhone 13' },
    ]);
  });

  it('flags base and offer lines that jointly exceed a strict pool', async () => {
    const lines = [
      createCartItem({
        id: 'base-line',
        product_id: 'strict-product',
        price: 430000,
        quantity: 1,
      }),
      createCartItem({
        id: 'offer-line',
        product_id: 'strict-product',
        offer_id: 'offer-7',
        price: 300000,
        quantity: 1,
      }),
    ];
    productQuery.in.mockResolvedValue({
      data: [
        { id: 'strict-product', price: 430000, has_condition_offers: true },
      ],
      error: null,
    });
    mockGetOffers.mockResolvedValue({
      'strict-product': [
        { id: 'offer-7', price: 300000, condition: 'used', stock_quantity: 5 },
      ],
    });
    mockGetBaseInventory.mockResolvedValue({
      'strict-product': {
        product_id: 'strict-product',
        effective_policy: 'serialized_strict',
        available_units: 1,
      },
    });

    const result = await repriceCartItems(lines, 'merchant-1');

    // Each line fits its own allocation (offer 5, unmanaged base), but
    // the product total (2) exceeds the strict pool (1).
    expect(result.unavailable).toEqual([
      { id: 'base-line', name: 'iPhone 13' },
      { id: 'offer-line', name: 'iPhone 13' },
    ]);
  });

  it('skips the strict pool check when the fetch fails', async () => {
    const offerLine = createCartItem({
      id: 'offer-line',
      product_id: 'offer-product',
      offer_id: 'offer-7',
      price: 300000,
      quantity: 1,
    });
    productQuery.in.mockResolvedValue({
      data: [
        { id: 'offer-product', price: 430000, has_condition_offers: true },
      ],
      error: null,
    });
    mockGetOffers.mockResolvedValue({
      'offer-product': [
        { id: 'offer-7', price: 300000, condition: 'used', stock_quantity: 5 },
      ],
    });
    mockGetBaseInventory.mockResolvedValue(null);

    const result = await repriceCartItems([offerLine], 'merchant-1');

    expect(result.unavailable).toEqual([]);
  });

  it('keeps offer lines available when the aggregate fits the allocation', async () => {
    const offerLine = createCartItem({
      id: 'offer-line',
      product_id: 'offer-product',
      offer_id: 'offer-7',
      price: 300000,
      quantity: 2,
    });
    productQuery.in.mockResolvedValue({
      data: [
        { id: 'offer-product', price: 430000, has_condition_offers: true },
      ],
      error: null,
    });
    mockGetOffers.mockResolvedValue({
      'offer-product': [
        { id: 'offer-7', price: 300000, condition: 'used', stock_quantity: 2 },
      ],
    });

    const result = await repriceCartItems([offerLine], 'merchant-1');

    expect(result.unavailable).toEqual([]);
    expect(result.priceById).toEqual({ 'offer-line': 300000 });
  });

  it('fails open when product lookup fails', async () => {
    productQuery.in.mockResolvedValue({
      data: null,
      error: { message: 'products unavailable' },
    });

    const result = await repriceCartItems([createCartItem()], 'merchant-1');

    expect(result).toEqual({
      priceById: {},
      conditionById: {},
      changes: [],
      conditionChanges: [],
      unavailable: [],
      offerIdById: {},
      adoptions: [],
    });
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockWarn).toHaveBeenCalledWith(
      'Reprice products lookup failed; keeping cart prices',
      { error: 'products unavailable' }
    );
  });

  it('skips variant lines (but not base lines) when the variant lookup fails', async () => {
    const variantItem = createCartItem({
      id: 'variant-line',
      variant_id: 'variant-1',
      price: 390000,
    });
    const baseItem = createCartItem({
      id: 'base-line',
      product_id: 'base-product',
      price: 200000,
    });
    productQuery.in.mockResolvedValue({
      data: [
        { id: 'product-1', price: 430000 },
        { id: 'base-product', price: 250000 },
      ],
      error: null,
    });
    setVariantOverrides({
      data: null,
      error: { message: 'variants unavailable' },
    });

    const result = await repriceCartItems(
      [variantItem, baseItem],
      'merchant-1'
    );

    // The variant line is NOT repriced to the base product price (a variant
    // with a price_override would otherwise be rewritten incorrectly); the
    // non-variant line still reprices normally.
    expect(result.priceById).toEqual({ 'base-line': 250000 });
    expect(result.changes).toEqual([
      {
        id: 'base-line',
        name: 'iPhone 13',
        oldPrice: 200000,
        newPrice: 250000,
      },
    ]);
    expect(mockWarn).toHaveBeenCalledWith(
      'Reprice variant override lookup failed; skipping variant lines',
      { error: 'variants unavailable' }
    );
  });

  it('marks a variant line unavailable when its override belongs to a different product', async () => {
    const item = createCartItem({
      id: 'variant-line',
      product_id: 'product-1',
      variant_id: 'variant-1',
      price: 390000,
    });
    productQuery.in.mockResolvedValue({
      data: [{ id: 'product-1', price: 430000 }],
      error: null,
    });
    // The override row's variant belongs to a DIFFERENT product (stale/corrupt
    // cart line). The order RPC joins variants with `v.product_id = p.id`
    // and rejects with `invalid_variant`, so the line is unavailable —
    // falling back to the base price would sail past the removal alert
    // and fail at checkout.
    setVariantOverrides({
      data: [
        {
          id: 'variant-1',
          product_id: 'some-other-product',
          price_override: '999000',
        },
      ],
      error: null,
    });

    const result = await repriceCartItems([item], 'merchant-1');

    expect(result.priceById).toEqual({});
    expect(result.unavailable).toEqual([
      { id: 'variant-line', name: 'iPhone 13' },
    ]);
  });

  it('inherits the parent price when the live variant row has a null override', async () => {
    const item = createCartItem({
      id: 'variant-line',
      product_id: 'product-1',
      variant_id: 'variant-1',
      price: 390000,
    });
    productQuery.in.mockResolvedValue({
      data: [{ id: 'product-1', price: 430000 }],
      error: null,
    });
    setVariantOverrides({
      data: [
        { id: 'variant-1', product_id: 'product-1', price_override: null },
      ],
      error: null,
    });

    const result = await repriceCartItems([item], 'merchant-1');

    expect(result.priceById).toEqual({ 'variant-line': 430000 });
    expect(result.unavailable).toEqual([]);
  });

  it('marks a variant line unavailable when its row is missing after a successful lookup', async () => {
    const item = createCartItem({
      id: 'variant-line',
      product_id: 'product-1',
      variant_id: 'variant-deleted',
      price: 390000,
    });
    productQuery.in.mockResolvedValue({
      data: [{ id: 'product-1', price: 430000 }],
      error: null,
    });
    // Successful lookup, but the variant row is gone (deleted/inactive):
    // checkout would reject with `invalid_variant`.
    setVariantOverrides({ data: [], error: null });

    const result = await repriceCartItems([item], 'merchant-1');

    expect(result.priceById).toEqual({});
    expect(result.unavailable).toEqual([
      { id: 'variant-line', name: 'iPhone 13' },
    ]);
  });

  it('skips voucher reward lines (free awards are not repriced)', async () => {
    const voucherLine = createCartItem({
      id: 'voucher-line',
      price: 0,
      voucher_award_id: 'award-1',
    });
    const paidLine = createCartItem({ id: 'paid-line', price: 390000 });
    productQuery.in.mockResolvedValue({
      data: [{ id: 'product-1', price: 430000 }],
      error: null,
    });

    const result = await repriceCartItems(
      [voucherLine, paidLine],
      'merchant-1'
    );

    // The voucher award stays out of repricing; the paid line reprices normally.
    expect(result.priceById).toEqual({ 'paid-line': 430000 });
  });

  it('reprices parent-priced base lines on products that carry condition offers', async () => {
    // The order RPC prices every offerless non-variant line from
    // products.price, so a base line (no condition, or the parent's own
    // condition) tracks the parent price even when the product also
    // carries condition offers.
    const bareBaseLine = createCartItem({
      id: 'bare-base-line',
      product_id: 'offer-product',
      price: 390000,
    });
    const newBaseLine = createCartItem({
      id: 'new-base-line',
      product_id: 'offer-product',
      condition: 'new',
      price: 390000,
    });
    productQuery.in.mockResolvedValue({
      data: [
        {
          id: 'offer-product',
          price: 430000,
          has_condition_offers: true,
          condition: 'new',
        },
      ],
      error: null,
    });

    const result = await repriceCartItems(
      [bareBaseLine, newBaseLine],
      'merchant-1'
    );

    expect(result.priceById).toEqual({
      'bare-base-line': 430000,
      'new-base-line': 430000,
    });
    expect(result.unavailable).toEqual([]);
  });

  it('adopts the unambiguous live offer for a legacy offerless line', async () => {
    // Persisted before exact offer ids: an offer condition and price but
    // no offer_id. Exactly one live offer matches the stored condition,
    // so the line adopts it and reprices from the live offer row.
    const legacyLine = createCartItem({
      id: 'legacy-line',
      product_id: 'offer-product',
      condition: 'Open Box',
      price: 300000,
    });
    productQuery.in.mockResolvedValue({
      data: [
        {
          id: 'offer-product',
          price: 430000,
          has_condition_offers: true,
          condition: 'new',
        },
      ],
      error: null,
    });
    mockGetOffers.mockResolvedValue({
      'offer-product': [
        { id: 'offer-1', price: 310000, condition: 'open_box' },
      ],
    });

    const result = await repriceCartItems([legacyLine], 'merchant-1');

    expect(result.offerIdById).toEqual({ 'legacy-line': 'offer-1' });
    expect(result.adoptions).toEqual([
      { id: 'legacy-line', name: 'iPhone 13', offerId: 'offer-1' },
    ]);
    expect(result.priceById).toEqual({ 'legacy-line': 310000 });
    expect(result.unavailable).toEqual([]);
  });

  it('marks a legacy line unavailable when no live offer matches its condition', async () => {
    const legacyLine = createCartItem({
      id: 'legacy-line',
      product_id: 'offer-product',
      condition: 'Open Box',
      price: 300000,
    });
    productQuery.in.mockResolvedValue({
      data: [
        {
          id: 'offer-product',
          price: 430000,
          has_condition_offers: true,
          condition: 'new',
        },
      ],
      error: null,
    });
    mockGetOffers.mockResolvedValue({
      'offer-product': [{ id: 'offer-9', price: 200000, condition: 'used' }],
    });

    const result = await repriceCartItems([legacyLine], 'merchant-1');

    expect(result.priceById).toEqual({});
    expect(result.unavailable).toEqual([
      { id: 'legacy-line', name: 'iPhone 13' },
    ]);
  });

  it('marks a legacy line unavailable when two live offers share its condition', async () => {
    const legacyLine = createCartItem({
      id: 'legacy-line',
      product_id: 'offer-product',
      condition: 'Open Box',
      price: 300000,
    });
    productQuery.in.mockResolvedValue({
      data: [
        {
          id: 'offer-product',
          price: 430000,
          has_condition_offers: true,
          condition: 'new',
        },
      ],
      error: null,
    });
    mockGetOffers.mockResolvedValue({
      'offer-product': [
        { id: 'offer-1', price: 310000, condition: 'open_box' },
        { id: 'offer-2', price: 320000, condition: 'Open Box' },
      ],
    });

    const result = await repriceCartItems([legacyLine], 'merchant-1');

    expect(result.priceById).toEqual({});
    expect(result.unavailable).toEqual([
      { id: 'legacy-line', name: 'iPhone 13' },
    ]);
  });

  it('skips legacy lines (but not base lines) when the offer lookup fails', async () => {
    const legacyLine = createCartItem({
      id: 'legacy-line',
      product_id: 'offer-product',
      condition: 'Open Box',
      price: 300000,
    });
    const baseLine = createCartItem({
      id: 'base-line',
      product_id: 'offer-product',
      price: 390000,
    });
    productQuery.in.mockResolvedValue({
      data: [
        {
          id: 'offer-product',
          price: 430000,
          has_condition_offers: true,
          condition: 'new',
        },
      ],
      error: null,
    });
    mockGetOffers.mockResolvedValue(null);

    const result = await repriceCartItems([legacyLine, baseLine], 'merchant-1');

    expect(result.priceById).toEqual({ 'base-line': 430000 });
    expect(result.unavailable).toEqual([]);
  });

  it.each([
    {
      label: 'flag disabled',
      product: { id: 'offer-product', price: 430000 },
    },
    {
      label: 'flag explicitly false',
      product: {
        id: 'offer-product',
        price: 430000,
        has_condition_offers: false,
      },
    },
    {
      label: 'variant-bearing parent',
      product: {
        id: 'offer-product',
        price: 430000,
        has_condition_offers: true,
        has_variants: true,
      },
    },
    {
      label: 'sku-matrix parent',
      product: {
        id: 'offer-product',
        price: 430000,
        has_condition_offers: true,
        variant_model: 'sku_matrix',
      },
    },
  ])('marks an exact offer line unavailable when the parent is ineligible ($label)', async ({
    product,
  }) => {
    const offerLine = createCartItem({
      id: 'offer-line',
      product_id: 'offer-product',
      offer_id: 'offer-7',
      price: 280000,
    });
    productQuery.in.mockResolvedValue({ data: [product], error: null });
    mockGetOffers.mockResolvedValue({
      'offer-product': [{ id: 'offer-7', price: 280000 }],
    });

    const result = await repriceCartItems([offerLine], 'merchant-1');

    // The live offer row exists, but the order RPC's parent gate
    // would reject the line with `invalid_offer`.
    expect(result.priceById).toEqual({});
    expect(result.unavailable).toEqual([
      { id: 'offer-line', name: 'iPhone 13' },
    ]);
  });

  it('marks an exact offer line unavailable when live variants appear', async () => {
    const offerLine = createCartItem({
      id: 'offer-line',
      product_id: 'offer-product',
      offer_id: 'offer-7',
      price: 280000,
    });
    productQuery.in.mockResolvedValue({
      data: [
        { id: 'offer-product', price: 430000, has_condition_offers: true },
      ],
      error: null,
    });
    mockGetOffers.mockResolvedValue({
      'offer-product': [{ id: 'offer-7', price: 280000 }],
    });
    mockRange.mockResolvedValue({
      data: [{ product_id: 'offer-product' }],
      count: 1,
      error: null,
    });

    const result = await repriceCartItems([offerLine], 'merchant-1');

    expect(result.priceById).toEqual({});
    expect(result.unavailable).toEqual([
      { id: 'offer-line', name: 'iPhone 13' },
    ]);
    // One batched probe covers the whole cart.
    expect(mockRpc).toHaveBeenCalledWith(
      'get_storefront_product_variants',
      { p_product_ids: ['offer-product'] },
      { count: 'exact' }
    );
    expect(mockRange).toHaveBeenCalledTimes(1);
  });

  it('paginates the presence probe past a full page of rows', async () => {
    const lineA = createCartItem({
      id: 'line-a',
      product_id: 'product-a',
      offer_id: 'offer-a',
      price: 280000,
    });
    const lineB = createCartItem({
      id: 'line-b',
      product_id: 'product-b',
      offer_id: 'offer-b',
      price: 280000,
    });
    productQuery.in.mockResolvedValue({
      data: [
        { id: 'product-a', price: 430000, has_condition_offers: true },
        { id: 'product-b', price: 430000, has_condition_offers: true },
      ],
      error: null,
    });
    mockGetOffers.mockResolvedValue({
      'product-a': [{ id: 'offer-a', price: 280000 }],
      'product-b': [{ id: 'offer-b', price: 280000 }],
    });
    mockRange
      .mockResolvedValueOnce({ data: [], count: 501, error: null })
      .mockResolvedValueOnce({
        data: [{ product_id: 'product-b' }],
        count: 501,
        error: null,
      });

    const result = await repriceCartItems([lineA, lineB], 'merchant-1');

    expect(mockRange).toHaveBeenCalledTimes(2);
    expect(mockRange).toHaveBeenNthCalledWith(1, 0, 499);
    expect(mockRange).toHaveBeenNthCalledWith(2, 500, 999);
    expect(result.priceById).toEqual({ 'line-a': 280000 });
    expect(result.unavailable).toEqual([{ id: 'line-b', name: 'iPhone 13' }]);
  });

  it('skips offer lines when the live-variant probe fails', async () => {
    const offerLine = createCartItem({
      id: 'offer-line',
      product_id: 'offer-product',
      offer_id: 'offer-7',
      price: 280000,
    });
    productQuery.in.mockResolvedValue({
      data: [
        { id: 'offer-product', price: 430000, has_condition_offers: true },
      ],
      error: null,
    });
    mockGetOffers.mockResolvedValue({
      'offer-product': [{ id: 'offer-7', price: 280000 }],
    });
    mockRange.mockResolvedValue({
      data: null,
      count: null,
      error: { message: 'probe down' },
    });

    const result = await repriceCartItems([offerLine], 'merchant-1');

    expect(result.priceById).toEqual({});
    expect(result.unavailable).toEqual([]);
  });

  it('reprices exact offer lines from the live offer price', async () => {
    const offerLine = createCartItem({
      id: 'offer-line',
      product_id: 'offer-product',
      offer_id: 'offer-7',
      price: 300000,
    });
    productQuery.in.mockResolvedValue({
      data: [
        { id: 'offer-product', price: 430000, has_condition_offers: true },
      ],
      error: null,
    });
    mockGetOffers.mockResolvedValue({
      'offer-product': [{ id: 'offer-7', price: 280000 }],
    });

    const result = await repriceCartItems([offerLine], 'merchant-1');

    expect(mockGetOffers).toHaveBeenCalledWith(['offer-product']);
    expect(result.priceById).toEqual({ 'offer-line': 280000 });
    expect(result.changes).toEqual([
      {
        id: 'offer-line',
        name: 'iPhone 13',
        oldPrice: 300000,
        newPrice: 280000,
      },
    ]);
  });

  it('refreshes a drifted offer condition together with the price', async () => {
    const offerLine = createCartItem({
      id: 'offer-line',
      product_id: 'offer-product',
      offer_id: 'offer-7',
      price: 280000,
      condition: 'used',
    });
    productQuery.in.mockResolvedValue({
      data: [
        { id: 'offer-product', price: 430000, has_condition_offers: true },
      ],
      error: null,
    });
    mockGetOffers.mockResolvedValue({
      'offer-product': [
        { id: 'offer-7', price: 280000, condition: 'refurbished' },
      ],
    });

    const result = await repriceCartItems([offerLine], 'merchant-1');

    // Same price, but the condition moved: checkout would reject the
    // stale condition, so the line must surface as a condition change
    // with the live condition ready to apply — never as a bogus
    // same-price "X to X" price move.
    expect(result.priceById).toEqual({ 'offer-line': 280000 });
    expect(result.conditionById).toEqual({ 'offer-line': 'refurbished' });
    expect(result.changes).toEqual([]);
    expect(result.conditionChanges).toEqual([
      {
        id: 'offer-line',
        name: 'iPhone 13',
        oldCondition: 'used',
        newCondition: 'refurbished',
      },
    ]);
  });

  it('accepts a zero live offer price', async () => {
    const offerLine = createCartItem({
      id: 'offer-line',
      product_id: 'offer-product',
      offer_id: 'offer-7',
      price: 300000,
    });
    productQuery.in.mockResolvedValue({
      data: [
        { id: 'offer-product', price: 430000, has_condition_offers: true },
      ],
      error: null,
    });
    mockGetOffers.mockResolvedValue({
      'offer-product': [{ id: 'offer-7', price: 0 }],
    });

    const result = await repriceCartItems([offerLine], 'merchant-1');

    expect(result.priceById).toEqual({ 'offer-line': 0 });
    expect(result.changes).toEqual([
      {
        id: 'offer-line',
        name: 'iPhone 13',
        oldPrice: 300000,
        newPrice: 0,
      },
    ]);
  });

  it('skips offer lines (but not base lines) when the offer lookup fails', async () => {
    const offerLine = createCartItem({
      id: 'offer-line',
      product_id: 'offer-product',
      offer_id: 'offer-7',
      price: 300000,
    });
    const baseLine = createCartItem({ id: 'base-line', price: 390000 });
    productQuery.in.mockResolvedValue({
      data: [
        { id: 'offer-product', price: 430000, has_condition_offers: true },
        { id: 'product-1', price: 410000, has_condition_offers: false },
      ],
      error: null,
    });
    mockGetOffers.mockResolvedValue(null);

    const result = await repriceCartItems([offerLine, baseLine], 'merchant-1');

    // The offer line keeps its cart price (no base-price corruption);
    // the base line still reprices.
    expect(result.priceById).toEqual({ 'base-line': 410000 });
    expect(result.changes.map((change) => change.id)).toEqual(['base-line']);
  });

  it('skips an offer line whose offer vanished or belongs to another product', async () => {
    const goneLine = createCartItem({
      id: 'gone-line',
      product_id: 'offer-product',
      offer_id: 'offer-gone',
      price: 300000,
    });
    const foreignLine = createCartItem({
      id: 'foreign-line',
      product_id: 'other-product',
      offer_id: 'offer-7',
      price: 300000,
    });
    productQuery.in.mockResolvedValue({
      data: [
        { id: 'offer-product', price: 430000, has_condition_offers: true },
        { id: 'other-product', price: 430000, has_condition_offers: true },
      ],
      error: null,
    });
    mockGetOffers.mockResolvedValue({
      'offer-product': [{ id: 'offer-7', price: 280000 }],
      'other-product': [],
    });

    const result = await repriceCartItems(
      [goneLine, foreignLine],
      'merchant-1'
    );

    expect(result.priceById).toEqual({});
    expect(result.changes).toEqual([]);
    // Vanished after a successful lookup: unavailable, so checkout can
    // stop with a removal path instead of looping invalid_offer.
    expect(result.unavailable).toEqual([
      { id: 'gone-line', name: 'iPhone 13' },
      { id: 'foreign-line', name: 'iPhone 13' },
    ]);
  });

  it('marks a line unavailable when its product vanished after a successful lookup', async () => {
    const goneLine = createCartItem({
      id: 'gone-line',
      product_id: 'gone-product',
      price: 300000,
    });
    productQuery.in.mockResolvedValue({ data: [], error: null });

    const result = await repriceCartItems([goneLine], 'merchant-1');

    expect(result.priceById).toEqual({});
    expect(result.unavailable).toEqual([
      { id: 'gone-line', name: 'iPhone 13' },
    ]);
  });

  it('fails open without unavailable lines when the lookups error', async () => {
    const offerLine = createCartItem({
      id: 'offer-line',
      product_id: 'offer-product',
      offer_id: 'offer-7',
      price: 300000,
    });
    productQuery.in.mockResolvedValue({
      data: [
        { id: 'offer-product', price: 430000, has_condition_offers: true },
      ],
      error: null,
    });
    mockGetOffers.mockResolvedValue(null);

    const result = await repriceCartItems([offerLine], 'merchant-1');

    expect(result.priceById).toEqual({});
    expect(result.unavailable).toEqual([]);
  });

  it('does not fetch offers when no lines carry an offer id', async () => {
    const baseLine = createCartItem({ id: 'base-line', price: 390000 });
    productQuery.in.mockResolvedValue({
      data: [{ id: 'product-1', price: 410000, has_condition_offers: false }],
      error: null,
    });

    await repriceCartItems([baseLine], 'merchant-1');

    expect(mockGetOffers).not.toHaveBeenCalled();
  });

  it('still reprices a variant line even when its product has condition offers', async () => {
    const variantLine = createCartItem({
      id: 'variant-line',
      product_id: 'offer-product',
      variant_id: 'variant-1',
      price: 300000,
    });
    productQuery.in.mockResolvedValue({
      data: [
        { id: 'offer-product', price: 430000, has_condition_offers: true },
      ],
      error: null,
    });
    setVariantOverrides({
      data: [
        {
          id: 'variant-1',
          product_id: 'offer-product',
          price_override: 360000,
        },
      ],
      error: null,
    });

    const result = await repriceCartItems([variantLine], 'merchant-1');

    // Variant lines are resolved via the override RPC, not condition offers.
    expect(result.priceById).toEqual({ 'variant-line': 360000 });
  });
});
