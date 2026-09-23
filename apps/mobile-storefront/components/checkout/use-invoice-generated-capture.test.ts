import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react-native';
import { maybeCaptureCheckoutInvoiceGenerated } from './checkout-invoice-claim';
import { useInvoiceGeneratedCapture } from './use-invoice-generated-capture';

jest.mock('./checkout-invoice-claim', () => ({
  maybeCaptureCheckoutInvoiceGenerated: jest.fn(),
}));

const mockCaptureInvoice = jest.mocked(maybeCaptureCheckoutInvoiceGenerated);

function trackedResponse(order: Record<string, unknown>) {
  return {
    order,
    customer: {
      name: 'Ada Buyer',
      email: 'ada@example.com',
      phone: '+2348123456789',
    },
    items: [
      {
        id: 'line-1',
        product_id: 'prod-1',
        product_name: 'Proforma Widget',
        quantity: 2,
        unit_price: 5000,
        total_price: 10000,
        product_image: null,
      },
    ],
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
  orderId: 'order-invoice-1',
  paymentMethod: 'invoice',
  trackingToken: 'track-invoice-1',
  pollIntervalMs: 1000,
  maxAttempts: 3,
};

function pendingTrackedOrder(overrides: Record<string, unknown> = {}) {
  return trackedResponse({
    id: 'order-invoice-1',
    order_number: 'INV-1',
    payment_status: 'unpaid',
    total: 10000,
    currency: 'NGN',
    ...overrides,
  });
}

describe('useInvoiceGeneratedCapture', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('captures once terminal delivery lands on a later poll', async () => {
    jest.useFakeTimers();
    try {
      const fetchCalls = mockFetchSequence([
        pendingTrackedOrder(),
        pendingTrackedOrder({ notification_delivered: true }),
      ]);

      renderHook(() => useInvoiceGeneratedCapture(baseParams));
      await jest.advanceTimersByTimeAsync(0);
      expect(mockCaptureInvoice).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1000);

      await waitFor(() =>
        expect(mockCaptureInvoice).toHaveBeenCalledWith(
          expect.objectContaining({
            selectedPayment: 'invoice',
            orderNumber: 'INV-1',
          })
        )
      );
      expect(mockCaptureInvoice).toHaveBeenCalledTimes(1);
      // The lane stops after delivery: no further polling.
      await jest.advanceTimersByTimeAsync(60_000);
      expect(fetchCalls()).toBe(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('never captures for a paid order', async () => {
    jest.useFakeTimers();
    try {
      const fetchCalls = mockFetchSequence([
        pendingTrackedOrder({ payment_status: 'paid' }),
      ]);

      renderHook(() => useInvoiceGeneratedCapture(baseParams));
      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(60_000);

      expect(mockCaptureInvoice).not.toHaveBeenCalled();
      expect(fetchCalls()).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('stops without capturing when the budget is exhausted', async () => {
    jest.useFakeTimers();
    try {
      const fetchCalls = mockFetchSequence([pendingTrackedOrder()]);

      renderHook(() => useInvoiceGeneratedCapture(baseParams));
      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(60_000);

      expect(fetchCalls()).toBe(3);
      expect(mockCaptureInvoice).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('captures through the email lookup when no token is available', async () => {
    jest.useFakeTimers();
    try {
      mockFetchSequence([
        {
          id: 'order-invoice-1',
          order_number: 'INV-1',
          payment_method: 'invoice',
          payment_status: 'unpaid',
          total: 10000,
          currency: 'NGN',
          notification_delivered: true,
          items: [{ id: 'i-1', quantity: 2, price: 5000 }],
        },
      ]);

      renderHook(() =>
        useInvoiceGeneratedCapture({
          customerEmail: 'ada@example.com',
          orderId: 'order-invoice-1',
          paymentMethod: 'invoice',
          pollIntervalMs: 1000,
          maxAttempts: 3,
        })
      );
      await jest.advanceTimersByTimeAsync(0);

      await waitFor(() =>
        expect(mockCaptureInvoice).toHaveBeenCalledWith(
          expect.objectContaining({
            selectedPayment: 'invoice',
            orderNumber: 'INV-1',
          })
        )
      );
      expect(mockCaptureInvoice).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not poll for non-invoice methods', async () => {
    jest.useFakeTimers();
    try {
      const fetchCalls = mockFetchSequence([pendingTrackedOrder()]);

      renderHook(() =>
        useInvoiceGeneratedCapture({ ...baseParams, paymentMethod: 'paystack' })
      );
      await jest.advanceTimersByTimeAsync(60_000);

      expect(fetchCalls()).toBe(0);
      expect(mockCaptureInvoice).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
