import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recoverFinalizationOrderWriteFailure } from '@/lib/agentic/checkout-bound-order-recovery';
import { createFinalizationOrder } from '@/lib/agentic/checkout-completion-order-creation';
import { releaseFinalizationClaimSafely } from '@/lib/agentic/checkout-finalization-compensation';
import { createAgenticCheckoutOrder } from '@/lib/agentic/checkout-order-dispatch';
import { recordAgenticOrderFinalizationOrderCreated } from '@/lib/agentic/checkout-order-finalization-claim';

vi.mock('@/lib/agentic/checkout-bound-order-recovery', () => ({
  recoverFinalizationOrderWriteFailure: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/agentic/checkout-finalization-compensation', () => ({
  releaseFinalizationClaimSafely: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/agentic/checkout-order-dispatch', () => ({
  createAgenticCheckoutOrder: vi.fn(),
}));
vi.mock('@/lib/agentic/checkout-order-finalization-claim', () => ({
  recordAgenticOrderFinalizationOrderCreated: vi.fn(),
}));
vi.mock('@/lib/agentic/revalidate-agentic-order-product-caches', () => ({
  revalidateAgenticOrderProductCaches: vi.fn().mockResolvedValue(undefined),
}));

const input = {
  finalizationClaim: 'claim-1',
  merchantId: 'merchant-1',
  metadata: {},
  orderPayload: { merchant_id: 'merchant-1' },
  productIds: ['product-1'],
  sessionId: 'session-1',
  sharedCartBound: false,
  supabase: {},
} as never;

describe('createFinalizationOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(releaseFinalizationClaimSafely).mockResolvedValue(undefined);
    vi.mocked(recoverFinalizationOrderWriteFailure).mockResolvedValue(
      undefined as never
    );
  });

  it('returns the created order id and records the marker', async () => {
    vi.mocked(createAgenticCheckoutOrder).mockResolvedValue({
      ok: true,
      orderId: 'order-1',
    } as never);
    vi.mocked(recordAgenticOrderFinalizationOrderCreated).mockResolvedValue({
      recorded: true,
    } as never);
    await expect(createFinalizationOrder(input)).resolves.toEqual({
      ok: true,
      orderId: 'order-1',
    });
  });

  it('passes actionable binding conflicts through and releases the claim', async () => {
    vi.mocked(createAgenticCheckoutOrder).mockResolvedValue({
      error: 'binding stale',
      ok: false,
      status: 409,
      statusText: 'Conflict',
    } as never);
    await expect(createFinalizationOrder(input)).resolves.toEqual({
      error: 'binding stale',
      ok: false,
      status: 409,
    });
    expect(releaseFinalizationClaimSafely).toHaveBeenCalled();
  });

  it('masks non-actionable failures as a 500', async () => {
    vi.mocked(createAgenticCheckoutOrder).mockResolvedValue({
      error: 'db down',
      ok: false,
      status: 500,
      statusText: 'Error',
    } as never);
    await expect(createFinalizationOrder(input)).resolves.toEqual({
      error: 'Order creation failed',
      ok: false,
      status: 500,
    });
  });

  it('recovers when the creation marker is not recorded', async () => {
    vi.mocked(createAgenticCheckoutOrder).mockResolvedValue({
      ok: true,
      orderId: 'order-1',
    } as never);
    vi.mocked(recordAgenticOrderFinalizationOrderCreated).mockResolvedValue({
      error: 'marker failed',
      recorded: false,
    } as never);
    await expect(createFinalizationOrder(input)).resolves.toEqual({
      error: 'Database error',
      ok: false,
      status: 500,
    });
    expect(recoverFinalizationOrderWriteFailure).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1', sharedCartBound: false })
    );
  });
});
