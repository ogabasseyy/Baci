import { describe, expect, it } from 'vitest';
import samples from './__fixtures__/webhook-samples.json';
import type { OxygenWebhookEvent } from './webhook';
import { receiveOxygenWebhook } from './webhook-receiver';

const payload = {
  phone_number: '08000000000',
  transaction_reference: 'txn-example-001',
  amount_deducted: '145135.00',
  amount_sent: '145135.00',
  loan_request_reference: 'fe448e69-9e01-47b6-a1f9-f90ab6455ea8',
};
const config = {
  partnerReference: 'partner-example',
  auth: {
    mode: 'API_KEY' as const,
    apiKey: 'example-key',
    apiSecret: 'example-secret',
  },
};
const headers = {
  'content-type': 'application/json',
  api_key: 'example-key',
  api_secret: 'example-secret',
};
const request = (
  body: unknown = payload,
  customHeaders: HeadersInit = headers
) =>
  new Request('https://example.test/hook', {
    method: 'POST',
    headers: customHeaders,
    body: JSON.stringify(body),
  });

describe('Oxygen callback receiver', () => {
  it('rejects a settlement for another partner before accepting it', async () => {
    const accepted: OxygenWebhookEvent[] = [];
    const response = await receiveOxygenWebhook(
      request({
        ...samples['Direct partner settlement callback'],
        partner_reference: 'another-partner',
      }),
      config,
      async (event) => {
        accepted.push(event);
        return 'accepted';
      }
    );
    expect(response.status).toBe(403);
    expect(accepted).toEqual([]);
  });
  it('keeps the acknowledgement pending while durable acceptance is pending', async () => {
    let persist: ((result: 'accepted') => void) | undefined;
    let acked = false;
    const response = receiveOxygenWebhook(
      request(),
      config,
      async () =>
        new Promise<'accepted'>((resolve) => {
          persist = resolve;
        })
    ).then((result) => {
      acked = true;
      return result;
    });
    // Drain the request stream and enter acceptance without relying on wall time.
    for (let tick = 0; !persist && tick < 50; tick++) await Promise.resolve();
    expect(persist).toBeDefined();
    expect(acked).toBe(false);
    persist?.('accepted');
    expect((await response).status).toBe(200);
  });
  it('authenticates before accepting and acknowledges only after persistence completes', async () => {
    const accepted: OxygenWebhookEvent[] = [];
    const response = await receiveOxygenWebhook(
      request(),
      config,
      async (event) => {
        accepted.push(event);
        return 'accepted';
      }
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(accepted).toMatchObject([
      { kind: 'transaction', amountSentMinor: 14513500 },
    ]);
  });
  it.each([
    { ...headers, api_secret: 'wrong' },
    { 'content-type': 'application/json', api_key: 'example-key' },
    { ...headers, api_key: '' },
  ])('does not accept unauthenticated callback %#', async (customHeaders) => {
    const accepted: OxygenWebhookEvent[] = [];
    const response = await receiveOxygenWebhook(
      request(payload, customHeaders),
      config,
      async (event) => {
        accepted.push(event);
        return 'accepted';
      }
    );
    expect(response.status).toBe(401);
    expect(accepted).toEqual([]);
  });
  it('fails closed with empty configured credentials', async () => {
    const response = await receiveOxygenWebhook(
      request(),
      {
        ...config,
        auth: { mode: 'API_KEY', apiKey: '', apiSecret: '' },
      },
      async () => 'accepted'
    );
    expect(response.status).toBe(503);
  });
  it.each([
    {
      auth: { mode: 'BEARER' as const, apiKey: 'example-key' },
      authorization: 'Bearer example-key',
    },
    {
      auth: {
        mode: 'BASIC' as const,
        apiKey: 'example-key',
        apiSecret: 'example-secret',
      },
      authorization: 'Basic ZXhhbXBsZS1rZXk6ZXhhbXBsZS1zZWNyZXQ=',
    },
  ])('accepts the documented $auth.mode authentication', async ({
    auth,
    authorization,
  }) => {
    const response = await receiveOxygenWebhook(
      request(payload, {
        'content-type': 'application/json',
        authorization,
      }),
      { ...config, auth },
      async () => 'accepted'
    );
    expect(response.status).toBe(200);
  });
  it('acknowledges an atomically detected duplicate without returning sensitive payload', async () => {
    const response = await receiveOxygenWebhook(
      request(),
      config,
      async () => 'duplicate'
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
  });
  it('returns retryable failure on persistence failure without leaking errors', async () => {
    const response = await receiveOxygenWebhook(request(), config, async () => {
      throw new Error('secret database details');
    });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('secret database details');
  });
  it('rejects malformed JSON', async () => {
    const response = await receiveOxygenWebhook(
      new Request('https://example.test', {
        method: 'POST',
        headers,
        body: '{',
      }),
      config,
      async () => 'accepted'
    );
    expect(response.status).toBe(400);
  });
  it('rejects an unsupported event without accepting it', async () => {
    const response = await receiveOxygenWebhook(
      request({ ...payload, webhook_type: 'unknown' }),
      config,
      async () => 'accepted'
    );
    expect(response.status).toBe(400);
  });
  it('rejects oversized bodies even without content-length', async () => {
    const response = await receiveOxygenWebhook(
      request({ text: 'x'.repeat(262145) }),
      config,
      async () => 'accepted'
    );
    expect(response.status).toBe(413);
  });
  it('requires JSON and POST', async () => {
    expect(
      (
        await receiveOxygenWebhook(
          request(payload, { ...headers, 'content-type': 'text/plain' }),
          config,
          async () => 'accepted'
        )
      ).status
    ).toBe(415);
    expect(
      (
        await receiveOxygenWebhook(
          new Request('https://example.test'),
          config,
          async () => 'accepted'
        )
      ).status
    ).toBe(405);
  });
});
