import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from '@/hooks/use-toast';
import { cancelStaleCheckoutOrder } from '../cancel-stale-checkout-order';
import { clearCheckoutIdempotencyKey } from '../checkout-idempotency';
import { recoverTerminalRedvaultReview } from './recover-terminal-redvault-review';

vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));
vi.mock('../cancel-stale-checkout-order', () => ({
  cancelStaleCheckoutOrder: vi.fn(),
}));
vi.mock('../checkout-idempotency', () => ({
  clearCheckoutIdempotencyKey: vi.fn(),
}));

const fingerprint = `uba_redvault:${JSON.stringify({
  merchantId: 'merchant-1',
  customerEmail: 'ada@example.test',
  customerName: 'ada okon',
  items: [{ product_id: 'product-1' }],
})}`;
const ready = {
  orderId: 'order-1',
  orderNumber: 'UBA-1',
  trackingToken: 'tracking-proof',
  customerEmail: 'ada@example.test',
  customerName: 'Ada Okon',
  customerPhone: '+2348031234567',
  checkoutFingerprint: fingerprint,
  billingAddress: {
    line1: 'Pickup at Store',
    city: 'Lagos',
    state: 'Lagos',
    country: 'NG',
  },
  currency: 'NGN',
  total: 102.5,
};
const summary = {
  productSubtotalKobo: 10_000,
  eligibleSubtotalKobo: 10_000,
  ineligibleSubtotalKobo: 0,
  discountKobo: 500,
  assuranceFeeKobo: 0,
  taxKobo: 750,
  shippingKobo: 0,
  giftWrappingKobo: 0,
  payableKobo: 10_250,
  mixedBasket: false,
};
const pending = {
  paymentMethod: 'uba_redvault',
  orderId: ready.orderId,
  orderNumber: ready.orderNumber,
  trackingToken: ready.trackingToken,
  merchantId: 'merchant-1',
  customerEmail: ready.customerEmail,
  customerPhone: ready.customerPhone,
  checkoutFingerprint: fingerprint,
  amountDueToGateway: 102.5,
  createdAt: '2026-10-29T00:00:00.000Z',
  redvaultReview: { ready, summary },
};
const currentFingerprint = `uba_redvault:${JSON.stringify({
  merchantId: 'merchant-1',
  customerEmail: 'ada@example.test',
  customerName: 'ada changed',
  items: [],
})}`;

function options(overrides: Record<string, unknown> = {}) {
  return {
    merchantId: 'merchant-1',
    pendingOrder: pending,
    paymentMethod: 'uba_redvault',
    checkoutFingerprint: currentFingerprint,
    sharedCartEnabled: true,
    sharedCartRef: null,
    checkoutCartEmpty: true,
    waitForResolvedCustomerAuth: vi.fn().mockResolvedValue(false),
    setIsProcessing: vi.fn(),
    setReady: vi.fn(),
    setSummary: vi.fn(),
    clearPending: vi.fn(),
    releaseSubmission: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('recoverTerminalRedvaultReview', () => {
  it('cancels a changed, uninitialized review before asking the shopper to restart', async () => {
    vi.mocked(cancelStaleCheckoutOrder).mockResolvedValue('cancelled');
    const input = options();
    expect(await recoverTerminalRedvaultReview(input as never)).toBe(true);
    expect(cancelStaleCheckoutOrder).toHaveBeenCalledWith(expect.objectContaining({
      isAuthenticated: false,
      orderId: 'order-1',
      trackingToken: 'tracking-proof',
      requireNewCancellation: true,
    }));
    expect(clearCheckoutIdempotencyKey).not.toHaveBeenCalled();
    expect(input.clearPending).toHaveBeenCalledOnce();
    expect(input.setReady).toHaveBeenCalledWith(null);
    expect(input.setSummary).toHaveBeenCalledWith(null);
    expect(input.releaseSubmission).toHaveBeenCalledOnce();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      description: expect.stringContaining('add your items'),
    }));
  });

  it('uses the stored review when the shopper switches payment method', async () => {
    vi.mocked(cancelStaleCheckoutOrder).mockResolvedValue('cancelled');
    const input = options({ paymentMethod: 'paystack' });
    expect(await recoverTerminalRedvaultReview(input as never)).toBe(true);
    expect(input.clearPending).toHaveBeenCalledOnce();
    expect(clearCheckoutIdempotencyKey).not.toHaveBeenCalled();
  });

  it.each(['live', 'failed', 'gone'] as const)(
    'keeps the order fence when cancellation is %s',
    async (result) => {
      vi.mocked(cancelStaleCheckoutOrder).mockResolvedValue(result);
      const input = options();
      expect(await recoverTerminalRedvaultReview(input as never)).toBe(true);
      expect(input.clearPending).not.toHaveBeenCalled();
      expect(input.setReady).not.toHaveBeenCalled();
      expect(clearCheckoutIdempotencyKey).not.toHaveBeenCalled();
      expect(input.releaseSubmission).toHaveBeenCalledOnce();
    }
  );

  it('leaves an unchanged review for the normal confirmation path', async () => {
    const unchanged = `uba_redvault:${JSON.stringify({
      merchantId: 'merchant-1', customerEmail: 'ada@example.test',
      customerName: 'ada okon', items: [],
    })}`;
    expect(await recoverTerminalRedvaultReview(options({ checkoutFingerprint: unchanged }) as never)).toBe(false);
    expect(cancelStaleCheckoutOrder).not.toHaveBeenCalled();
  });

  it.each([
    { sharedCartRef: { cartId: 'new-cart', version: 1 } },
    { checkoutCartEmpty: false },
    { sharedCartEnabled: false },
    { merchantId: 'other-merchant' },
    { pendingOrder: { ...pending, trackingToken: 'different' } },
  ])('does not cancel outside the verified terminal review: %j', async (override) => {
    expect(await recoverTerminalRedvaultReview(options(override) as never)).toBe(false);
    expect(cancelStaleCheckoutOrder).not.toHaveBeenCalled();
  });
});
