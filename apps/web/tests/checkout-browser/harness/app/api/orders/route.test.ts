import { describe, expect, it } from 'vitest';
import { POST } from './route';

const validOrder = {
  merchant_id: '11111111-1111-4111-8111-111111111111',
  customer_email: 'reviewer@example.test',
  customer_name: 'Test Reviewer',
  customer_phone: '+2348031234567',
  items: [
    {
      id: 'fixture-phone',
      name: 'Checkout test phone',
      quantity: 1,
      price: 100000,
    },
  ],
  subtotal: 100000,
  tax_amount: 7500,
  payment_method: 'card',
  delivery_method: 'pickup',
  shipping_address: { address: 'Store Pickup', city: 'Ikeja', state: 'Lagos' },
};

describe('fixture order creation route', () => {
  it('rejects a missing idempotency key and invalid order payload', async () => {
    const noKey = await POST(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        body: JSON.stringify(validOrder),
      })
    );
    expect(noKey.status).toBe(400);
    const invalid = await POST(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'fixture-key' },
        body: '{}',
      })
    );
    expect(invalid.status).toBe(400);
  });

  it('returns a fixture order carrying the submitted customer identity', async () => {
    const response = await POST(
      new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'fixture-key' },
        body: JSON.stringify(validOrder),
      })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      order: {
        customer_name: validOrder.customer_name,
        customer_email: validOrder.customer_email,
        customer_phone: validOrder.customer_phone,
      },
    });
    expect(response.headers.get('set-cookie')).toContain(
      'checkout-qa-customer-email=reviewer%40example.test'
    );
  });
});
