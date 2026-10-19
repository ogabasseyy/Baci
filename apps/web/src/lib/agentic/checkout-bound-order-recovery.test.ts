import { describe, expect, it, vi } from 'vitest';
import {
  readFinalizationOrderId,
  recoverFinalizationOrderWriteFailure,
  verifyBoundFinalizationOrder,
} from './checkout-bound-order-recovery';
import {
  compensateCreatedOrderAfterFinalizationFailure,
  releaseFinalizationClaimSafely,
} from './checkout-finalization-compensation';

vi.mock('./checkout-finalization-compensation', () => ({
  compensateCreatedOrderAfterFinalizationFailure: vi.fn(),
  releaseFinalizationClaimSafely: vi.fn(),
}));

function fixture(
  paymentStatus: string,
  shippingStatus = 'pending',
  error: unknown = null
) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        payment_status: paymentStatus,
        shipping_status: shippingStatus,
      },
      error,
    }),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  return {
    chain,
    input: {
      finalizationClaim: 'claim',
      merchantId: 'merchant',
      metadata: { agentic: {} },
      orderId: 'order',
      sessionId: 'session',
      supabase: { from: vi.fn(() => chain) } as never,
    },
  };
}

describe('bound finalization recovery', () => {
  it.each([
    'pending',
    'unpaid',
    'paid',
  ])('reads live %s receipt using exact order and merchant', async (status) => {
    const { input, chain } = fixture(status);
    expect(await verifyBoundFinalizationOrder(input)).toEqual({
      ok: true,
      paid: status === 'paid',
    });
    expect(chain.select).toHaveBeenCalledWith(
      'payment_status, shipping_status'
    );
    expect(chain.eq.mock.calls).toEqual([
      ['id', 'order'],
      ['merchant_id', 'merchant'],
    ]);
  });
  it.each([
    ['cancelled', 'pending'],
    ['paid', 'cancelled'],
  ])('releases a canceled receipt claim without cancelling the order again', async (payment, shipping) => {
    vi.clearAllMocks();
    const { input } = fixture(payment, shipping);
    expect(await verifyBoundFinalizationOrder(input)).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(releaseFinalizationClaimSafely).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order' })
    );
    expect(
      compensateCreatedOrderAfterFinalizationFailure
    ).not.toHaveBeenCalled();
  });
  it('releases a claim after a transient lookup failure', async () => {
    vi.clearAllMocks();
    const { input } = fixture('pending', 'pending', new Error('offline'));
    expect(await verifyBoundFinalizationOrder(input)).toEqual({
      ok: false,
      status: 500,
      error: 'Could not verify order',
    });
    expect(releaseFinalizationClaimSafely).toHaveBeenCalledTimes(1);
    expect(releaseFinalizationClaimSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        finalizationClaim: input.finalizationClaim,
        orderId: input.orderId,
        merchantId: input.merchantId,
        sessionId: input.sessionId,
      })
    );
    expect(
      compensateCreatedOrderAfterFinalizationFailure
    ).not.toHaveBeenCalled();
  });
  it('preserves bound receipts while retaining unbound compensation', async () => {
    vi.clearAllMocks();
    const { input } = fixture('pending');
    await recoverFinalizationOrderWriteFailure({
      ...input,
      sharedCartBound: true,
      orderError: 'failed',
    });
    expect(releaseFinalizationClaimSafely).toHaveBeenCalledTimes(1);
    expect(
      compensateCreatedOrderAfterFinalizationFailure
    ).not.toHaveBeenCalled();
    await recoverFinalizationOrderWriteFailure({
      ...input,
      sharedCartBound: false,
      orderError: 'failed',
    });
    expect(
      compensateCreatedOrderAfterFinalizationFailure
    ).toHaveBeenCalledTimes(1);
  });
  it('normalizes saved markers and rejects blank markers', () => {
    expect(
      readFinalizationOrderId({ agentic: { finalization_order_id: ' order ' } })
    ).toBe('order');
    expect(
      readFinalizationOrderId({ agentic: { finalization_order_id: ' ' } })
    ).toBeNull();
  });
});
