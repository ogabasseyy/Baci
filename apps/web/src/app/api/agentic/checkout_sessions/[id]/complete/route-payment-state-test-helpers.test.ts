import { describe, expect, it } from 'vitest';
import { paymentStateTestHelpers } from './route-payment-state-test-helpers';

describe('paymentStateTestHelpers', () => {
  it('builds a ready session with no order or payment reference', () => {
    const session = paymentStateTestHelpers.makeReadySession();
    expect(session).toMatchObject({
      merchant_id: 'merchant-1',
      order_id: null,
      payment_reference: null,
      session_id: 'agentic_session_1',
      status: 'processing',
    });
  });

  it('builds a complete request carrying the human confirmation', async () => {
    const request = paymentStateTestHelpers.buildCompleteRequest();
    expect(request.method).toBe('POST');
    const body = (await request.json()) as Record<string, unknown>;
    expect(body.payment_data).toEqual({
      provider: 'paystack',
      token: 'confirmed-by-human',
    });
  });
});
