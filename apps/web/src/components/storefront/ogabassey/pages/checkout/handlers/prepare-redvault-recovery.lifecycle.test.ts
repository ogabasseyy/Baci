import { beforeEach, expect, it, vi } from 'vitest';
import { persistPendingCheckoutOrder } from '../persist-pending-checkout-order';
import { runCheckoutOrderLifecycle } from './checkout-order-lifecycle';
import { recoverPendingCheckoutOrder } from './recover-pending-checkout-order';
import { submitCheckoutOrder } from './submit-checkout-order';

vi.mock('./recover-pending-checkout-order', () => ({
  recoverPendingCheckoutOrder: vi.fn(),
}));
vi.mock('./submit-checkout-order', () => ({ submitCheckoutOrder: vi.fn() }));
vi.mock('../persist-pending-checkout-order', () => ({
  persistPendingCheckoutOrder: vi.fn(),
}));
vi.mock('@/lib/posthog/capture-checkout-funnel-event', () => ({
  captureCheckoutFunnelEventOnce: vi.fn(),
}));

const merchantId = '11111111-1111-4111-8111-111111111111';
const cartId = '22222222-2222-4222-8222-222222222222';
const sessionId = '44444444-4444-4444-8444-444444444444';
const attemptKey = `baci:uba-uncertain-checkout:${merchantId}`;
const fingerprint = `uba_redvault:${JSON.stringify({
  merchantId,
  customerEmail: 'ada@example.com',
  items: [{ id: 'product-1' }],
})}`;
const summary = {
  productSubtotalKobo: 10000,
  eligibleSubtotalKobo: 10000,
  ineligibleSubtotalKobo: 0,
  discountKobo: 500,
  assuranceFeeKobo: 0,
  taxKobo: 750,
  shippingKobo: 0,
  giftWrappingKobo: 0,
  payableKobo: 10250,
  mixedBasket: false,
};
const requestBody = {
  merchant_id: merchantId,
  customer_email: 'ada@example.com',
  customer_name: 'Ada Customer',
  customer_phone: '08000000000',
  items: [
    { product_id: 'product-1', name: 'Test phone', quantity: 1, price: 100 },
  ],
  subtotal: 100,
  payment_method: 'uba_redvault',
  shared_cart: {
    cart_id: cartId,
    cart_version: 1,
    checkout_generation: 1,
    checkout_session_id: sessionId,
  },
};

function options(): Parameters<typeof runCheckoutOrderLifecycle>[0] {
  return {
    reuse: { paymentMethod: 'uba_redvault' } as never,
    recoveryContext: {} as never,
    submit: {
      getIdempotencyKey: async () => 'attempt-key',
      orderRequest: requestBody as never,
      paymentMethod: 'uba_redvault',
      total: 102.5,
      onVoucherRejected: vi.fn(),
      onPendingOrderInvalidated: vi.fn(),
      onShippingRateRejected: vi.fn(),
      getOrderErrorMessage: () => 'failed',
    },
    customer: { email: 'ada@example.com', phone: '08000000000', merchantId },
    fingerprint,
    paymentMethod: 'uba_redvault',
    itemCount: 1,
    shipping: 0,
    subtotal: 100,
    tax: 7.5,
    fallbackTotal: 102.5,
    currencyFallback: 'NGN',
    shippingAddress: { address: 'Store pickup', city: 'Lagos', state: 'Lagos' },
    merchantCountry: 'NG',
    onRedvaultSummary: vi.fn(),
    onOrderCreated: vi.fn(),
    onPendingSnapshot: vi.fn(),
    redvaultReview: {
      enabled: true,
      customerName: 'Ada Customer',
      checkoutFingerprint: fingerprint,
      setReady: vi.fn(),
      releaseSubmission: vi.fn(),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  vi.mocked(recoverPendingCheckoutOrder).mockResolvedValue({
    kind: 'submit',
    pendingOrder: { reusableOrder: null, clearStoredOrder: false },
  });
});

it('keeps the original checkout request and identity when both order responses are lost', async () => {
  vi.mocked(submitCheckoutOrder).mockImplementation(async (input) => {
    input.onBeforeBoundRedvaultSend?.({
      idempotencyKey: 'attempt-key',
      orderRequest: requestBody as never,
    });
    throw new TypeError('offline');
  });
  await expect(runCheckoutOrderLifecycle(options())).rejects.toThrow('offline');
  const saved = JSON.parse(sessionStorage.getItem(attemptKey) ?? 'null');
  expect(saved).toMatchObject({
    merchantId,
    fingerprint,
    idempotencyKey: 'attempt-key',
    orderRequest: requestBody,
  });
});

it('retains the attempt if the returned UBA review cannot be restored', async () => {
  vi.mocked(submitCheckoutOrder).mockImplementation(async (input) => {
    input.onBeforeBoundRedvaultSend?.({
      idempotencyKey: 'attempt-key',
      orderRequest: requestBody as never,
    });
    return {
      order: { id: 'order-1', currency: 'NGN', total: 102.5 },
      wallet: null,
      amountDueToGateway: 102.5,
    };
  });
  await expect(runCheckoutOrderLifecycle(options())).rejects.toThrow(/review/i);
  expect(persistPendingCheckoutOrder).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(attemptKey)).not.toBeNull();
});

it('retains the attempt if saving the returned order fence fails', async () => {
  vi.mocked(submitCheckoutOrder).mockImplementation(async (input) => {
    input.onBeforeBoundRedvaultSend?.({
      idempotencyKey: 'attempt-key',
      orderRequest: requestBody as never,
    });
    return {
      order: {
        id: 'order-1',
        tracking_token: 'tracking-token',
        currency: 'NGN',
        total: 102.5,
      },
      wallet: null,
      amountDueToGateway: 102.5,
      redvaultSummary: summary,
    };
  });
  vi.mocked(persistPendingCheckoutOrder).mockImplementation(() => {
    throw new Error('storage failed');
  });
  await expect(runCheckoutOrderLifecycle(options())).rejects.toThrow(
    'storage failed'
  );
  expect(sessionStorage.getItem(attemptKey)).not.toBeNull();
});
