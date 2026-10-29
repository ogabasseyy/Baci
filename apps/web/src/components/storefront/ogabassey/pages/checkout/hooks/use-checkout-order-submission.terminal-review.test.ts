import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { cancelStaleCheckoutOrder } from '../cancel-stale-checkout-order';
import { prepareCheckoutOrderSubmission } from '../prepare-checkout-order-submission';
import { useCheckoutOrderSubmission } from './use-checkout-order-submission';

vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));
vi.mock('../cancel-stale-checkout-order', () => ({
  cancelStaleCheckoutOrder: vi.fn().mockResolvedValue('cancelled'),
}));
vi.mock('../prepare-checkout-order-submission', () => ({
  prepareCheckoutOrderSubmission: vi.fn(),
}));

it('releases the reviewed draft when checkout details change after its cart completes', async () => {
  const before = `uba_redvault:${JSON.stringify({
    merchantId: 'merchant-1', customerEmail: 'ada@example.test',
    customerName: 'ada okon', items: [{ product_id: 'product-1' }],
  })}`;
  const after = `uba_redvault:${JSON.stringify({
    merchantId: 'merchant-1', customerEmail: 'ada@example.test',
    customerName: 'ada changed', items: [],
  })}`;
  const ready = {
    orderId: 'order-1', orderNumber: 'UBA-1', trackingToken: 'tracking-proof',
    customerEmail: 'ada@example.test', customerName: 'Ada Okon',
    customerPhone: '+2348031234567', checkoutFingerprint: before,
    billingAddress: { line1: 'Store', city: 'Lagos', country: 'NG' },
    currency: 'NGN', total: 102.5,
  };
  const summary = {
    productSubtotalKobo: 10_000, eligibleSubtotalKobo: 10_000,
    ineligibleSubtotalKobo: 0, discountKobo: 500, assuranceFeeKobo: 0,
    taxKobo: 750, shippingKobo: 0, giftWrappingKobo: 0,
    payableKobo: 10_250, mixedBasket: false,
  };
  const pending = {
    orderId: ready.orderId, trackingToken: ready.trackingToken,
    merchantId: 'merchant-1', customerEmail: ready.customerEmail,
    customerPhone: ready.customerPhone, checkoutFingerprint: before,
    paymentMethod: 'uba_redvault', amountDueToGateway: 102.5,
    createdAt: '2026-10-29T00:00:00.000Z', redvaultReview: { ready, summary },
  };
  const inFlight = { current: false };
  const clearPending = vi.fn();
  const releaseSubmission = vi.fn(() => { inFlight.current = false; });
  const context = {
    account: { waitForResolvedCustomerAuth: vi.fn().mockResolvedValue(false) },
    cart: { cart: [], checkoutCart: [], checkoutCartTotal: 0, sharedCartEnabled: true, sharedCartRef: null },
    contact: { customerEmail: ready.customerEmail, customerPhone: ready.customerPhone, firstName: 'Ada', lastName: 'Changed' },
    delivery: { session: { cost: 0, quotes: { selectedId: '', matchesSelectedMethod: false, items: [] }, address: { addresses: [], selectedId: null, isNewMode: true } }, method: 'pickup', merchantCountry: 'NG', giftWrappingCost: 0 },
    merchant: { id: 'merchant-1', slug: 'ada-store' },
    navigation: { setCurrentStep: vi.fn(), setCompletedSteps: vi.fn() },
    order: { pending, clearPending },
    payment: { session: { method: 'uba_redvault', total: 0, wallet: { remainingAmount: 0, amountUsed: 0 }, redvault: { status: 'idle', orderReady: ready, setOrderReady: vi.fn(), setSummary: vi.fn() }, checkoutValues: { useWalletCredit: false } }, redvaultAvailable: true },
    resumed: { order: null, preferredGateway: null },
    processing: { tryBeginSubmission: vi.fn(() => { inFlight.current = true; return true; }), isOrderInFlightRef: inFlight, setIsProcessing: vi.fn(), releaseSubmission },
  };
  vi.mocked(prepareCheckoutOrderSubmission).mockReturnValue({
    kind: 'ready', delivery: {}, identity: { checkoutFingerprint: after, items: [] },
  } as never);

  const { result } = renderHook(() => useCheckoutOrderSubmission(context as never));
  await act(async () => result.current.handlePlaceOrder());

  expect(cancelStaleCheckoutOrder).toHaveBeenCalledOnce();
  expect(clearPending).toHaveBeenCalledOnce();
  expect(releaseSubmission).toHaveBeenCalledOnce();
});
