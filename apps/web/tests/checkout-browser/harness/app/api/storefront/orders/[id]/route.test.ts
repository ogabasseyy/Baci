import { describe, expect, it } from 'vitest';
import { order } from '../../../../../../setup';
import { GET } from './route';

describe('fixture storefront order lookup route', () => {
  it('requires the seeded order id, tracking token, and merchant slug', async () => {
    const context = { params: Promise.resolve({ id: order.id }) };
    const missingFence = await GET(
      new Request(`http://localhost/api/storefront/orders/${order.id}`),
      context
    );
    expect(missingFence.status).toBe(404);
    const valid = await GET(
      new Request(
        `http://localhost/api/storefront/orders/${order.id}?tracking_token=${order.tracking_token}&merchant_slug=ogabassey`,
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
});
