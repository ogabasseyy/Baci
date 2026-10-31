// @vitest-environment node
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildSyntheticDvaSession } from './build-synthetic-dva-session';
import { buildSyntheticPaystackOutcome } from './build-synthetic-paystack-outcome';
import { signPaystackWebhook } from './sign-paystack-webhook';
import { SYNTHETIC_MERCHANT_A } from './synthetic-merchants';

const SESSION = buildSyntheticDvaSession(SYNTHETIC_MERCHANT_A, {
  orderId: null,
  totalAmount: 79.96,
});

describe('signPaystackWebhook', () => {
  it('repeats the identical, identically signed webhook for a duplicate', () => {
    const { webhooks } = buildSyntheticPaystackOutcome(
      'duplicate_webhook',
      SESSION
    );
    const [first, second] = webhooks.map((event) =>
      signPaystackWebhook(event, 'synthetic-secret')
    );

    expect(first).toEqual(second);
    expect(first.signature).toMatch(/^[0-9a-f]{128}$/);
  });

  it('signs the exact raw body with HMAC-SHA512 under the given secret', () => {
    const [event] = buildSyntheticPaystackOutcome(
      'paid_exact',
      SESSION
    ).webhooks;
    const { rawBody, signature } = signPaystackWebhook(
      event,
      'synthetic-secret'
    );

    expect(rawBody).toBe(JSON.stringify(event));
    expect(signature).toBe(
      createHmac('sha512', 'synthetic-secret').update(rawBody).digest('hex')
    );
    expect(signPaystackWebhook(event, 'another-secret').signature).not.toBe(
      signature
    );
  });
});
