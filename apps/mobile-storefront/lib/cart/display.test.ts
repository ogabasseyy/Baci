import { hydrateNativeCart, nativeCartInput } from './display';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
const item = {
  product_id: '11111111-1111-4111-8111-111111111111',
  slug: 'phone',
  name: 'Phone',
  price: 999,
  quantity: 3,
  condition: 'New',
  variant_attributes: { engraving: 'Keep CASE' },
  color: 'Blue',
  storage: '128GB',
};
it('preserves all option keys, condition and voucher identity without trusting cached prices', () => {
  // A partial voucher pair is an ordinary line and keeps quantity.
  expect(nativeCartInput({ ...item, voucher_award_id: 'award' })).toMatchObject(
    {
      quantity: 3,
      voucherAwardId: 'award',
    }
  );
  expect(
    nativeCartInput({
      ...item,
      voucher_token: 'tok',
      voucher_award_id: 'award',
    })
  ).toMatchObject({ quantity: 1, voucherToken: 'tok' });
  expect(() => nativeCartInput({ ...item, condition: 'mystery' })).toThrow();
  const offerId = '44444444-4444-4444-8444-444444444444';
  expect(nativeCartInput({ ...item, offer_id: offerId }).item.offerId).toBe(
    offerId
  );
});
it('renders server prices and blocks checkout metadata readiness on missing product hydration', async () => {
  const load = jest.fn().mockResolvedValue(null);
  const snapshot = {
    merchantId: 'merchant-a',
    cartId: 'cart',
    version: 1,
    state: 'active' as const,
    currency: 'NGN',
    subtotalMinor: 1200,
    totalMinor: 1200,
    estimatedTotals: false,
    expiresAt: '2099-01-01T00:00:00Z',
    lines: [
      {
        id: 'server-line',
        item: nativeCartInput(item).item,
        quantity: 2,
        unitPriceMinor: 600,
        lineTotalMinor: 1200,
      },
    ],
  };
  const result = await hydrateNativeCart(
    snapshot,
    [{ ...item, id: 'old-line' }],
    load
  );
  expect(result.metadataReady).toBe(false);
  expect(result.items[0]).toMatchObject({
    id: 'server-line',
    price: 6,
    quantity: 2,
    name: 'Phone',
  });
  expect(load).toHaveBeenCalledWith('merchant-a', item.product_id);
});
it('restores the exact offer id from the server line', async () => {
  const offerId = '44444444-4444-4444-8444-444444444444';
  const result = await hydrateNativeCart(
    {
      merchantId: 'merchant-a',
      cartId: 'cart',
      version: 1,
      state: 'active',
      currency: 'NGN',
      subtotalMinor: 600,
      totalMinor: 600,
      estimatedTotals: false,
      expiresAt: '2099-01-01T00:00:00Z',
      lines: [
        {
          id: 'server-line',
          item: nativeCartInput({ ...item, offer_id: offerId }).item,
          quantity: 1,
          unitPriceMinor: 600,
          lineTotalMinor: 600,
        },
      ],
    },
    [],
    async () => null
  );
  expect(result.items[0]?.offer_id).toBe(offerId);
});
it('never renders a mismatched product projection returned by hydration', async () => {
  const snapshot = {
    merchantId: 'merchant-a',
    cartId: 'cart',
    version: 1,
    state: 'active' as const,
    currency: 'NGN',
    subtotalMinor: 600,
    totalMinor: 600,
    estimatedTotals: false,
    expiresAt: '2099-01-01T00:00:00Z',
    lines: [
      {
        id: 'line',
        item: nativeCartInput(item).item,
        quantity: 1,
        unitPriceMinor: 600,
        lineTotalMinor: 600,
      },
    ],
  };
  const result = await hydrateNativeCart(snapshot, [], async () => ({
    id: 'different-product',
    name: 'Foreign item',
    slug: 'foreign',
  }));
  expect(result.items[0].name).toBe('Item unavailable');
  expect(result.items[0].slug).toBe(item.product_id);
});

it('preserves explicit assurance choices when importing native items', () => {
  expect(nativeCartInput({ ...item, hasAssurance: true }).hasAssurance).toBe(
    true
  );
  expect(nativeCartInput({ ...item, hasAssurance: false }).hasAssurance).toBe(
    false
  );
});
