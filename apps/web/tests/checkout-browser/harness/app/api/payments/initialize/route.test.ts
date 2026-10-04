import { describe, expect, it, vi } from 'vitest';

const scenarioState = vi.hoisted(() => ({ value: 'success' }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'checkout-qa-scenario'
        ? { value: scenarioState.value }
        : undefined,
  }),
}));

import { merchant } from '../../../../../fixtures';
import { order } from '../../../../../setup';
import { POST } from './route';

const customerEmail = 'reviewer@example.test';
const validRequest = {
  merchant_id: merchant.id,
  order_id: order.id,
  customer_email: customerEmail,
  customer_name: 'Test Reviewer',
  customer_phone: '+2348031234567',
  gateway: 'korapay',
};

function paymentRequest(body: unknown) {
  return new Request('http://localhost/api/payments/initialize', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: 'checkout-qa-customer-email=reviewer%40example.test',
    },
    body: JSON.stringify(body),
  });
}

describe('fixture payment initialization route', () => {
  it('rejects malformed payment requests', async () => {
    const response = await POST(paymentRequest({ gateway: 'korapay' }));
    expect(response.status).toBe(400);
  });

  it.each([
    'success',
    'provider-error',
  ])('fences the order, merchant, and customer before the %s scenario', async (scenario) => {
    scenarioState.value = scenario;
    const wrongOrder = await POST(
      paymentRequest({
        ...validRequest,
        order_id: '66666666-6666-4666-8666-666666666666',
      })
    );
    expect(wrongOrder.status).toBe(404);
    const wrongEmail = await POST(
      paymentRequest({ ...validRequest, customer_email: 'other@example.test' })
    );
    expect(wrongEmail.status).toBe(404);
    const wrongMerchant = await POST(
      paymentRequest({
        ...validRequest,
        merchant_id: '77777777-7777-4777-8777-777777777777',
      })
    );
    expect(wrongMerchant.status).toBe(403);
  });

  it('returns a local handoff for success and a safe error for provider failure', async () => {
    scenarioState.value = 'success';
    const success = await POST(paymentRequest(validRequest));
    expect(success.status).toBe(200);
    expect(await success.json()).toMatchObject({
      success: true,
      reference: 'fixture-korapay-reference',
      authorization_url: '/payment-handoff',
    });
    scenarioState.value = 'provider-error';
    const failure = await POST(paymentRequest(validRequest));
    expect(failure.status).toBe(503);
    expect(await failure.json()).toEqual({
      error: 'Fixture provider error. No payment was sent.',
    });
  });

  it('matches fixture customer email without case sensitivity', async () => {
    scenarioState.value = 'success';
    const response = await POST(
      paymentRequest({
        ...validRequest,
        customer_email: 'Reviewer@Example.Test',
      })
    );

    expect(response.status).toBe(200);
  });
});
