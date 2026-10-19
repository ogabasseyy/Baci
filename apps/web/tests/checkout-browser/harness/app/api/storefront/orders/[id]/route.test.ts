import { describe, expect, it } from 'vitest';
import { order } from '../../../../../../setup';
import { GET } from './route';

describe('fixture storefront order lookup route', () => {
  it('requires the seeded order id, token, and merchant slug', async () => {
    const context = { params: Promise.resolve({ id: order.id }) };
    const missingFence = await GET(
      new Request(`http://localhost/api/storefront/orders/${order.id}`),
      context
    );
    expect(missingFence.status).toBe(404);

    const valid = await GET(
      new Request(
        `http://localhost/api/storefront/orders/${order.id}?token=${order.tracking_token}&merchant_slug=ogabassey`,
        {
          headers: {
            cookie: 'checkout-qa-customer-email=reviewer%40example.test',
          },
        }
      ),
      context
    );
    expect(valid.status).toBe(200);
    expect(await valid.json()).toEqual({
      ...order,
      customer_email: 'reviewer@example.test',
    });
  });

  it('keeps the legacy tracking_token query alias and rejects bad identity fences', async () => {
    const legacyAlias = await GET(
      new Request(
        `http://localhost/api/storefront/orders/${order.id}?tracking_token=${order.tracking_token}&merchant_slug=ogabassey`
      ),
      { params: Promise.resolve({ id: order.id }) }
    );
    expect(legacyAlias.status).toBe(200);

    const mismatchedFences = [
      {
        id: '44444444-4444-4444-8444-444444444445',
        query: `token=${order.tracking_token}&merchant_slug=ogabassey`,
      },
      {
        id: order.id,
        query: 'token=wrong-token&merchant_slug=ogabassey',
      },
      {
        id: order.id,
        query: `token=${order.tracking_token}&merchant_slug=another-store`,
      },
      {
        id: order.id,
        query: `token=wrong-token&tracking_token=${order.tracking_token}&merchant_slug=ogabassey`,
      },
    ];

    for (const fence of mismatchedFences) {
      const response = await GET(
        new Request(
          `http://localhost/api/storefront/orders/${fence.id}?${fence.query}`
        ),
        { params: Promise.resolve({ id: fence.id }) }
      );
      expect(response.status).toBe(404);
    }
  });
});
