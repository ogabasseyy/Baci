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
          subtotal: 100000,
          shipping_cost: 0,
          discount_amount: 0,
          total: 100000,
        }),
        {
          ...trackedResponse({
            id: 'order-settle-1',
            order_number: 'ORD-SETTLE-1',
            payment_status: 'paid',
            subtotal: 100000,
            shipping_cost: 0,
            discount_amount: 0,
            total: 107500,
          }),
          items: [
            {
              id: 'line-1',
              product_id: 'prod-1',
              product_name: 'iPhone 15 Pro',
              quantity: 1,
              unit_price: 100000,
              total_price: 100000,
              product_image: null,
            },
          ],
        },
      ]);

      renderHook(() => useSettlementCompletion(baseParams));
      await jest.advanceTimersByTimeAsync(0);
      expect(mockTrackCompleted).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1000);

      await waitFor(() =>
        expect(mockTrackCompleted).toHaveBeenCalledWith({
          customerEmail: 'ada@example.com',
          customerPhone: '+2348123456789',
          items: [
            {
              product_id: 'prod-1',
              quantity: 1,
              price: 100000,
              name: 'iPhone 15 Pro',
            },
          ],
          orderId: 'order-settle-1',
          orderNumber: 'ORD-SETTLE-1',
          paymentMethod: 'juicyway',
          shipping: 0,
          subtotal: 100000,
          tax: 7500,
          value: 107500,
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

  it('keeps a slow-lane watch past the fast budget for delayed settlements', async () => {
    jest.useFakeTimers();
    try {
      const pending = trackedResponse({
        id: 'order-settle-1',
        order_number: 'ORD-SETTLE-1',
        payment_status: 'pending',
        total: 25000,
      });
      const fetchCalls = mockFetchSequence([
        pending,
        pending,
        pending,
        pending,
        trackedResponse({
          id: 'order-settle-1',
          order_number: 'ORD-SETTLE-1',
          payment_status: 'paid',
          subtotal: 25000,
          shipping_cost: 0,
          discount_amount: 0,
          total: 25000,
        }),
      ]);

      renderHook(() =>
        useSettlementCompletion({
          ...baseParams,
          paymentMethod: 'bank_transfer',
          slowPollIntervalMs: 1000,
          slowMaxAttempts: 2,
        })
      );
      // Three fast attempts, then two slow-lane attempts; settlement on
      // the fifth lookup must still record completion.
      await jest.advanceTimersByTimeAsync(0);
      expect(mockTrackCompleted).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(1000);

      await waitFor(() =>
        expect(mockTrackCompleted).toHaveBeenCalledWith(
          expect.objectContaining({
            orderId: 'order-settle-1',
            paymentMethod: 'bank_transfer',
            value: 25000,
          })
        )
      );
      expect(fetchCalls()).toBe(5);
      expect(mockTrackCompleted).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('polls pending CredPal orders to completion after approval', async () => {
    jest.useFakeTimers();
    try {
      mockFetchSequence([
        trackedResponse({
          id: 'order-settle-1',
          order_number: 'ORD-SETTLE-1',
          payment_status: 'pending',
          total: 5000,
        }),
        trackedResponse({
          id: 'order-settle-1',
          order_number: 'ORD-SETTLE-1',
          payment_status: 'paid',
          subtotal: 5000,
          shipping_cost: 0,
          discount_amount: 0,
          total: 5000,
        }),
      ]);

      renderHook(() =>
        useSettlementCompletion({ ...baseParams, paymentMethod: 'credpal' })
      );
      await jest.advanceTimersByTimeAsync(0);
      expect(mockTrackCompleted).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1000);

      await waitFor(() =>
        expect(mockTrackCompleted).toHaveBeenCalledWith(
          expect.objectContaining({
            orderId: 'order-settle-1',
            paymentMethod: 'credpal',
            value: 5000,
          })
        )
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('forwards the route reference in a deferred pending-to-paid completion', async () => {
    jest.useFakeTimers();
    try {
      mockFetchSequence([
        trackedResponse({
          id: 'order-settle-1',
          order_number: 'ORD-SETTLE-1',
          payment_status: 'pending',
          total: 25000,
        }),
        trackedResponse({
          id: 'order-settle-1',
          order_number: 'ORD-SETTLE-1',
          payment_status: 'paid',
          subtotal: 25000,
          shipping_cost: 0,
          discount_amount: 0,
          total: 25000,
        }),
      ]);

      renderHook(() =>
        useSettlementCompletion({
          ...baseParams,
          paymentMethod: 'paystack',
          reference: 'PSK-txn-9',
        })
      );
      await jest.advanceTimersByTimeAsync(0);
      expect(mockTrackCompleted).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1000);

      // The polling path wins the durable claim, so the provider
      // reference must travel with it for reconciliation.
      await waitFor(() =>
        expect(mockTrackCompleted).toHaveBeenCalledWith(
          expect.objectContaining({
            orderId: 'order-settle-1',
            paymentMethod: 'paystack',
            reference: 'PSK-txn-9',
            value: 25000,
          })
        )
      );
      expect(mockTrackCompleted).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('reconciles a deferred juicyway settlement with its provider reference', async () => {
    jest.useFakeTimers();
    try {
      mockFetchSequence([
        trackedResponse({
          id: 'order-settle-1',
          order_number: 'ORD-SETTLE-1',
          payment_status: 'pending',
          total: 575000,
        }),
        trackedResponse({
          id: 'order-settle-1',
          order_number: 'ORD-SETTLE-1',
          payment_status: 'paid',
          subtotal: 575000,
          shipping_cost: 0,
          discount_amount: 0,
          total: 575000,
        }),
      ]);

      renderHook(() =>
        useSettlementCompletion({
          ...baseParams,
          paymentMethod: 'juicyway',
          reference: 'jw-ref-1',
        })
      );
      await jest.advanceTimersByTimeAsync(0);
      expect(mockTrackCompleted).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1000);

      // On-chain detection lands after the shopper reaches success: the
      // polling path consumes the durable claim, so the Juicyway
      // reference forwarded by the crypto modal must travel with it.
      await waitFor(() =>
        expect(mockTrackCompleted).toHaveBeenCalledWith(
          expect.objectContaining({
            orderId: 'order-settle-1',
            paymentMethod: 'juicyway',
            reference: 'jw-ref-1',
            value: 575000,
          })
        )
      );
      expect(mockTrackCompleted).toHaveBeenCalledTimes(1);
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

  it('keeps polling juicyway past the standard budget until the provider window ends', async () => {
    jest.useFakeTimers();
    try {
      // On-chain confirmation can take up to ~30 minutes: settlement at
      // attempt 25 (past the old 18-attempt budget) must still record
      // completion under juicyway's default budget.
      const responses = Array.from({ length: 24 }, () =>
        trackedResponse({
          id: 'order-settle-1',
          order_number: 'ORD-SETTLE-1',
          payment_status: 'pending',
          total: 100000,
        })
      );
      responses.push(
        trackedResponse({
          id: 'order-settle-1',
          order_number: 'ORD-SETTLE-1',
          payment_status: 'paid',
          subtotal: 100000,
          shipping_cost: 0,
          discount_amount: 0,
          total: 100000,
        })
      );
      const fetchCalls = mockFetchSequence(responses);

      renderHook(() =>
        useSettlementCompletion({
          ...baseParams,
          maxAttempts: undefined,
          pollIntervalMs: undefined,
        })
      );
      for (let attempt = 0; attempt < 24; attempt += 1) {
        await jest.advanceTimersByTimeAsync(10_000);
      }

      await waitFor(() =>
        expect(mockTrackCompleted).toHaveBeenCalledWith(
          expect.objectContaining({
            orderId: 'order-settle-1',
            paymentMethod: 'juicyway',
            value: 100000,
          })
        )
      );
      expect(fetchCalls()).toBe(25);
      expect(mockTrackCompleted).toHaveBeenCalledTimes(1);
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
