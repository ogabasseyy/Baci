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

const { syncStorage } =
  require('../lib/storage') as typeof import('../lib/storage');

describe('cart-store reprice', () => {
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

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('resets generated voucher line ids for deterministic test isolation', () => {
    const { addItem } = useCartStore.getState();

    addItem({
      product_id: 'product-1',
      slug: 'redmi-note-14',
      variant_id: 'variant-128',
      name: 'Redmi Note 14',
      price: 0,
      quantity: 1,
      voucher_award_id: 'voucher-award-1',
    });

    const firstId = useCartStore.getState().items[0]?.id;
    resetCartLineSequence();
    useCartStore.setState({ items: [], isLoading: false, lineSequence: 0 });

    addItem({
      product_id: 'product-1',
      slug: 'redmi-note-14',
      variant_id: 'variant-128',
      name: 'Redmi Note 14',
      price: 0,
      quantity: 1,
      voucher_award_id: 'voucher-award-1',
    });

    expect(useCartStore.getState().items[0]?.id).toBe(firstId);
  });

  it('persists the generated line sequence with cart items', () => {
    const { addItem } = useCartStore.getState();

    addItem({
      product_id: 'product-1',
      slug: 'redmi-note-14',
      variant_id: 'variant-128',
      name: 'Redmi Note 14',
      price: 0,
      quantity: 1,
      voucher_award_id: 'voucher-award-1',
    });

    const lastPayload = jest.mocked(syncStorage.setItem).mock.calls.at(-1)?.[1];

    expect(lastPayload).toEqual(expect.any(String));
    expect(JSON.parse(lastPayload as string)).toMatchObject({
      state: {
        lineSequence: 1,
      },
    });
  });

  it('does not reset generated line ids while cart items still exist', () => {
    const { addItem } = useCartStore.getState();

    addItem({
      product_id: 'product-1',
      slug: 'redmi-note-14',
      variant_id: 'variant-128',
      name: 'Redmi Note 14',
      price: 0,
      quantity: 1,
      voucher_award_id: 'voucher-award-1',
    });

    resetCartLineSequence();

    addItem({
      product_id: 'product-1',
      slug: 'redmi-note-14',
      variant_id: 'variant-128',
      name: 'Redmi Note 14',
      price: 0,
      quantity: 1,
      voucher_award_id: 'voucher-award-2',
    });

    const ids = useCartStore.getState().items.map((item) => item.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('reprices a line to the live price and clears a now-stale negotiation', () => {
    const { addItem } = useCartStore.getState();
    addItem({
      product_id: 'product-1',
      slug: 'iphone-xr',
      variant_id: 'variant-64',
      name: 'iPhone XR',
      price: 195000,
      quantity: 1,
    });

    const lineId = useCartStore.getState().items[0].id;
    useCartStore.getState().applyNegotiatedPrice(lineId, 191000);

    useCartStore.getState().repriceItems({ [lineId]: 205000 });

    const item = useCartStore.getState().items[0];
    expect(item.price).toBe(205000);
    expect(item.negotiatedPrice).toBeUndefined();
    expect(item.negotiationStatus).toBeUndefined();
  });

  it('leaves lines untouched when the live price is unchanged or unknown', () => {
    const { addItem } = useCartStore.getState();
    addItem({
      product_id: 'product-1',
      slug: 'iphone-xr',
      variant_id: 'variant-64',
      name: 'iPhone XR',
      price: 205000,
      quantity: 1,
    });
    const lineId = useCartStore.getState().items[0].id;
    useCartStore.getState().applyNegotiatedPrice(lineId, 201000);

    useCartStore
      .getState()
      .repriceItems({ [lineId]: 205000, 'missing-line': 100000 });

    const item = useCartStore.getState().items[0];
    expect(item.price).toBe(205000);
    expect(item.negotiatedPrice).toBe(201000);
    expect(item.negotiationStatus).toBe('accepted');
  });

  it('keeps a negotiated price when the live price drifts within ±₦1 tolerance', () => {
    const { addItem } = useCartStore.getState();
    addItem({
      product_id: 'product-1',
      slug: 'iphone-xr',
      name: 'iPhone XR',
      price: 205000,
      quantity: 1,
    });
    const lineId = useCartStore.getState().items[0].id;
    useCartStore.getState().applyNegotiatedPrice(lineId, 201000);

    // A one-naira rounding difference must not silently clear the negotiation.
    useCartStore.getState().repriceItems({ [lineId]: 205001 });

    const item = useCartStore.getState().items[0];
    expect(item.price).toBe(205000);
    expect(item.negotiatedPrice).toBe(201000);
    expect(item.negotiationStatus).toBe('accepted');
  });
});
