import { Alert } from 'react-native';
import type { NativeCheckoutSnapshot } from '@/schemas/cart-checkout-snapshot';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';
import {
  buildCheckoutOrderRequest,
  createCheckoutSnapshot,
  mapCartItemsToOrderItems,
} from './checkout-order-builders';
import { resolveSharedCartCheckoutBinding } from './resolve-shared-cart-checkout-binding';

const merchantId = '11111111-1111-4111-8111-111111111111';
const cartId = '22222222-2222-4222-8222-222222222222';
const productId = '33333333-3333-4333-8333-333333333333';
const items = [
  {
    id: 'line',
    product_id: productId,
    name: 'Phone',
    slug: 'phone',
    price: 100,
    quantity: 3,
  },
];
const review: NativeCheckoutSnapshot = {
  merchantId,
  cartId,
  cartVersion: 7,
  generation: 2,
  checkoutSessionId: '44444444-4444-4444-8444-444444444444',
  estimates: {
    subtotalMinor: 24000,
    currency: 'NGN',
    lineCount: 1,
    unavailableCount: 0,
  },
  lines: [
    {
      id: 'line',
      productId,
      variantId: null,
      condition: 'new',
      options: {},
      quantity: 2,
      validatedUnitPriceMinor: 12000,
      effectiveUnitPriceMinor: 12000,
      negotiatedUnitPriceMinor: null,
      negotiationStatus: null,
      negotiationInvalidated: false,
      voucherToken: null,
      voucherAwardId: null,
      hasAssurance: false,
      assuranceRate: null,
      lastUnitPriceMinor: 10000,
      priceChanged: true,
      available: true,
      unavailableReason: null,
      stockQty: 3,
      manageStock: true,
    },
  ],
};
const snapshot = {
  merchantId,
  cartId,
  version: 7,
  state: 'active' as const,
  currency: 'NGN',
  lines: [],
  subtotalMinor: 0,
  totalMinor: 0,
  estimatedTotals: false,
  expiresAt: '2099-01-01T00:00:00Z',
};
const setStep = jest.fn();
beforeEach(() => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  setStep.mockClear();
  useNativeSharedCartStore.setState({
    enabled: true,
    snapshot,
    checkoutReview: review,
  });
});
afterEach(() => jest.restoreAllMocks());
it('submits only authoritative reviewed quantities/prices with the exact generation binding', () => {
  const result = resolveSharedCartCheckoutBinding({
    itemsSnapshot: items,
    setStep,
  });
  expect(result).toMatchObject({
    binding: {
      cart_id: cartId,
      cart_version: 7,
      checkout_generation: 2,
      checkout_session_id: review.checkoutSessionId,
    },
    items: [{ id: 'line', quantity: 2, price: 120 }],
  });
  expect(items[0]).toMatchObject({ quantity: 3, price: 100 });
  expect(setStep).not.toHaveBeenCalled();
});
it.each([
  { ...snapshot, version: 8 },
  { ...snapshot, merchantId: '55555555-5555-4555-8555-555555555555' },
  { ...snapshot, cartId: '55555555-5555-4555-8555-555555555555' },
])('blocks stale/foreign review without downgrading to unbound checkout', (live) => {
  useNativeSharedCartStore.setState({ snapshot: live });
  expect(
    resolveSharedCartCheckoutBinding({ itemsSnapshot: items, setStep })
  ).toBeNull();
  expect(setStep).toHaveBeenCalledWith('review');
});
it('blocks unavailable reviewed items', () => {
  useNativeSharedCartStore.setState({
    checkoutReview: {
      ...review,
      lines: [{ ...review.lines[0], available: false }],
    },
  });
  expect(
    resolveSharedCartCheckoutBinding({ itemsSnapshot: items, setStep })
  ).toBeNull();
  expect(setStep).toHaveBeenCalledWith('review');
});
it('blocks missing product hydration and empty reviewed carts', () => {
  expect(
    resolveSharedCartCheckoutBinding({ itemsSnapshot: [], setStep })
  ).toBeNull();
  useNativeSharedCartStore.setState({
    checkoutReview: { ...review, lines: [] },
  });
  expect(
    resolveSharedCartCheckoutBinding({ itemsSnapshot: items, setStep })
  ).toBeNull();
  expect(setStep).toHaveBeenCalledTimes(2);
});
it('leaves genuinely legacy checkout unbound when shared carts are disabled', () => {
  useNativeSharedCartStore.setState({ enabled: false });
  expect(
    resolveSharedCartCheckoutBinding({ itemsSnapshot: items, setStep })
  ).toEqual({ items });
});

