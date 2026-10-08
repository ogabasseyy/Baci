import { jest } from '@jest/globals';
import { syncStorage } from '../lib/storage';

const mockMerchantSlug: { current: string } = {
  current: 'ogabassey',
};
const mockSmartCartPro: { current: boolean } = {
  current: true,
};
jest.mock('@/lib/config', () => ({
  CONFIG: {
    get MERCHANT_SLUG() {
      return mockMerchantSlug.current;
    },
    get ENABLE_SMART_CART_PRO() {
      return mockSmartCartPro.current;
    },
  },
}));

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
  it('defaults new lines to assurance and preserves an opt-out when adding again', () => {
    const product = {
      product_id: 'assured-phone',
      slug: 'assured-phone',
      name: 'Phone',
      price: 100000,
      quantity: 1,
    };
    useCartStore.getState().addItem(product);
    const [line] = useCartStore.getState().items;
    expect(line.hasAssurance).toBe(true);
    useCartStore.getState().toggleAssurance(line.id);
    useCartStore.getState().addItem(product);
    expect(useCartStore.getState().items[0]).toMatchObject({
      hasAssurance: false,
      quantity: 2,
    });
    useCartStore.getState().toggleAssurance(line.id);
    expect(useCartStore.getState().items[0].hasAssurance).toBe(true);
  });

  it('respects an explicit assurance opt-out on a new line', () => {
    useCartStore.getState().addItem({
      product_id: 'unassured-phone',
      slug: 'unassured-phone',
      name: 'Phone',
      price: 100000,
      quantity: 1,
      hasAssurance: false,
    });
    expect(useCartStore.getState().items[0].hasAssurance).toBe(false);
  });

  it('applies the latest explicit assurance choice when lines merge', () => {
    const id = { product_id: 'merge-phone', slug: 'merge-phone' } as const;
    useCartStore.getState().addItem({
      ...id,
      name: 'Phone',
      price: 100000,
      quantity: 1,
      hasAssurance: true,
    });
    useCartStore.getState().addItem({
      ...id,
      name: 'Phone',
      price: 100000,
      quantity: 1,
      hasAssurance: false,
    });
    expect(useCartStore.getState().items[0]).toMatchObject({
      hasAssurance: false,
      quantity: 2,
    });
    useCartStore.getState().addItem({
      ...id,
      name: 'Phone',
      price: 100000,
      quantity: 1,
    });
    expect(useCartStore.getState().items[0]).toMatchObject({
      hasAssurance: false,
      quantity: 3,
    });
  });

  it('keeps assurance opt-in for non-Ogabassey merchants', () => {
    mockMerchantSlug.current = 'other-store';
    try {
      useCartStore.getState().addItem({
        product_id: 'other-store-phone',
        slug: 'other-store-phone',
        name: 'Phone',
        price: 100000,
        quantity: 1,
      });
      expect(useCartStore.getState().items[0].hasAssurance).toBe(false);
    } finally {
      mockMerchantSlug.current = 'ogabassey';
    }
  });

  it('keeps assurance opt-in when Smart Cart Pro is disabled', () => {
    mockSmartCartPro.current = false;
    try {
      useCartStore.getState().addItem({
        product_id: 'gated-phone',
        slug: 'gated-phone',
        name: 'Phone',
        price: 100000,
        quantity: 1,
      });
      expect(useCartStore.getState().items[0].hasAssurance).toBe(false);
    } finally {
      mockSmartCartPro.current = true;
    }
  });
});

it('retains a stored assurance opt-out through rehydration and a merge', async () => {
  jest.mocked(syncStorage.getItem).mockReturnValueOnce(
    JSON.stringify({
      state: {
        items: [
          {
            id: 'saved',
            product_id: 'p1',
            name: 'Phone',
            slug: 'phone',
            price: 100000,
            quantity: 1,
            hasAssurance: false,
          },
        ],
      },
      version: 0,
    })
  );
  await useCartStore.persist.rehydrate();
  expect(useCartStore.getState().items[0].hasAssurance).toBe(false);
  useCartStore.getState().addItem({
    product_id: 'p1',
    name: 'Phone',
    slug: 'phone',
    price: 100000,
    quantity: 1,
  });
  expect(useCartStore.getState().items[0]).toMatchObject({
    hasAssurance: false,
    quantity: 2,
  });
});
