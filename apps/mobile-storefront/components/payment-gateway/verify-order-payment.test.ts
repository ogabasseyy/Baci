import { describe, expect, it, jest } from '@jest/globals';
import { verifyOrderPaymentForCompletion } from './verify-order-payment';

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

  it('reports unpaid when nothing verifiable is available', async () => {
    const fetchMock = mockFetch(() => new Response('{}', { status: 500 }));

    await expect(
      verifyOrderPaymentForCompletion({ orderId: 'order-1' })
    ).resolves.toEqual({ paid: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