it.each([
  ['prize', null, 120, 2],
  [null, 'award', 120, 2],
  ['prize', 'award', 0, 1],
] as const)('keeps voucher classification and quantity aligned with the reviewed binding for %s/%s', (voucherToken, voucherAwardId, price, quantity) => {
  useNativeSharedCartStore.setState({
    checkoutReview: {
      ...review,
      lines: [
        {
          ...review.lines[0],
          voucherToken,
          voucherAwardId,
          quantity,
          effectiveUnitPriceMinor: price * 100,
        },
      ],
    },
  });
  const result = resolveSharedCartCheckoutBinding({
    itemsSnapshot: items,
    setStep,
  });
  expect(result).toMatchObject({
    binding: {
      cart_id: cartId,
      cart_version: 7,
      checkout_generation: 2,
      checkout_session_id: review.checkoutSessionId,
    },
    items: [{ quantity, price }],
  });
  expect(items[0]).toMatchObject({ quantity: 3, price: 100 });
});

it.each([
  ['prize', null, 2, 118],
  [null, 'award', 2, 118],
  ['prize', 'award', 1, 0],
] as const)('projects canonical voucher pair %s/%s into an API order without changing binding, quantity or valid negotiations', (voucherToken, voucherAwardId, quantity, price) => {
  const canonicalReview = {
    ...review,
    lines: [
      {
        ...review.lines[0],
        voucherToken,
        voucherAwardId,
        quantity,
        negotiatedUnitPriceMinor: 11800,
        negotiationStatus: 'accepted',
        effectiveUnitPriceMinor: price * 100,
      },
    ],
  };
  useNativeSharedCartStore.setState({ checkoutReview: canonicalReview });
  const cached = items.map((item) => ({
    ...item,
    name: 'iPhone 15',
    brand: 'Apple',
    voucher_token: 'cached-token',
    voucher_award_id: 'cached-award',
  }));
  const result = resolveSharedCartCheckoutBinding({
    itemsSnapshot: cached,
    setStep,
  });
  if (!result?.binding) throw new Error('Expected canonical checkout binding');
  const mapped = mapCartItemsToOrderItems(result.items, result.binding);
  const payload = buildCheckoutOrderRequest({
    address: {
      email: 'buyer@example.com',
      firstName: 'Test',
      lastName: 'Buyer',
      phone: '08012345678',
      address: '1 Test Road',
      city: 'Lagos',
      state: 'Lagos',
    },
    customerEmail: 'buyer@example.com',
    customerName: 'Buyer',
    customerPhone: '08012345678',
    deliveryMethod: 'door',
    itemsSnapshot: result.items,
    paymentMethodForOrder: 'card',
    selectedQuote: undefined,
    shippingProvider: undefined,
    snapshot: createCheckoutSnapshot(result.items, 0, 0),
    sharedCartBinding: result.binding,
  });
  expect(payload.shared_cart).toEqual({
    cart_id: cartId,
    cart_version: 7,
    checkout_generation: 2,
    checkout_session_id: review.checkoutSessionId,
  });
  expect(payload.items).toEqual(mapped);
  expect(payload.items[0]).toMatchObject({
    cart_line_id: 'line',
    quantity,
    price,
  });
  if (voucherToken && voucherAwardId) {
    expect(payload.items[0]).toMatchObject({
      voucher_token: voucherToken,
      voucher_award_id: voucherAwardId,
    });
  } else {
    expect(payload.items[0]).not.toHaveProperty('voucher_token');
    expect(payload.items[0]).not.toHaveProperty('voucher_award_id');
    expect(result.items[0].negotiatedPrice).toBe(118);
  }
  expect(cached[0]).toMatchObject({
    voucher_token: 'cached-token',
    voucher_award_id: 'cached-award',
  });
  expect(canonicalReview.lines[0]).toMatchObject({
    voucherToken,
    voucherAwardId,
  });
});

it('preserves the existing legacy token-only redemption transport when canonical checkout is disabled', () => {
  useNativeSharedCartStore.setState({ enabled: false });
  const legacy = [{ ...items[0], voucher_token: 'legacy-token' }];
  const result = resolveSharedCartCheckoutBinding({
    itemsSnapshot: legacy,
    setStep,
  });
  expect(result?.binding).toBeUndefined();
  expect(mapCartItemsToOrderItems(result?.items ?? [])[0]).toMatchObject({
    voucher_token: 'legacy-token',
    price: 100,
    quantity: 3,
  });
});
