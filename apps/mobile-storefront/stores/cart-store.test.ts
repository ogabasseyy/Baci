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
}));
jest.mock('@/lib/read-persisted-checkout-generation', () => ({
  readPersistedCheckoutGeneration: jest.fn(async () => null),
}));

import { resetCartLineSequence, useCartStore } from './cart-store';

const { syncStorage } =
  require('../lib/storage') as typeof import('../lib/storage');

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

  afterEach(() => {
    jest.restoreAllMocks();
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

  it('resets the group negotiation when an item is removed', () => {
    const { addItem } = useCartStore.getState();
    addItem({
      product_id: 'p1',
      slug: 's1',
      name: 'Item A',
      price: 100000,
      quantity: 1,
    });
    addItem({
      product_id: 'p2',
      slug: 's2',
      name: 'Item B',
      price: 200000,
      quantity: 1,
    });

    useCartStore.getState().applyCartWideNegotiation(270000);
    expect(useCartStore.getState().cartWideNegotiationActive).toBe(true);
    expect(
      useCartStore
        .getState()
        .items.every((item) => item.negotiationStatus === 'accepted')
    ).toBe(true);

    const removeId = useCartStore.getState().items[0].id;
    useCartStore.getState().removeItem(removeId);

    const items = useCartStore.getState().items;
    expect(items).toHaveLength(1);
    expect(useCartStore.getState().cartWideNegotiationActive).toBe(false);
    expect(items[0].negotiatedPrice).toBeUndefined();
    expect(items[0].negotiationStatus).toBeUndefined();
  });

  it('resets the group negotiation when a line quantity changes', () => {
    const { addItem } = useCartStore.getState();
    addItem({
      product_id: 'p1',
      slug: 's1',
      name: 'Item A',
      price: 100000,
      quantity: 1,
    });
    addItem({
      product_id: 'p2',
      slug: 's2',
      name: 'Item B',
      price: 200000,
      quantity: 1,
    });

    useCartStore.getState().applyCartWideNegotiation(270000);
    expect(useCartStore.getState().cartWideNegotiationActive).toBe(true);

    // Incrementing a line changes the cart total, so the distributed group deal
    // must reset rather than apply the old negotiated unit price to new units.
    const targetId = useCartStore.getState().items[0].id;
    useCartStore.getState().updateQuantity(targetId, 3);

    const items = useCartStore.getState().items;
    expect(useCartStore.getState().cartWideNegotiationActive).toBe(false);
    expect(items.every((item) => item.negotiatedPrice === undefined)).toBe(
      true
    );
    expect(items.find((item) => item.id === targetId)?.quantity).toBe(3);
  });

  it('resets the group negotiation when a new item is added', () => {
    const { addItem } = useCartStore.getState();
    addItem({
      product_id: 'p1',
      slug: 's1',
      name: 'Item A',
      price: 100000,
      quantity: 1,
    });

    useCartStore.getState().applyCartWideNegotiation(90000);
    expect(useCartStore.getState().cartWideNegotiationActive).toBe(true);

    // Adding a line changes the cart composition, so the group deal resets and
    // existing lines revert to catalog price (no stale negotiated shares).
    addItem({
      product_id: 'p2',
      slug: 's2',
      name: 'Item B',
      price: 200000,
      quantity: 1,
    });

    const items = useCartStore.getState().items;
    expect(items).toHaveLength(2);
    expect(useCartStore.getState().cartWideNegotiationActive).toBe(false);
    expect(items.every((item) => item.negotiatedPrice === undefined)).toBe(
      true
    );
  });

  it('clears the group negotiation on ALL lines when a reprice changes any line', () => {
    const { addItem } = useCartStore.getState();
    addItem({
      product_id: 'p1',
      slug: 's1',
      name: 'Item A',
      price: 100000,
      quantity: 1,
    });
    addItem({
      product_id: 'p2',
      slug: 's2',
      name: 'Item B',
      price: 200000,
      quantity: 1,
    });

    useCartStore.getState().applyCartWideNegotiation(270000);
    expect(useCartStore.getState().cartWideNegotiationActive).toBe(true);

    // Only Item A's live price drifts, but the group total spanned both lines,
    // so both must lose their stale negotiated share — not just the drifted one.
    const [itemA, itemB] = useCartStore.getState().items;
    useCartStore.getState().repriceItems({ [itemA.id]: 120000 });

    const items = useCartStore.getState().items;
    expect(useCartStore.getState().cartWideNegotiationActive).toBe(false);
    expect(items.every((item) => item.negotiatedPrice === undefined)).toBe(
      true
    );
    expect(items.every((item) => item.negotiationStatus === undefined)).toBe(
      true
    );
    // The drifted line took the live price; the other kept its base price.
    expect(items.find((item) => item.id === itemA.id)?.price).toBe(120000);
    expect(items.find((item) => item.id === itemB.id)?.price).toBe(200000);
  });

  it('keeps an individual negotiation on the remaining item when another is removed', () => {
    const { addItem } = useCartStore.getState();
    addItem({
      product_id: 'p1',
      slug: 's1',
      name: 'Item A',
      price: 100000,
      quantity: 1,
    });
    addItem({
      product_id: 'p2',
      slug: 's2',
      name: 'Item B',
      price: 200000,
      quantity: 1,
    });

    const [itemA, itemB] = useCartStore.getState().items;
    useCartStore.getState().applyNegotiatedPrice(itemB.id, 195000);
    expect(useCartStore.getState().cartWideNegotiationActive).toBe(false);

    useCartStore.getState().removeItem(itemA.id);

    const remaining = useCartStore.getState().items;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].negotiatedPrice).toBe(195000);
    expect(remaining[0].negotiationStatus).toBe('accepted');
  });

  it('restores the cart-wide negotiation flag alongside items on rollback', async () => {
    const { addItem } = useCartStore.getState();
    addItem({
      product_id: 'p1',
      slug: 's1',
      name: 'Item A',
      price: 100000,
      quantity: 1,
    });
    useCartStore.getState().applyCartWideNegotiation(90000);
    const snapshot = [...useCartStore.getState().items];
    expect(useCartStore.getState().cartWideNegotiationActive).toBe(true);

    // Simulate a checkout that cleared the cart then failed and rolled back.
    useCartStore.getState().clearCart();
    expect(useCartStore.getState().cartWideNegotiationActive).toBe(false);

    await useCartStore.getState().restoreItems(snapshot, true);

    expect(useCartStore.getState().items).toHaveLength(1);
    expect(useCartStore.getState().cartWideNegotiationActive).toBe(true);
  });

  it('leaves the cart-wide flag untouched when restoreItems omits it', async () => {
    useCartStore.setState({ cartWideNegotiationActive: true });

    await useCartStore.getState().restoreItems([]);

    expect(useCartStore.getState().cartWideNegotiationActive).toBe(true);
  });
});
