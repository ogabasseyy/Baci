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

import { POST } from './route';

const validRequest = {
  merchant_id: '11111111-1111-4111-8111-111111111111',
  order_id: '44444444-4444-4444-8444-444444444444',
  customer_email: 'reviewer@example.test',
  customer_name: 'Test Reviewer',
  customer_phone: '+2348031234567',
  gateway: 'korapay',
};

describe('fixture payment initialization route', () => {
  it('rejects malformed payment requests', async () => {
    const response = await POST(
      new Request('http://localhost/api/payments/initialize', {
        method: 'POST',
        body: '{}',
      })
    );
    expect(response.status).toBe(400);
  });

  it('returns a local handoff for success and a safe error for provider failure', async () => {
    scenarioState.value = 'success';
    const success = await POST(
      new Request('http://localhost/api/payments/initialize', {
        method: 'POST',
        body: JSON.stringify(validRequest),
      })
    );
    expect(success.status).toBe(200);
    expect(await success.json()).toMatchObject({
      success: true,
      reference: 'fixture-korapay-reference',
      authorization_url: '/payment-handoff',
    });
    scenarioState.value = 'provider-error';
    const failure = await POST(
      new Request('http://localhost/api/payments/initialize', {
        method: 'POST',
        body: JSON.stringify(validRequest),
      })
    );
    expect(failure.status).toBe(503);
    expect(await failure.json()).toEqual({
      error: 'Fixture provider error. No payment was sent.',
    });
  });
});
