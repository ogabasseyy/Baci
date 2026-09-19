import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react-native';
import { trackCheckoutPaymentCompletedOnce } from '@/services/analytics';
import { useSettlementCompletion } from './use-settlement-completion';

jest.mock('@/services/analytics', () => ({
  trackCheckoutPaymentCompletedOnce: jest.fn(),
}));

const mockTrackCompleted = jest.mocked(trackCheckoutPaymentCompletedOnce);

function trackedResponse(order: Record<string, unknown>) {
  return {
    order,
    customer: {
      name: 'Ada Buyer',
      email: 'ada@example.com',
      phone: '+2348123456789',
    },
  };
}

function mockFetchSequence(responses: Array<Record<string, unknown> | null>) {
  let calls = 0;
  global.fetch = jest.fn(async () => {
    const body = responses[Math.min(calls, responses.length - 1)];
    calls += 1;
    if (!body) {
      return new Response('{}', { status: 500 });
    }
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  return () => calls;
}

const baseParams = {
  orderId: 'order-settle-1',
  orderNumber: 'ORD-SETTLE-1',
  paymentMethod: 'juicyway',
  trackingToken: 'track-settle-1',
  pollIntervalMs: 1000,
  maxAttempts: 3,
};

describe('useSettlementCompletion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTrackCompleted.mockResolvedValue(true);
  });

  it('completes when a pending order settles to paid on a later poll', async () => {
    jest.useFakeTimers();
    try {
      mockFetchSequence([
        trackedResponse({
          id: 'order-settle-1',
          order_number: 'ORD-SETTLE-1',
          payment_status: 'pending',
          subtotal: 24000,
          shipping_cost: 1000,
          total: 25000,
        }),
        trackedResponse({
          id: 'order-settle-1',
          order_number: 'ORD-SETTLE-1',
          payment_status: 'paid',
          subtotal: 24000,
          shipping_cost: 1000,
          total: 25000,
        }),
      ]);

      renderHook(() => useSettlementCompletion(baseParams));
      await jest.advanceTimersByTimeAsync(0);
      expect(mockTrackCompleted).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1000);

      await waitFor(() =>
        expect(mockTrackCompleted).toHaveBeenCalledWith({
          customerEmail: 'ada@example.com',
          customerPhone: '+2348123456789',
          orderId: 'order-settle-1',
          orderNumber: 'ORD-SETTLE-1',
          paymentMethod: 'juicyway',
          shipping: 1000,
          subtotal: 24000,
          value: 25000,
        })
      );
      expect(mockTrackCompleted).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('polls standard bank transfers and stops after the attempt budget', async () => {
    jest.useFakeTimers();
    try {
      const fetchCalls = mockFetchSequence([
        trackedResponse({
          id: 'order-settle-1',
          order_number: 'ORD-SETTLE-1',
          payment_status: 'pending',
          total: 25000,
        }),
      ]);

      renderHook(() =>
        useSettlementCompletion({
          ...baseParams,
          paymentMethod: 'bank_transfer',
        })
      );
      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(5000);

      expect(fetchCalls()).toBe(3);
      expect(mockTrackCompleted).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('never attributes a different order returned for the token', async () => {
    jest.useFakeTimers();
    try {
      mockFetchSequence([
        trackedResponse({
          id: 'order-other-9',
          order_number: 'ORD-OTHER-9',
          payment_status: 'paid',
          total: 25000,
        }),
      ]);

      renderHook(() => useSettlementCompletion(baseParams));
      await jest.advanceTimersByTimeAsync(5000);

      expect(mockTrackCompleted).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('skips the lookup for synchronous methods and missing tokens', () => {
    const fetchSpy = jest.fn(async () => new Response('{}', { status: 200 }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    renderHook(() =>
      useSettlementCompletion({ ...baseParams, paymentMethod: 'wallet' })
    );
    renderHook(() =>
      useSettlementCompletion({ ...baseParams, trackingToken: undefined })
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockTrackCompleted).not.toHaveBeenCalled();
  });
});
