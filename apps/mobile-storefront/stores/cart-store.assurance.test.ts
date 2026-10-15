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
jest.mock('@/hooks/useMerchantPaymentSettings', () => ({
  merchantPaymentSettingsQueryKey: ['test-payment-settings'],
}));
jest.mock('@/lib/query-client', () => ({
  queryClient: { getQueryData: jest.fn() },
}));

import { queryClient } from '@/lib/query-client';
import { resetCartLineSequence, useCartStore } from './cart-store';

const getQueryData = queryClient.getQueryData as jest.Mock;

describe('cart-store', () => {
  beforeEach(() => {
    getQueryData.mockReset();
    getQueryData.mockReturnValue({ shipping_insurance_enabled: true });
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

  it('fails new lines to opt-out when the insurance setting is unknown', () => {
    getQueryData.mockReturnValue(undefined);
    useCartStore.getState().addItem({
      product_id: 'unknown-setting-phone',
      slug: 'unknown-setting-phone',
      name: 'Phone',
      price: 100000,
      quantity: 1,
    });
    expect(useCartStore.getState().items[0].hasAssurance).toBe(false);
  });

  it('stamps lines added while unknown so the warm-up can reconcile them', () => {
    getQueryData.mockReturnValue(undefined);
    useCartStore.getState().addItem({
      product_id: 'pending-phone',
      slug: 'pending-phone',
      name: 'Phone',
      price: 100000,
      quantity: 1,
    });
    const [line] = useCartStore.getState().items;
    expect(line.hasAssurance).toBe(false);
    expect(line.assurancePendingSetting).toBe(true);
  });

  it('reconciles pending lines when the setting arrives affirmative', () => {
    getQueryData.mockReturnValue(undefined);
    useCartStore.getState().addItem({
      product_id: 'pending-phone',
      slug: 'pending-phone',
      name: 'Phone',
      price: 100000,
      quantity: 1,
    });

    useCartStore.getState().reconcilePendingAssuranceLines(true);

    const [line] = useCartStore.getState().items;
    expect(line.hasAssurance).toBe(true);
    expect(line.assurancePendingSetting).toBeUndefined();
  });

  it('clears pending lines without flipping when the setting arrives off', () => {
    getQueryData.mockReturnValue(undefined);
    useCartStore.getState().addItem({
      product_id: 'pending-phone',
      slug: 'pending-phone',
      name: 'Phone',
      price: 100000,
      quantity: 1,
    });

    useCartStore.getState().reconcilePendingAssuranceLines(false);

    const [line] = useCartStore.getState().items;
    expect(line.hasAssurance).toBe(false);
    expect(line.assurancePendingSetting).toBeUndefined();
  });

  it('lets an explicit toggle win over later reconciliation', () => {
    getQueryData.mockReturnValue(undefined);
    useCartStore.getState().addItem({
      product_id: 'pending-phone',
      slug: 'pending-phone',
      name: 'Phone',
      price: 100000,
      quantity: 1,
    });
    const [line] = useCartStore.getState().items;
    // Explicitly opting out (false -> true -> false keeps a choice trail);
    // simpler: toggle once to opt in, the flag must clear either way.
    useCartStore.getState().toggleAssurance(line.id);
    expect(
      useCartStore.getState().items[0].assurancePendingSetting
    ).toBeUndefined();

    useCartStore.getState().reconcilePendingAssuranceLines(false);

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

  it('forces voucher lines to opt out without an explicit choice', () => {
    useCartStore.getState().addItem({
      product_id: 'quiz-prize-phone',
      slug: 'quiz-prize-phone',
      name: 'Phone',
      price: 0,
      quantity: 1,
      voucher_award_id: 'award-1',
      voucher_token: 'token-1',
    });
    expect(useCartStore.getState().items[0].hasAssurance).toBe(false);
    useCartStore.getState().addItem({
      product_id: 'quiz-prize-explicit',
      slug: 'quiz-prize-explicit',
      name: 'Phone',
      price: 0,
      quantity: 1,
      voucher_award_id: 'award-2',
      voucher_token: 'token-2',
      hasAssurance: true,
    });
    expect(useCartStore.getState().items[1].hasAssurance).toBe(true);
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
