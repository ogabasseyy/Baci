import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react-native';
import { trackCheckoutPaymentCompletedOnce } from '@/services/analytics';
import { useJuicywaySettlementCompletion } from './use-juicyway-settlement-completion';

jest.mock('@/services/analytics', () => ({
  trackCheckoutPaymentCompletedOnce: jest.fn(),
}));

const mockTrackCompleted = jest.mocked(trackCheckoutPaymentCompletedOnce);

function mockTrackedOrder(order: Record<string, unknown>) {
  global.fetch = jest.fn(
    async () => new Response(JSON.stringify({ order }), { status: 200 })
  ) as unknown as typeof fetch;
}

const baseParams = {
  orderId: 'order-juicy-1',
  orderNumber: 'ORD-JUICY-1',
  paymentMethod: 'juicyway',
  trackingToken: 'track-juicy-1',
};

describe('useJuicywaySettlementCompletion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTrackCompleted.mockResolvedValue(true);
  });

  it('records completion for a server-confirmed paid Juicyway order', async () => {
    mockTrackedOrder({
      id: 'order-juicy-1',
      order_number: 'ORD-JUICY-1',
      payment_status: 'paid',
      total: 25000,
    });

    renderHook(() => useJuicywaySettlementCompletion(baseParams));

    await waitFor(() =>
      expect(mockTrackCompleted).toHaveBeenCalledWith({
        orderId: 'order-juicy-1',
        orderNumber: 'ORD-JUICY-1',
        paymentMethod: 'juicyway',
        value: 25000,
      })
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('track-order?token=track-juicy-1'),
      expect.anything()
    );
  });

  it('does not complete while the order is still unpaid', async () => {
    mockTrackedOrder({
      id: 'order-juicy-1',
      order_number: 'ORD-JUICY-1',
      payment_status: 'pending',
      total: 25000,
    });

    renderHook(() => useJuicywaySettlementCompletion(baseParams));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    // Let any follow-up completion attempt settle.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockTrackCompleted).not.toHaveBeenCalled();
  });

  it('does not attribute a different order returned for the token', async () => {
    mockTrackedOrder({
      id: 'order-other-9',
      order_number: 'ORD-OTHER-9',
      payment_status: 'paid',
      total: 25000,
    });

    renderHook(() => useJuicywaySettlementCompletion(baseParams));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockTrackCompleted).not.toHaveBeenCalled();
  });

  it('skips the lookup for non-Juicyway methods and missing tokens', () => {
    const fetchSpy = jest.fn(async () => new Response('{}', { status: 200 }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    renderHook(() =>
      useJuicywaySettlementCompletion({
        ...baseParams,
        paymentMethod: 'paystack',
      })
    );
    renderHook(() =>
      useJuicywaySettlementCompletion({
        ...baseParams,
        trackingToken: undefined,
      })
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockTrackCompleted).not.toHaveBeenCalled();
  });
});
