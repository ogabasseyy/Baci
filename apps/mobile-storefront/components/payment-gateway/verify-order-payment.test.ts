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

  it('forwards the tracking token so guests authorize reference verification', async () => {
    const fetchMock = mockFetch((url: string) =>
      String(url).includes('/api/payments/verify')
        ? new Response(JSON.stringify(completedVerification), { status: 200 })
        : new Response(JSON.stringify(pendingTrackedOrder), { status: 200 })
    );

    await verifyOrderPaymentForCompletion({
      orderId: 'order-1',
      trackingToken: 'track-1',
      reference: 'ref-1',
    });

    // Sessionless guests have no Bearer [REDACTED] the verify route uses the token
    // as proof-bound authorization; without it the route returns 403
    // and the client would collapse terminal outcomes to transient.
    const verifyCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/api/payments/verify')
    );
    expect(verifyCall).toBeDefined();
    const verifyInit = verifyCall?.[1] as { body?: unknown } | undefined;
    expect(JSON.parse(verifyInit?.body as string)).toEqual({
      reference: 'ref-1',
      trackingToken: 'track-1',
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

  it.each([
    { outcome: 'order_cancelled' },
    { outcome: 'order_skipped' },
  ])('preserves a captured $outcome finalization as reconciliation', async ({
    outcome,
  }) => {
    mockFetch(
      () =>
        new Response(
          JSON.stringify({
            success: true,
            status: 'success',
            finalizationOutcome: outcome,
            orderId: 'order-1',
          }),
          { status: 200 }
        )
    );

    // Callers route to the reconciliation state instead of the generic
    // "Order Confirmed" — and never record a paid conversion.
    await expect(
      verifyOrderPaymentForCompletion({
        orderId: 'order-1',
        reference: 'ref-1',
      })
    ).resolves.toEqual({ paid: false, reconciliation: outcome });
  });

  it('keeps a foreign cancelled envelope transient instead of reconciling', async () => {
    mockFetch((url: string) =>
      String(url).includes('/api/payments/verify')
        ? new Response(
            JSON.stringify({
              success: true,
              status: 'success',
              finalizationOutcome: 'order_cancelled',
              orderId: 'order-9',
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
    ).resolves.toEqual({ paid: false });
  });

  it('reconciles a refunded tracked order without reference verification', async () => {
    // A refund proves capture: reconciliation, never confirmation.
    const fetchMock = mockFetch(
      () =>
        new Response(
          JSON.stringify({
            order: {
              id: 'order-1',
              order_number: 'ORD-1',
              payment_status: 'refunded',
              total: 5000,
            },
          }),
          { status: 200 }
        )
    );

    await expect(
      verifyOrderPaymentForCompletion({
        orderId: 'order-1',
        trackingToken: 'track-1',
      })
    ).resolves.toEqual({ paid: false, reconciliation: 'order_skipped' });
    // Terminal server state: no reference lookup is attempted.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails an ordinary cancelled tracked order as unpaid terminal', async () => {
    // A cancelled row proves no capture: terminal failure with the
    // error/retry path — never the "Payment Received" reconciliation
    // state. With no reference available the row short-circuits with no
    // verification lookup; a supplied reference is verified first (see
    // the late-capture regression below).
    const fetchMock = mockFetch(
      () =>
        new Response(
          JSON.stringify({
            order: {
              id: 'order-1',
              order_number: 'ORD-1',
              payment_status: 'cancelled',
              total: 5000,
            },
          }),
          { status: 200 }
        )
    );

    await expect(
      verifyOrderPaymentForCompletion({
        orderId: 'order-1',
        trackingToken: 'track-1',
      })
    ).resolves.toEqual({ paid: false, terminalFailure: 'cancelled' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

  it.each([
    { status: 'failed' },
    { status: 'cancelled' },
    { status: 'abandoned' },
  ])('preserves a definitive $status verification as terminal', async ({
    status,
  }) => {
    mockFetch((url: string) =>
      String(url).includes('/api/payments/verify')
        ? // Real route envelope: success:false with the trusted order
          // identity resolved from the reference's transaction row.
          new Response(
            JSON.stringify({
              success: false,
              status,
              orderId: 'order-1',
              orderNumber: 'ORD-1',
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
    ).resolves.toEqual({ paid: false, terminalFailure: status });
  });

  it('keeps an identity-less failed envelope transient instead of terminal', async () => {
    mockFetch((url: string) =>
      String(url).includes('/api/payments/verify')
        ? new Response(JSON.stringify({ success: false, status: 'failed' }), {
            status: 200,
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

  it('keeps a foreign failed envelope transient instead of terminal', async () => {
    mockFetch((url: string) =>
      String(url).includes('/api/payments/verify')
        ? new Response(
            JSON.stringify({
              success: false,
              status: 'failed',
              orderId: 'order-9',
              orderNumber: 'ORD-9',
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

  it('verifies the reference before rejecting a cancelled tracked row', async () => {
    // Late capture settles through the verify endpoint after the tracked
    // row was flipped to cancelled: the row alone must not report an
    // ordinary cancellation when a reference is available.
    const cancelledTrackedOrder = {
      order: {
        id: 'order-1',
        order_number: 'ORD-1',
        payment_status: 'cancelled',
        total: 5000,
      },
    };
    const fetchMock = mockFetch((url: string) =>
      String(url).includes('/api/payments/verify')
        ? new Response(
            JSON.stringify({
              success: true,
              status: 'success',
              finalizationOutcome: 'order_cancelled',
              orderId: 'order-1',
            }),
            { status: 200 }
          )
        : new Response(JSON.stringify(cancelledTrackedOrder), { status: 200 })
    );

    await expect(
      verifyOrderPaymentForCompletion({
        orderId: 'order-1',
        trackingToken: 'track-1',
        reference: 'ref-1',
      })
    ).resolves.toEqual({ paid: false, reconciliation: 'order_cancelled' });
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes('/api/payments/verify')
      )
    ).toBe(true);
  });

  it('keeps the cancelled row when reference verification stays transient', async () => {
    const cancelledTrackedOrder = {
      order: {
        id: 'order-1',
        order_number: 'ORD-1',
        payment_status: 'cancelled',
        total: 5000,
      },
    };
    mockFetch((url: string) =>
      String(url).includes('/api/payments/verify')
        ? new Response(JSON.stringify({ success: false, status: 'pending' }), {
            status: 200,
          })
        : new Response(JSON.stringify(cancelledTrackedOrder), { status: 200 })
    );

    await expect(
      verifyOrderPaymentForCompletion({
        orderId: 'order-1',
        trackingToken: 'track-1',
        reference: 'ref-1',
      })
    ).resolves.toEqual({ paid: false, terminalFailure: 'cancelled' });
  });

  it('reports terminal failure for a permanent amount-mismatch envelope', async () => {
    mockFetch((url: string) =>
      String(url).includes('/api/payments/verify')
        ? new Response(
            JSON.stringify({
              error: 'Payment amount mismatch',
              code: 'amount_mismatch',
              reference: 'ref-1',
            }),
            { status: 400 }
          )
        : new Response(JSON.stringify(pendingTrackedOrder), { status: 200 })
    );

    // No webhook or poll can repair the attempt: keep the error/retry
    // path with the cart intact instead of transient success navigation.
    await expect(
      verifyOrderPaymentForCompletion({
        orderId: 'order-1',
        trackingToken: 'track-1',
        reference: 'ref-1',
      })
    ).resolves.toEqual({ paid: false, terminalFailure: 'failed' });
  });

  it('reports terminal failure for a missing transaction reference', async () => {
    mockFetch((url: string) =>
      String(url).includes('/api/payments/verify')
        ? new Response(
            JSON.stringify({
              error: 'Transaction not found',
              code: 'reference_not_found',
              reference: 'ref-1',
            }),
            { status: 404 }
          )
        : new Response(JSON.stringify(pendingTrackedOrder), { status: 200 })
    );

    await expect(
      verifyOrderPaymentForCompletion({
        orderId: 'order-1',
        trackingToken: 'track-1',
        reference: 'ref-1',
      })
    ).resolves.toEqual({ paid: false, terminalFailure: 'failed' });
  });

  it('stays transient when the terminal envelope answers another reference', async () => {
    mockFetch((url: string) =>
      String(url).includes('/api/payments/verify')
        ? new Response(
            JSON.stringify({
              error: 'Payment amount mismatch',
              code: 'amount_mismatch',
              reference: 'ref-other',
            }),
            { status: 400 }
          )
        : new Response(JSON.stringify(pendingTrackedOrder), { status: 200 })
    );

    // The reference echo binds the envelope to its request: a skewed
    // envelope for another reference must not fail this order.
    await expect(
      verifyOrderPaymentForCompletion({
        orderId: 'order-1',
        trackingToken: 'track-1',
        reference: 'ref-1',
      })
    ).resolves.toEqual({ paid: false });
  });
});
