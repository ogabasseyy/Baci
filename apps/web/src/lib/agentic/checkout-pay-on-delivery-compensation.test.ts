import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  compensatePayOnDeliveryFinalizationFailure,
  releasePayOnDeliveryClaimSafely,
} from '@/lib/agentic/checkout-pay-on-delivery-compensation';

const mocks = vi.hoisted(() => ({
  loggerError: vi.fn(),
  markAgenticCheckoutOrderCanceled: vi.fn(),
  releasePayOnDeliveryFinalizationClaim: vi.fn(),
}));

vi.mock('@/lib/agentic/checkout-order-dispatch', () => ({
  markAgenticCheckoutOrderCanceled: mocks.markAgenticCheckoutOrderCanceled,
}));

vi.mock('@/lib/agentic/checkout-pay-on-delivery-claim', () => ({
  releasePayOnDeliveryFinalizationClaim:
    mocks.releasePayOnDeliveryFinalizationClaim,
}));

vi.mock('@/lib/logger', () => ({ logger: { error: mocks.loggerError } }));

const input = {
  finalizationClaim: 'claim-1',
  merchantId: 'merchant-1',
  metadata: { agentic: { existing: true } },
  orderError: 'marker failed',
  orderId: 'order-1',
  sessionId: 'agentic_session_1',
  supabase: {} as never,
};

describe('pay-on-delivery finalization compensation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.releasePayOnDeliveryFinalizationClaim.mockResolvedValue({
      error: null,
      released: true,
    });
  });

  it('cancels the created order and releases the finalization claim', async () => {
    mocks.markAgenticCheckoutOrderCanceled.mockResolvedValue({
      error: null,
      updated: true,
    });

    await compensatePayOnDeliveryFinalizationFailure(input);

    expect(mocks.markAgenticCheckoutOrderCanceled).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      orderId: 'order-1',
      sessionId: 'agentic_session_1',
      supabase: input.supabase,
    });
    expect(mocks.releasePayOnDeliveryFinalizationClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        finalizationClaim: 'claim-1',
        merchantId: 'merchant-1',
        orderError: 'marker failed',
      })
    );
  });

  it('preserves a bound order and only releases the claim', async () => {
    await compensatePayOnDeliveryFinalizationFailure({
      ...input,
      bound: true,
    });

    expect(mocks.markAgenticCheckoutOrderCanceled).not.toHaveBeenCalled();
    expect(mocks.releasePayOnDeliveryFinalizationClaim).toHaveBeenCalledWith(
      expect.objectContaining({ finalizationClaim: 'claim-1' })
    );
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Pay-on-delivery finalization failed after bound order creation; order preserved',
      })
    );
  });

  it('does not release the claim when order cancellation fails', async () => {
    mocks.markAgenticCheckoutOrderCanceled.mockResolvedValue({
      error: { message: 'db failed' },
      updated: false,
    });

    await compensatePayOnDeliveryFinalizationFailure(input);

    expect(mocks.releasePayOnDeliveryFinalizationClaim).not.toHaveBeenCalled();
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Pay-on-delivery finalization failed after order creation',
      })
    );
  });

  it('does not release the claim when cancellation reports no row updated', async () => {
    mocks.markAgenticCheckoutOrderCanceled.mockResolvedValue({
      error: null,
      updated: false,
    });

    await compensatePayOnDeliveryFinalizationFailure(input);

    expect(mocks.releasePayOnDeliveryFinalizationClaim).not.toHaveBeenCalled();
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Pay-on-delivery finalization failed after order creation',
        error: expect.objectContaining({
          cancellationUpdated: false,
        }),
      })
    );
  });

  it('does not release the claim when order cancellation throws', async () => {
    const thrown = new Error('cancel threw');
    mocks.markAgenticCheckoutOrderCanceled.mockRejectedValue(thrown);

    await compensatePayOnDeliveryFinalizationFailure(input);

    expect(mocks.releasePayOnDeliveryFinalizationClaim).not.toHaveBeenCalled();
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          cancellationError: '{}',
        }),
        message: 'Pay-on-delivery finalization failed after order creation',
      })
    );
  });

  it('logs release exceptions and reports release failure', async () => {
    mocks.releasePayOnDeliveryFinalizationClaim.mockRejectedValue(
      new Error('release failed')
    );

    const released = await releasePayOnDeliveryClaimSafely(input);

    expect(released).toBe(false);
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Pay-on-delivery finalization claim release threw',
      })
    );
  });
});
