import { expect, it, vi } from 'vitest';
import { persistPendingCheckoutOrder } from '../persist-pending-checkout-order';
import { recoverPendingCheckoutOrder } from './recover-pending-checkout-order';
import { submitCheckoutOrder } from './submit-checkout-order';
import { runCheckoutOrderLifecycle } from './checkout-order-lifecycle';

vi.mock('./recover-pending-checkout-order', () => ({ recoverPendingCheckoutOrder: vi.fn() }));
vi.mock('./submit-checkout-order', () => ({ submitCheckoutOrder: vi.fn() }));
vi.mock('../persist-pending-checkout-order', () => ({ persistPendingCheckoutOrder: vi.fn() }));
vi.mock('@/lib/posthog/capture-checkout-funnel-event', () => ({ captureCheckoutFunnelEventOnce: vi.fn() }));

it('persists the shared-cart UBA review before offering the next payment step', async () => {
  const summary = {
    productSubtotalKobo: 10_000, eligibleSubtotalKobo: 10_000, ineligibleSubtotalKobo: 0,
    discountKobo: 500, assuranceFeeKobo: 0, taxKobo: 750, shippingKobo: 0,
    giftWrappingKobo: 0, payableKobo: 10_250, mixedBasket: false,
  };
  vi.mocked(recoverPendingCheckoutOrder).mockResolvedValue({
    kind: 'submit', pendingOrder: { reusableOrder: null, clearStoredOrder: false },
  });
  vi.mocked(submitCheckoutOrder).mockResolvedValue({
    order: { id: 'order-1', tracking_token: 'tracking-proof', currency: 'NGN', total: 102.5 },
    wallet: null, amountDueToGateway: 102.5, redvaultSummary: summary,
  });
  const setReady = vi.fn();
  await runCheckoutOrderLifecycle({
    reuse: { paymentMethod: 'uba_redvault' } as never,
    recoveryContext: {} as never,
    submit: { orderRequest: { shared_cart: { cart_id: 'cart-1' } } } as never,
    customer: { email: 'ada@example.test', phone: '+2348031234567', merchantId: 'merchant-1' },
    fingerprint: 'uba_redvault:{"items":[{"product_id":"fixture"}]}',
    paymentMethod: 'uba_redvault', itemCount: 1, shipping: 0, subtotal: 100, tax: 7.5,
    fallbackTotal: 102.5, currencyFallback: 'NGN',
    shippingAddress: { address: 'Pickup at Store', city: 'Lagos', state: 'Lagos' },
    merchantCountry: 'NG', onRedvaultSummary: vi.fn(), onOrderCreated: vi.fn(), onPendingSnapshot: vi.fn(),
    redvaultReview: {
      enabled: true, customerName: 'Ada Test',
      checkoutFingerprint: 'uba_redvault:{"items":[{"product_id":"fixture"}]}',
      setReady, releaseSubmission: vi.fn(),
    },
  });
  const saved = vi.mocked(persistPendingCheckoutOrder).mock.calls[0]?.[0];
  expect(saved?.redvaultReview).toEqual({ ready: setReady.mock.calls[0]?.[0], summary });
});
