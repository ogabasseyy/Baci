import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPetrockClient } from './petrock-client';

describe('createPetrockClient', () => {
  const fetchMock = vi.fn();
  const client = createPetrockClient({
    baseUrl: 'https://api.petrock.biz/api/reseller/v1/',
    fetchImpl: fetchMock,
    timeoutMs: 5000,
    token: 'test-token',
  });

  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('submits byte-exact dynamic field names and extracts the order UUID', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [[{ order_uuid: 'order-123', reference_id: 'lookup-123' }]],
        }),
        { status: 200 }
      )
    );

    const result = await client.submitOrder({
      feedbackUrl: 'https://example.com/petrock/feedback/token',
      identifier: '490154203237518',
      orderFieldName: 'IMEI or Serial Number ',
      productId: '688',
      referenceId: 'lookup-123',
    });

    expect(result).toMatchObject({
      data: { orderUuid: 'order-123', referenceId: 'lookup-123' },
      ok: true,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.petrock.biz/api/reseller/v1/order');
    expect(init.cache).toBe('no-store');
    expect(new Headers(init.headers).get('authorization')).toBe(
      'Bearer test-token'
    );
    expect(JSON.parse(String(init.body))).toEqual([
      {
        fields: [
          {
            'IMEI or Serial Number ': '490154203237518',
            feedback_url: 'https://example.com/petrock/feedback/token',
            reference_id: 'lookup-123',
            Quantity: 1,
          },
        ],
        product_id: 688,
      },
    ]);
  });

  it('polls only by encoded order UUID', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            order_uuid: 'order/123',
            replay: 'Model: iPhone',
            status: 'success',
          },
        }),
        { status: 200 }
      )
    );

    const result = await client.getOrder('order/123');

    expect(result).toMatchObject({
      data: {
        orderUuid: 'order/123',
        replay: 'Model: iPhone',
        status: 'success',
      },
      ok: true,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.petrock.biz/api/reseller/v1/order?order_uuid=order%2F123'
    );
  });

  it('classifies a request timeout without throwing', async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new Error('timed out'), { name: 'TimeoutError' })
    );

    await expect(
      client.submitOrder({
        feedbackUrl: 'https://example.com/feedback/token',
        identifier: '490154203237518',
        orderFieldName: 'IMEI',
        productId: '1955',
        referenceId: 'lookup-123',
      })
    ).resolves.toMatchObject({ kind: 'timeout', ok: false });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('classifies a response-body network failure without throwing', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockRejectedValue(new Error('connection reset')),
    });

    await expect(
      client.submitOrder({
        feedbackUrl: 'https://example.com/feedback/token',
        identifier: '490154203237518',
        orderFieldName: 'IMEI',
        productId: '1955',
        referenceId: 'lookup-123',
      })
    ).resolves.toMatchObject({ kind: 'network', ok: false });
  });
});
