import { jest } from '@jest/globals';

jest.mock('../lib/storage', () => ({
  syncStorage: {
    getItem: jest.fn(() => null),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));
jest.mock('expo-crypto', () => ({
  randomUUID: () => require('node:crypto').randomUUID(),
}));
jest.mock('@/lib/persist-checkout-generation', () => ({
  persistCheckoutGeneration: jest.fn(async () => undefined),
  persistCheckoutGenerationDetached: jest.fn(),
}));
jest.mock('@/lib/read-persisted-checkout-generation', () => ({
  readPersistedCheckoutGeneration: jest.fn(async () => null),
}));

import { resetCartLineSequence, useCartStore } from './cart-store';

describe('cart-store', () => {
  beforeEach(() => {
    resetCartLineSequence();
    useCartStore.setState({
      items: [],
      isLoading: false,
      lineSequence: 0,
      checkoutGeneration: 'legacy',
      cartWideNegotiationActive: false,
    });
    jest.clearAllMocks();
  });

  it('refreshes image and variant metadata when the same cart line is added again', () => {
    const { addItem } = useCartStore.getState();

    addItem({
      product_id: 'product-1',
      slug: 'redmi-note-14',
      variant_id: 'variant-128',
      name: 'Redmi Note 14',
      price: 220000,
      quantity: 1,
      image_url: undefined,
      color: undefined,
      storage: '128GB',
      condition: 'New',
    });

    addItem({
      product_id: 'product-1',
      slug: 'redmi-note-14',
      variant_id: 'variant-128',
      variant_attributes: {
        color: 'Midnight Black',
        storage: '128GB',
      },
      name: 'Redmi Note 14',
      price: 220000,
      quantity: 1,
      image_url: 'https://cdn.example.com/redmi-note-14-black.jpg',
      color: 'Midnight Black',
      storage: '128GB',
      condition: 'New',
      variant_name: '128GB / Midnight Black',
    });

    const [item] = useCartStore.getState().items;

    expect(item).toMatchObject({
      product_id: 'product-1',
      variant_id: 'variant-128',
      quantity: 2,
      image_url: 'https://cdn.example.com/redmi-note-14-black.jpg',
      color: 'Midnight Black',
      storage: '128GB',
      variant_name: '128GB / Midnight Black',
      variant_attributes: {
        color: 'Midnight Black',
        storage: '128GB',
      },
    });
  });

  it('keeps voucher awards as separate zero-price cart lines for the same SKU', () => {
    const { addItem } = useCartStore.getState();

    addItem({
      product_id: 'product-1',
      slug: 'redmi-note-14',
      variant_id: 'variant-128',
      name: 'Redmi Note 14',
      price: 220000,
      quantity: 2,
      color: 'Midnight Black',
      storage: '128GB',
      condition: 'New',
    });

    const firstVoucherItem = {
      product_id: 'product-1',
      slug: 'redmi-note-14',
      variant_id: 'variant-128',
      name: 'Redmi Note 14',
      price: 0,
      quantity: 3,
      color: 'Midnight Black',
      storage: '128GB',
      condition: 'New',
      voucher_token: 'voucher-token-1',
      voucher_award_id: 'voucher-award-1',
    };

    const secondVoucherItem = {
      ...firstVoucherItem,
      voucher_token: 'voucher-token-2',
      voucher_award_id: 'voucher-award-2',
    };

    addItem(firstVoucherItem);
    addItem(secondVoucherItem);

    const items = useCartStore.getState().items;

    expect(items).toHaveLength(3);
    expect(new Set(items.map((item) => item.id)).size).toBe(3);

    const paidLine = items.find((item) => item.price === 220000);
    expect(paidLine).toMatchObject({
      product_id: 'product-1',
      variant_id: 'variant-128',
      price: 220000,
      quantity: 2,
    });
    expect(paidLine).not.toHaveProperty('voucher_token');
    expect(paidLine).not.toHaveProperty('voucher_award_id');

    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          price: 0,
          quantity: 1,
          voucher_token: 'voucher-token-1',
          voucher_award_id: 'voucher-award-1',
        }),
        expect.objectContaining({
          price: 0,
          quantity: 1,
          voucher_token: 'voucher-token-2',
          voucher_award_id: 'voucher-award-2',
        }),
      ])
    );
  });

  it('keeps token-only voucher cart lines separate from paid SKU lines', () => {
    const { addItem } = useCartStore.getState();

    addItem({
      product_id: 'product-1',
      slug: 'redmi-note-14',
      variant_id: 'variant-128',
      name: 'Redmi Note 14',
      price: 220000,
      quantity: 1,
      color: 'Midnight Black',
      storage: '128GB',
      condition: 'New',
    });

    addItem({
      product_id: 'product-1',
      slug: 'redmi-note-14',
      variant_id: 'variant-128',
      name: 'Redmi Note 14',
      price: 0,
      quantity: 4,
      color: 'Midnight Black',
      storage: '128GB',
      condition: 'New',
      voucher_token: 'voucher-token-only',
    });

    const items = useCartStore.getState().items;

    expect(items).toHaveLength(2);
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ price: 220000, quantity: 1 }),
        expect.objectContaining({
          price: 0,
          quantity: 1,
          voucher_token: 'voucher-token-only',
        }),
      ])
    );
  });

  it('keeps repeated adds of the same voucher entitlement on one cart line', () => {
    const { addItem } = useCartStore.getState();

    const voucherItem = {
      product_id: 'product-1',
      slug: 'redmi-note-14',
      variant_id: 'variant-128',
      name: 'Redmi Note 14',
      price: 0,
      quantity: 5,
      color: 'Midnight Black',
      storage: '128GB',
      condition: 'New',
      voucher_token: 'voucher-token-1',
      voucher_award_id: 'voucher-award-1',
    };

    addItem(voucherItem);
    addItem({
      ...voucherItem,
      image_url: 'https://cdn.example.com/redmi-note-14-black.jpg',
    });

    const items = useCartStore.getState().items;

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      image_url: 'https://cdn.example.com/redmi-note-14-black.jpg',
      price: 0,
      quantity: 1,
      voucher_token: 'voucher-token-1',
      voucher_award_id: 'voucher-award-1',
    });
  });

  it('reconciles stored cart prices by cart line id', () => {
    const { addItem, repriceItems } = useCartStore.getState();

    addItem({
      product_id: 'product-1',
      slug: 'redmi-note-14',
      variant_id: 'variant-128',
      name: 'Redmi Note 14',
      price: 220000,
      quantity: 1,
    });
    addItem({
      product_id: 'product-2',
      slug: 'iphone-13',
      name: 'iPhone 13',
      price: 390000,
      quantity: 1,
    });

    const [firstItem, secondItem] = useCartStore.getState().items;

    repriceItems({
      [firstItem.id]: 225000,
      'missing-line': 1000,
    });

    expect(useCartStore.getState().items).toEqual([
      expect.objectContaining({
        id: firstItem.id,
        price: 225000,
      }),
      expect.objectContaining({
        id: secondItem.id,
        price: 390000,
      }),
    ]);
  });
});
