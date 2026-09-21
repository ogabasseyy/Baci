import { describe, expect, it, jest } from '@jest/globals';
import { getSession } from '@/lib/supabase';
import { verifyOrderPaymentForCompletion } from './verify-order-payment';

jest.mock('@/lib/supabase', () => ({
  getSession: jest.fn(async () => null),
}));

const mockGetSession = jest.mocked(getSession);

function mockFetch(handler: (url: string) => Response) {
  global.fetch = jest.fn(async (url: string) =>
    handler(url)
  ) as unknown as typeof fetch;
  return global.fetch as jest.Mock;
}

const paidTrackedOrder = {
  order: {
    id: 'order-1',
    order_number: 'ORD-1',
    payment_status: 'paid',
    total: 5000,
  },
};

const pendingTrackedOrder = {
  order: {
    id: 'order-1',
    order_number: 'ORD-1',
    payment_status: 'pending',
    total: 5000,
  },
};

const completedVerification = {
  success: true,
  status: 'success',
  finalizationOutcome: 'completed',
  orderId: 'order-1',
  orderTotal: 5000,
};

describe('verifyOrderPaymentForCompletion', () => {
  it('confirms paid from the order lookup without hitting verification', async () => {
    const fetchMock = mockFetch((url: string) =>
      String(url).includes('/api/payments/verify')
        ? new Response('{}', { status: 500 })
        : new Response(JSON.stringify(paidTrackedOrder), { status: 200 })
    );

    await expect(
      verifyOrderPaymentForCompletion({
        orderId: 'order-1',
        trackingToken: 'track-1',
        reference: 'ref-1',
      })
    ).resolves.toEqual({ paid: true, total: 5000 });
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes('/api/payments/verify')
      )
    ).toBe(false);
  });

  it('falls back to reference verification when the lookup is still pending', async () => {
    mockFetch((url: string) =>
      String(url).includes('/api/payments/verify')
        ? new Response(JSON.stringify(completedVerification), { status: 200 })
        : new Response(JSON.stringify(pendingTrackedOrder), { status: 200 })
    );

    await expect(
      verifyOrderPaymentForCompletion({
        orderId: 'order-1',
        trackingToken: 'track-1',
        reference: 'ref-1',
      })
    ).resolves.toEqual({ paid: true, total: 5000 });
  });

  it('retains the pending lookup attribution after reference finalization', async () => {
    const pendingGuestOrder = {
      order: {
        id: 'order-1',
        order_number: 'ORD-1',
        payment_status: 'pending',
        total: 5750,
        subtotal: 5000,
        shipping_cost: 500,
        discount_amount: 0,
      },
      customer: {
        email: 'guest@example.com',
        phone: '+2348123456789',
      },
      items: [
        {
          product_id: 'item-1',
          product_name: 'Test Product',
          quantity: 1,
          unit_price: 5000,
        },
      ],
    };
    mockFetch((url: string) =>
      String(url).includes('/api/payments/verify')
        ? new Response(
            JSON.stringify({ ...completedVerification, orderTotal: 5750 }),
            { status: 200 }
          )
        : new Response(JSON.stringify(pendingGuestOrder), { status: 200 })
    );

    // The finalized conversion must keep the guest identity, line items,
    // and nonzero shipping/tax the pending lookup already returned.
    await expect(
      verifyOrderPaymentForCompletion({
        orderId: 'order-1',
        trackingToken: 'track-1',
        reference: 'ref-1',
      })
    ).resolves.toEqual({
      paid: true,
      customerEmail: 'guest@example.com',
      customerPhone: '+2348123456789',
      items: [
        {
          product_id: 'item-1',
          quantity: 1,
          price: 5000,
          name: 'Test Product',
        },
      ],
      shipping: 500,
      subtotal: 5000,
      tax: 250,
      total: 5750,
    });
  });

  it('rejects a matching-reference redirect whose verification is pending', async () => {
    mockFetch((url: string) =>
      String(url).includes('/api/payments/verify')
        ? new Response(JSON.stringify({ success: false, status: 'pending' }), {
            status: 400,
          })
        : new Response(JSON.stringify(pendingTrackedOrder), { status: 200 })
    );

    await expect(
      verifyOrderPaymentForCompletion({
        orderId: 'order-1',
        trackingToken: 'track-1',
        reference: 'ref-1',
      })
    ).resolves.toEqual({ paid: false });
  });

  it('rejects cancelled finalizations even when the endpoint reports success', async () => {
    mockFetch(
      () =>
        new Response(
          JSON.stringify({
            success: true,
            status: 'success',
            finalizationOutcome: 'order_cancelled',
            orderId: 'order-1',
          }),
          { status: 200 }
        )
    );

    await expect(
      verifyOrderPaymentForCompletion({
        orderId: 'order-1',
        reference: 'ref-1',
      })
    ).resolves.toEqual({ paid: false });
  });

  it('rejects orders that do not match the tracked order', async () => {
    mockFetch((url: string) =>
      String(url).includes('/api/payments/verify')
        ? new Response(
            JSON.stringify({ ...completedVerification, orderId: 'order-9' }),
            { status: 200 }
          )
        : new Response(
            JSON.stringify({
              order: { ...paidTrackedOrder.order, id: 'order-9' },
            }),
            { status: 200 }
          )
    );

    await expect(
      verifyOrderPaymentForCompletion({
        orderId: 'order-1',
        trackingToken: 'track-1',
        reference: 'ref-1',
      })
    ).resolves.toEqual({ paid: false });
  });

  it('rejects a completed envelope that carries no order identity', async () => {
    const { orderId: _omitted, ...envelopeWithoutIdentity } =
      completedVerification;
    void _omitted;
    mockFetch((url: string) =>
      String(url).includes('/api/payments/verify')
        ? new Response(JSON.stringify(envelopeWithoutIdentity), { status: 200 })
        : new Response(JSON.stringify(pendingTrackedOrder), { status: 200 })
    );

    // Version skew or a malformed success response must fail closed: a
    // reference for order B must never prove that order A was paid.
    await expect(
      verifyOrderPaymentForCompletion({
        orderId: 'order-1',
        trackingToken: 'track-1',
        reference: 'ref-1',
      })
    ).resolves.toEqual({ paid: false });
  });

  it('preserves a definitive failed verification as terminal', async () => {
    mockFetch((url: string) =>
      String(url).includes('/api/payments/verify')
        ? new Response(
            JSON.stringify({
              ...completedVerification,
              status: 'failed',
              finalizationOutcome: 'cancelled',
            }),
            { status: 200 }
          )
        : new Response(JSON.stringify(pendingTrackedOrder), { status: 200 })
    );

    // Callers keep the error/retry path instead of navigating to a false
    // "Order Confirmed".
    await expect(
      verifyOrderPaymentForCompletion({
        orderId: 'order-1',
        trackingToken: 'track-1',
        reference: 'ref-1',
      })
    ).resolves.toEqual({ paid: false, terminalFailure: 'failed' });
  });

  it('preserves a definitive cancelled verification as terminal', async () => {
    mockFetch((url: string) =>
      String(url).includes('/api/payments/verify')
        ? new Response(
            JSON.stringify({
              ...completedVerification,
              status: 'cancelled',
              finalizationOutcome: 'cancelled',
            }),
            { status: 200 }
          )
        : new Response(JSON.stringify(pendingTrackedOrder), { status: 200 })
    );

    await expect(
      verifyOrderPaymentForCompletion({
        orderId: 'order-1',
        trackingToken: 'track-1',
        reference: 'ref-1',
      })
    ).resolves.toEqual({ paid: false, terminalFailure: 'cancelled' });
  });

  it('keeps a foreign failed envelope transient instead of terminal', async () => {
    mockFetch((url: string) =>
      String(url).includes('/api/payments/verify')
        ? new Response(
            JSON.stringify({
              ...completedVerification,
              status: 'failed',
              finalizationOutcome: 'cancelled',
              orderId: 'order-9',
            }),
            { status: 200 }
          )
        : new Response(JSON.stringify(pendingTrackedOrder), { status: 200 })
    );

    // Identity-gated like the paid path: order B's failure must never
    // fail order A — it stays pending for settlement polling.
    await expect(
      verifyOrderPaymentForCompletion({
        orderId: 'order-1',
        trackingToken: 'track-1',
        reference: 'ref-1',
      })
    ).resolves.toEqual({ paid: false });
  });

  it('sends the native Bearer [REDACTED] when a session exists', async () => {
    mockGetSession.mockResolvedValueOnce({
      access_token: 'native-token-1',
    } as never);
    const fetchMock = mockFetch(
      () => new Response(JSON.stringify(completedVerification), { status: 200 })
    );

    await expect(
      verifyOrderPaymentForCompletion({
        orderId: 'order-1',
        reference: 'ref-1',
      })
    ).resolves.toEqual({ paid: true, total: 5000 });

    const verifyCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/api/payments/verify')
    );
    expect(verifyCall?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer native-token-1',
        }),
      })
    );
  });

  it('reports unpaid when nothing verifiable is available', async () => {
    const fetchMock = mockFetch(() => new Response('{}', { status: 500 }));

    await expect(
      verifyOrderPaymentForCompletion({ orderId: 'order-1' })
    ).resolves.toEqual({ paid: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
