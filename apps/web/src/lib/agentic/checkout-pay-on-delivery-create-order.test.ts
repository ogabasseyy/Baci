import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPayOnDeliveryOrder } from '@/lib/agentic/checkout-pay-on-delivery-create-order';

const mocks = vi.hoisted(() => ({
  buildPayOnDeliveryOrderPayload: vi.fn(() => ({ payload: true })),
  createAgenticCheckoutOrder: vi.fn(),
  releasePayOnDeliveryClaimSafely: vi.fn(),
  revalidateAgenticOrderProductCaches: vi.fn(),
}));

vi.mock('@/lib/agentic/checkout-order-dispatch', () => ({
  createAgenticCheckoutOrder: mocks.createAgenticCheckoutOrder,
}));
vi.mock('@/lib/agentic/checkout-pay-on-delivery-compensation', () => ({
  releasePayOnDeliveryClaimSafely: mocks.releasePayOnDeliveryClaimSafely,
}));
vi.mock('@/lib/agentic/checkout-pay-on-delivery-payloads', () => ({
  buildPayOnDeliveryOrderPayload: mocks.buildPayOnDeliveryOrderPayload,
}));
vi.mock('@/lib/agentic/revalidate-agentic-order-product-caches', () => ({
  revalidateAgenticOrderProductCaches:
    mocks.revalidateAgenticOrderProductCaches,
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));

const input = {
  buyer: { email: 'buyer@example.com' },
  finalizationClaim: 'claim-1',
  finalizationMetadata: { agentic: {} },
  merchantId: 'merchant-1',
  orderSession: {
    currency: 'NGN',
    merchant_id: 'merchant-1',
    session_id: 'session-1',
  },
  orderSessionCalc: {
    lineItems: [{ item: { product_id: 'product-1' } }],
  },
  sessionId: 'session-1',
  supabase: {},
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.buildPayOnDeliveryOrderPayload.mockReturnValue({ payload: true });
});

describe('createPayOnDeliveryOrder', () => {
  it('creates the order and revalidates product caches', async () => {
    mocks.createAgenticCheckoutOrder.mockResolvedValue({
      ok: true,
      orderId: 'order-1',
    });

    const result = await createPayOnDeliveryOrder(input);

    expect(result).toEqual({ ok: true, orderId: 'order-1' });
    expect(mocks.revalidateAgenticOrderProductCaches).toHaveBeenCalledWith(
      expect.objectContaining({ productIds: ['product-1'] })
    );
    expect(mocks.releasePayOnDeliveryClaimSafely).not.toHaveBeenCalled();
  });

  it('releases the claim when order creation is rejected', async () => {
    mocks.createAgenticCheckoutOrder.mockResolvedValue({
      ok: false,
      error: 'rejected',
      statusText: 'Bad Request',
    });

    const result = await createPayOnDeliveryOrder(input);

    expect(result).toEqual({ ok: false });
    expect(mocks.releasePayOnDeliveryClaimSafely).toHaveBeenCalledWith(
      expect.objectContaining({ orderError: 'rejected' })
    );
  });

  it('releases the claim when order creation throws', async () => {
    mocks.createAgenticCheckoutOrder.mockRejectedValue(new Error('boom'));

    const result = await createPayOnDeliveryOrder(input);

    expect(result).toEqual({ ok: false });
    expect(mocks.releasePayOnDeliveryClaimSafely).toHaveBeenCalledWith(
      expect.objectContaining({ orderError: expect.any(Error) })
    );
  });

  it('releases the claim when the created order id is missing', async () => {
    mocks.createAgenticCheckoutOrder.mockResolvedValue({
      ok: true,
      orderId: null,
    });

    const result = await createPayOnDeliveryOrder(input);

    expect(result).toEqual({ ok: false });
    expect(mocks.releasePayOnDeliveryClaimSafely).toHaveBeenCalledWith(
      expect.objectContaining({ orderError: 'Missing order id' })
    );
  });
});
