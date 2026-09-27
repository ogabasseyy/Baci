import { describe, expect, it } from 'vitest';
import { merchant, shippingQuoteId } from '../../../../../fixtures';
import { order } from '../../../../../setup';
import { POST } from './route';

const validRequest = {
  order_id: order.id,
  merchant_id: merchant.id,
  tracking_token: order.tracking_token,
  customer_email: 'reviewer@example.test',
  payment_method: 'card',
};
const headers = {
  cookie: 'csrf-token=fixture-csrf-token',
  'x-csrf-token': 'fixture-csrf-token',
};
const reviewerHeaders = {
  cookie:
    'csrf-token=fixture-csrf-token; checkout-qa-customer-email=reviewer%40example.test',
  'x-csrf-token': 'fixture-csrf-token',
};

describe('fixture order reuse route', () => {
  it('enforces CSRF, payload validation, and fixture order identity', async () => {
    const noCsrf = await POST(
      new Request('http://localhost/api/orders/reuse', {
        method: 'POST',
        body: JSON.stringify(validRequest),
      })
    );
    expect(noCsrf.status).toBe(403);
    const invalid = await POST(
      new Request('http://localhost/api/orders/reuse', {
        method: 'POST',
        headers,
        body: '{}',
      })
    );
    expect(invalid.status).toBe(400);
    const wrongIdentity = await POST(
      new Request('http://localhost/api/orders/reuse', {
        method: 'POST',
        headers: reviewerHeaders,
        body: JSON.stringify({
          ...validRequest,
          customer_email: 'other@example.test',
        }),
      })
    );
    expect(wrongIdentity.status).toBe(403);
    const missingOrder = await POST(
      new Request('http://localhost/api/orders/reuse', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...validRequest,
          order_id: '66666666-6666-4666-8666-666666666666',
        }),
      })
    );
    expect(missingOrder.status).toBe(404);
  });

  it('returns the seeded pending order for the matching identity', async () => {
    const response = await POST(
      new Request('http://localhost/api/orders/reuse', {
        method: 'POST',
        headers: reviewerHeaders,
        body: JSON.stringify(validRequest),
      })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      order: { ...order, customer_email: 'reviewer@example.test' },
    });
  });

  it('rejects a stale selected shipping quote before reusing the pending order', async () => {
    const response = await POST(
      new Request('http://localhost/api/orders/reuse', {
        method: 'POST',
        headers: reviewerHeaders,
        body: JSON.stringify({
          ...validRequest,
          selected_quote_id: '66666666-6666-4666-8666-666666666666',
        }),
      })
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'Selected shipping quote is no longer available',
    });
  });

  it('accepts the fixture quote when reusing the pending order', async () => {
    const response = await POST(
      new Request('http://localhost/api/orders/reuse', {
        method: 'POST',
        headers: reviewerHeaders,
        body: JSON.stringify({
          ...validRequest,
          selected_quote_id: shippingQuoteId,
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      order: { ...order, customer_email: 'reviewer@example.test' },
    });
  });
});
