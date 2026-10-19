import { describe, expect, it, vi } from 'vitest';
import { fetchAllJumiaOrders } from './orders';

const integration = { id: 'integration-1' } as never;

describe('fetchAllJumiaOrders', () => {
  it('returns orders from a successful page', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          orders: [
            {
              id: 'order-1',
              number: 1001,
              status: 'created',
              createdAt: '2026-09-02T00:00:00Z',
              shippingAddress: null,
              totalAmount: { currency: 'NGN', value: 1000 },
            },
          ],
          isLastPage: true,
        }),
        { status: 200 }
      )
    );

    const result = await fetchAllJumiaOrders(
      {} as never,
      integration,
      'access-token',
      '2026-09-01T00:00:00Z',
      '2026-09-02T00:00:00Z',
      { apiBase: 'https://vendor-api.example', maxPages: 100 },
      vi.fn()
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('order-1');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/orders?updatedAfter='),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
        }),
      })
    );
    fetchMock.mockRestore();
  });

  it('fails without advancing when Jumia rejects the page', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('temporarily unavailable', { status: 503 })
    );

    await expect(
      fetchAllJumiaOrders(
        {} as never,
        integration,
        'access-token',
        '2026-09-01T00:00:00Z',
        '2026-09-02T00:00:00Z',
        { apiBase: 'https://vendor-api.example', maxPages: 100 },
        vi.fn()
      )
    ).rejects.toThrow('Jumia API error: 503');
    vi.restoreAllMocks();
  });
});
