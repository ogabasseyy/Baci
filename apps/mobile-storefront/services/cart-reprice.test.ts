import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { CartItem } from '@/stores/cart-store';

type ProductsResponse = {
  data: Array<{
    id: string;
    price: number | string;
    has_condition_offers?: boolean;
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
const mockRpc =
  jest.fn<
    (
      name: string,
      params: { p_variant_ids: string[] }
    ) => Promise<VariantsResponse>
  >();
const mockGetOffers =
  jest.fn<
    (
      productIds: string[]
    ) => Promise<Record<
      string,
      Array<{ id: string; price: number | null }>
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
    mockGetOffers.mockReset();
    productQuery.in.mockResolvedValue({ data: [], error: null });
    mockRpc.mockResolvedValue({ data: [], error: null });
    mockGetOffers.mockResolvedValue({});
  });

  it('skips catalog reads when the merchant scope is missing', async () => {
    const result = await repriceCartItems([createCartItem()], '');

    expect(result).toEqual({ priceById: {}, changes: [] });
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('skips catalog reads when the cart is empty even with a valid merchant', async () => {
    const result = await repriceCartItems([], 'merchant-1');

    expect(result).toEqual({ priceById: {}, changes: [] });
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
    mockRpc.mockResolvedValue({
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
      'id, price, has_condition_offers'
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

  it('fails open when product lookup fails', async () => {
    productQuery.in.mockResolvedValue({
      data: null,
      error: { message: 'products unavailable' },
    });

    const result = await repriceCartItems([createCartItem()], 'merchant-1');

    expect(result).toEqual({ priceById: {}, changes: [] });
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
    mockRpc.mockResolvedValue({
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

  it('ignores a variant override that belongs to a different product', async () => {
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
    // cart line), so it must be ignored and the base price used instead.
    mockRpc.mockResolvedValue({
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

    expect(result.priceById).toEqual({ 'variant-line': 430000 });
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

  it('skips non-variant lines on products that carry condition offers', async () => {
    // Condition offers (open_box/used) are priced from product_offers, so the
    // base products.price would corrupt the stored offer price.
    const conditionOfferLine = createCartItem({
      id: 'offer-line',
      product_id: 'offer-product',
      condition: 'Open Box',
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

    const result = await repriceCartItems(
      [conditionOfferLine, baseLine],
      'merchant-1'
    );

    // The offer line is left untouched; the base line reprices to live price.
    expect(result.priceById).toEqual({ 'base-line': 410000 });
    expect(result.changes.map((change) => change.id)).toEqual(['base-line']);
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
    mockRpc.mockResolvedValue({
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
