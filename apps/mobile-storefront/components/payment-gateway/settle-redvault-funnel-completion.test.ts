import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { settleRedvaultFunnelCompletion } from './settle-redvault-funnel-completion';

beforeEach(() => {
  jest.clearAllMocks();
});

const mockClaimCheckoutPurchaseTracking =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockTrackCheckoutPaymentCompleted = jest.fn((_input: unknown) => {});

jest.mock('@/lib/claim-checkout-purchase-tracking', () => ({
  claimCheckoutPurchaseTracking: (...args: unknown[]) =>
    mockClaimCheckoutPurchaseTracking(...args),
}));

jest.mock('@/services/analytics', () => ({
  PAYMENT_COMPLETED_CLAIM_EVENT: 'payment_completed',
  trackCheckoutPaymentCompleted: (input: unknown) =>
    mockTrackCheckoutPaymentCompleted(input),
}));

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    amount: 4000,
    gateway: 'paystack',
    isMountedRef: { current: true },
    orderId: 'order-1',
    orderNumber: 'ORD-1',
    orderTotal: 5000,
    paymentMethod: 'uba_redvault',
    reference: 'ref-1',
    ...overrides,
  } as Parameters<typeof settleRedvaultFunnelCompletion>[0];
}

describe('settleRedvaultFunnelCompletion', () => {
  it('attributes the conversion to the selected method, not the rails gateway', async () => {
    mockClaimCheckoutPurchaseTracking.mockResolvedValue(true);

    const visible = await settleRedvaultFunnelCompletion(baseInput());

    expect(visible).toBe(true);
    expect(mockClaimCheckoutPurchaseTracking).toHaveBeenCalledWith(
      'order-1',
      'payment_completed'
    );
    // Production route shape: Paystack rails with the uba_redvault
    // method — the funnel event must never say Paystack.
    expect(mockTrackCheckoutPaymentCompleted).toHaveBeenCalledTimes(1);
    expect(mockTrackCheckoutPaymentCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        paymentMethod: 'uba_redvault',
        value: 5000,
      })
    );
  });

  it('prefers the canonical total over the residual gateway amount', async () => {
    mockClaimCheckoutPurchaseTracking.mockResolvedValue(true);

    await settleRedvaultFunnelCompletion(
      baseInput({ amount: 1000, orderTotal: 9000 })
    );

    expect(mockTrackCheckoutPaymentCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ value: 9000 })
    );
  });

  it('records nothing when the claim is denied', async () => {
    mockClaimCheckoutPurchaseTracking.mockResolvedValue(false);

    const visible = await settleRedvaultFunnelCompletion(baseInput());

    // Fail closed without a durable claim: a later restored callback
    // could otherwise emit the same conversion again.
    expect(mockTrackCheckoutPaymentCompleted).not.toHaveBeenCalled();
    expect(visible).toBe(true);
  });

  it('reports unmounted when the shopper leaves during the claim', async () => {
    const isMountedRef = { current: true };
    mockClaimCheckoutPurchaseTracking.mockImplementationOnce(async () => {
      isMountedRef.current = false;
      return true;
    });

    const visible = await settleRedvaultFunnelCompletion(
      baseInput({ isMountedRef })
    );

    expect(visible).toBe(false);
    expect(mockTrackCheckoutPaymentCompleted).not.toHaveBeenCalled();
  });
});
