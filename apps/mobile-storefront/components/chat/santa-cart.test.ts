import type { SantaAction } from '@baci/shared/lib';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockAddItem = jest.fn();
const mockLoggerError = jest.fn();
const mockShowCartToast = jest.fn();
const mockAbortSignal = new AbortController().signal;

jest.mock('@/stores/cart-store', () => ({
  useCartStore: { getState: () => ({ addItem: mockAddItem }) },
}));

jest.mock('@/hooks/cart-notifications', () => ({
  showCartToast: (...args: unknown[]) => mockShowCartToast(...args),
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    error: (...args: unknown[]) => mockLoggerError(...args),
    info: jest.fn(),
    warn: jest.fn(),
  }),
}));

jest.mock('./constants', () => ({
  API_BASE_URL: 'https://test.example',
  CHAT_REQUEST_TIMEOUT_MS: 1000,
  SANTA_MERCHANT_SLUG_HEADER: 'x-baci-santa-merchant-slug',
  STOREFRONT_MERCHANT_SLUG_HEADER: 'x-baci-storefront-slug',
}));

import { addSantaWishToCart, fulfilSantaCartActions } from './santa-cart';

const action: SantaAction = {
  type: 'ADD_TO_CART',
  productName: 'iPhone 15',
  price: 800_000,
};

function mockLookup(
  product: unknown,
  ok = true,
  status = 200,
  resolvedMerchantSlug = 'ogabassey'
) {
  global.fetch = jest.fn(async () => ({
    ok,
    status,
    headers: new Headers({
      'x-baci-santa-merchant-slug': resolvedMerchantSlug,
    }),
    json: async () => ({ product }),
  })) as unknown as typeof fetch;
}

