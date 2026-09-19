import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { claimCheckoutPurchaseTracking } from '@/lib/claim-checkout-purchase-tracking';
import { trackCheckoutOrderCreated } from '@/services/analytics';
import type { CreateOrderRequest, OrderResponse } from './orders.schemas';
import { trackCreatedOrderOnce } from './orders-analytics';

jest.mock('@/lib/claim-checkout-purchase-tracking', () => ({
  claimCheckoutPurchaseTracking: jest.fn(),
}));

jest.mock('@/services/analytics', () => ({
  trackCheckoutOrderCreated: jest.fn(),
}));

const mockClaim = jest.mocked(claimCheckoutPurchaseTracking);
const mockTrack = jest.mocked(trackCheckoutOrderCreated);

function buildOrder(): OrderResponse {
  return {
    order: {
      id: 'order-1',
      order_number: 'BAC-001',
      payment_status: 'pending',
      total: 21500,
    },
  } as unknown as OrderResponse;
}

function buildRequest(): CreateOrderRequest {
  return {
    items: [
      { product_id: 'product-1', quantity: 2 },
      { product_id: 'product-2', quantity: 1 },
    ],
    payment_method: 'paystack',
    shipping_fee: 1500,
    subtotal: 20000,
    tax_amount: 0,
  } as unknown as CreateOrderRequest;
}

describe('trackCreatedOrderOnce', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('emits the canonical order_created map for a fresh order', async () => {
    mockClaim.mockResolvedValue(true);

    await trackCreatedOrderOnce(
      buildOrder(),
      buildRequest(),
      Date.now(),
      'paystack'
    );

    expect(mockClaim).toHaveBeenCalledWith('order-1');
    expect(mockTrack).toHaveBeenCalledTimes(1);
    expect(mockTrack).toHaveBeenCalledWith({
      itemCount: 3,
      orderId: 'order-1',
      orderNumber: 'BAC-001',
      durationMs: expect.any(Number),
      paymentMethod: 'paystack',
      paymentStatus: 'pending',
      shipping: 1500,
      subtotal: 20000,
      tax: 0,
      total: 21500,
    });
  });

  it('falls back to the request payment method and N/A order number', async () => {
    mockClaim.mockResolvedValue(true);
    const order = buildOrder();
    (order.order as { order_number: string | null }).order_number = null;

    await trackCreatedOrderOnce(order, buildRequest(), Date.now(), undefined);

    expect(mockTrack).toHaveBeenCalledWith(
      expect.objectContaining({
        orderNumber: 'N/A',
        paymentMethod: 'paystack',
      })
    );
  });

  it('skips emission for a replayed order whose claim is taken', async () => {
    mockClaim.mockResolvedValue(false);

    await trackCreatedOrderOnce(buildOrder(), buildRequest(), Date.now());

    expect(mockTrack).not.toHaveBeenCalled();
  });

  it('measures duration from the provided start time', async () => {
    mockClaim.mockResolvedValue(true);

    await trackCreatedOrderOnce(
      buildOrder(),
      buildRequest(),
      Date.now() - 1500
    );

    expect(mockTrack).toHaveBeenCalledWith(
      expect.objectContaining({
        durationMs: expect.any(Number),
      })
    );
    const durationMs = (mockTrack.mock.calls[0][0] as { durationMs: number })
      .durationMs;
    expect(durationMs).toBeGreaterThanOrEqual(1500);
  });
});