describe('addSantaWishToCart', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('adds a real product and applies the granted price as a negotiated price', async () => {
    mockLookup({
      id: 'prod-1',
      name: 'iPhone 15',
      price: 950_000,
      max_discount_percentage: 40,
      image: 'https://img/iphone.jpg',
      manage_stock: true,
      slug: 'iphone-15',
      stock: 5,
    });

    const result = await addSantaWishToCart(action);

    expect(result).toBe(true);
    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        product_id: 'prod-1',
        slug: 'iphone-15',
        name: 'iPhone 15',
        price: 950_000,
        quantity: 1,
        image_url: 'https://img/iphone.jpg',
        max_quantity: 5,
        negotiatedPrice: 800_000,
        negotiationStatus: 'accepted',
      })
    );
    expect(mockShowCartToast).toHaveBeenCalledWith(
      expect.stringContaining('iPhone 15'),
      'success'
    );
  });

  it('adds a synthetic (catalog-less) product without a stock cap or negotiated price when not cheaper', async () => {
    mockLookup({
      id: '',
      name: 'Limited Drop',
      price: 500_000,
      slug: null,
      manage_stock: false,
      stock: 9999,
    });

    const result = await addSantaWishToCart({
      type: 'ADD_TO_CART',
      productName: 'Limited Drop',
      price: 500_000, // equal to price → not a discount
    });

    expect(result).toBe(true);
    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        product_id: '',
        slug: 'limited-drop',
        price: 500_000,
        max_quantity: undefined,
        negotiatedPrice: undefined,
        negotiationStatus: undefined,
      })
    );
  });

  it('coalesces null Supabase fields before adding the cart line', async () => {
    mockLookup({
      id: 'prod-null',
      name: 'Null Stock Phone',
      price: 300_000,
      max_discount_percentage: 40,
      image: null,
      manage_stock: true,
      slug: null,
      stock: null,
    });

    const result = await addSantaWishToCart({
      type: 'ADD_TO_CART',
      productName: 'Null Stock Phone',
      price: 250_000,
    });

    expect(result).toBe(true);
    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        image_url: undefined,
        max_quantity: undefined,
        slug: 'prod-null',
      })
    );
  });

  it('keeps catalog price when the granted price exceeds the product ceiling', async () => {
    mockLookup({
      id: 'prod-free',
      name: 'Free Gift',
      price: 500_000,
      max_discount_percentage: 2,
      manage_stock: false,
    });

    const result = await addSantaWishToCart({
      type: 'ADD_TO_CART',
      productName: 'Free Gift',
      price: 0,
    });

    expect(result).toBe(true);
    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        price: 500_000,
        negotiatedPrice: undefined,
        negotiationStatus: undefined,
      })
    );
  });

  it('honors a granted price at the exact product ceiling', async () => {
    mockLookup({
      id: 'prod-2',
      name: 'Phone',
      price: 100_000,
      max_discount_percentage: 2,
      manage_stock: false,
    });

    const result = await addSantaWishToCart({
      type: 'ADD_TO_CART',
      productName: 'Phone',
      price: 98_000,
    });

    expect(result).toBe(true);
    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        negotiatedPrice: 98_000,
        negotiationStatus: 'accepted',
      })
    );
  });

  it('passes an abort signal to the product lookup request', async () => {
    mockLookup({
      id: 'prod-1',
      name: 'iPhone 15',
      price: 950_000,
      manage_stock: false,
    });

    await addSantaWishToCart(action, mockAbortSignal);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: mockAbortSignal })
    );
  });

  it('rejects malformed product lookup responses', async () => {
    mockLookup({ id: 'prod-1', name: 'iPhone 15', price: '950000' });

    const result = await addSantaWishToCart(action);

    expect(result).toBe(false);
    expect(mockAddItem).not.toHaveBeenCalled();
    expect(mockShowCartToast).toHaveBeenCalledWith(expect.any(String), 'error');
  });

  it('returns false and warns when the product is not found', async () => {
    mockLookup(null);

    const result = await addSantaWishToCart(action);

    expect(result).toBe(false);
    expect(mockAddItem).not.toHaveBeenCalled();
    expect(mockShowCartToast).toHaveBeenCalledWith(
      expect.stringContaining("couldn't find"),
      'error'
    );
  });

  it('returns false without a toast when the lookup request is aborted', async () => {
    global.fetch = jest.fn(() => {
      const error = new Error('The request was aborted');
      error.name = 'AbortError';
      return Promise.reject(error);
    }) as unknown as typeof fetch;

    const result = await addSantaWishToCart(action, mockAbortSignal);

    expect(result).toBe(false);
    expect(mockAddItem).not.toHaveBeenCalled();
    expect(mockLoggerError).not.toHaveBeenCalled();
    expect(mockShowCartToast).not.toHaveBeenCalled();
  });

  it('returns false and surfaces an error toast when the lookup request fails', async () => {
    mockLookup(null, false, 500);

    const result = await addSantaWishToCart(action);

    expect(result).toBe(false);
    expect(mockAddItem).not.toHaveBeenCalled();
    expect(mockShowCartToast).toHaveBeenCalledWith(expect.any(String), 'error');
  });

  it('ignores a lookup resolved for a different storefront', async () => {
    mockLookup(
      {
        id: 'prod-1',
        name: 'iPhone 15',
        price: 950_000,
        manage_stock: false,
      },
      true,
      200,
      'winter-store'
    );

    const result = await addSantaWishToCart(action);

    expect(result).toBe(false);
    expect(mockAddItem).not.toHaveBeenCalled();
  });

  it('sends the expected merchant slug as a non-authoritative assertion', async () => {
    mockLookup({
      id: 'prod-1',
      name: 'iPhone 15',
      price: 950_000,
      manage_stock: false,
    });

    await addSantaWishToCart(action, mockAbortSignal, 'ogabassey');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-baci-storefront-slug': 'ogabassey',
        }),
      })
    );
  });
});

describe('fulfilSantaCartActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fulfils every Santa directive when the reply matches this storefront', async () => {
    mockLookup({
      id: 'prod-1',
      name: 'Phone',
      price: 500_000,
      max_discount_percentage: 40,
      manage_stock: false,
    });

    await fulfilSantaCartActions({
      expectedMerchantSlug: 'ogabassey',
      resolvedMerchantSlug: 'ogabassey',
      signal: mockAbortSignal,
      text: 'Granted ACTION:ADD_TO_CART|PRODUCT:Phone|PRICE:450000.',
    });

    expect(mockAddItem).toHaveBeenCalledTimes(1);
    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Phone' })
    );
  });

  it('ignores Santa directives resolved for a different storefront', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;

    await fulfilSantaCartActions({
      expectedMerchantSlug: 'ogabassey',
      resolvedMerchantSlug: 'winter-store',
      signal: mockAbortSignal,
      text: 'Granted ACTION:ADD_TO_CART|PRODUCT:Phone|PRICE:450000.',
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockAddItem).not.toHaveBeenCalled();
  });

  it('does nothing when the reply has no Santa directives', async () => {
    await fulfilSantaCartActions({
      expectedMerchantSlug: 'ogabassey',
      resolvedMerchantSlug: 'ogabassey',
      signal: mockAbortSignal,
      text: 'Just a friendly hello.',
    });

    expect(mockAddItem).not.toHaveBeenCalled();
  });
});
