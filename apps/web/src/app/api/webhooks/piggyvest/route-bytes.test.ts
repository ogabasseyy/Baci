import { createHash, createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createServiceClient: vi.fn() }));
// Holder for the deterministic key: mock factories below are hoisted above
// imports, so they read the shared derived value instead of a literal secret.
const testSecret = vi.hoisted(() => ({ value: '' }));
testSecret.value = createHash('sha256')
  .update('synthetic-staging-byte-test')
  .digest('hex');
const secret = testSecret.value;

vi.mock('@/env', () => ({
  getPiggyvestWebhookSecret: () => testSecret.value,
  getPiggyvestApiConfig: () => null,
}));
vi.mock('@/lib/piggyvest/webhook-secret-union', async (importOriginal) => {
  const actual = await importOriginal<WebhookSecretUnionModule>();
  return {
    ...actual,
    verifyPiggyvestWebhookSecrets: (input: {
      rawBody: Uint8Array;
      signature: string | null;
    }) => {
      const secret = actual.matchPiggyvestWebhookSecret({
        ...input,
        secrets: [testSecret.value],
      });
      // Family binding is covered by dedicated tests; these suites pin
      // downstream handling with the legacy-authorized family.
      return secret
        ? { status: 'verified' as const, secret, families: ['legacy'] as const }
        : { status: 'invalid' as const };
    },
  };
});
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => withCaptureRpc(mocks.createServiceClient()),
}));

import { POST } from './route';
import { withCaptureRpc } from './route.capture-test-support';

type WebhookSecretUnionModule =
  typeof import('@/lib/piggyvest/webhook-secret-union');

beforeEach(() => vi.clearAllMocks());

describe('webhook raw request regression', () => {
  it('authenticates original invalid UTF-8 bytes without replacing them first', async () => {
    const rawBody = new Uint8Array([0xff]);
    const signature = createHmac('sha512', secret)
      .update(rawBody)
      .digest('hex');
    const request = new NextRequest(
      'https://staging.example.com/api/webhooks/piggyvest',
      {
        method: 'POST',
        body: rawBody,
        headers: { 'x-pvb-signature': signature },
      }
    );
    const response = await POST(request);

    // Capture happens before parsing. A failed quarantine write leaves the
    // captured delivery retryable for the provider.
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      received: true,
      captured: true,
      processing: 'retry',
      code: 'PIGGYVEST_PROCESSING_RETRY',
    });
    expect(mocks.createServiceClient).toHaveBeenCalledOnce();

    // Replacing the invalid byte before verification changes the HMAC.
    const replaced = await POST(
      new NextRequest('https://staging.example.com/api/webhooks/piggyvest', {
        method: 'POST',
        body: '\ufffd',
        headers: { 'x-pvb-signature': signature },
      })
    );
    expect(replaced.status).toBe(401);
    expect(await replaced.json()).toMatchObject({
      received: false,
      code: 'PIGGYVEST_INVALID_SIGNATURE',
    });
  });

  it('does not create a database client when the request stream fails', async () => {
    const request = new NextRequest(
      'https://staging.example.com/api/webhooks/piggyvest',
      {
        method: 'POST',
        body: '{}',
      }
    );
    // Lock the stream so the bounded reader's getReader() fails like a
    // genuinely broken stream.
    request.body?.getReader();

    const response = await POST(request);

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: 'PIGGYVEST_BODY_UNAVAILABLE',
    });
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
  });

  it('rejects oversized bodies without creating a database client', async () => {
    const rawBody = 'x'.repeat(70 * 1024);
    const signature = createHmac('sha512', secret)
      .update(rawBody)
      .digest('hex');
    const request = new NextRequest(
      'https://staging.example.com/api/webhooks/piggyvest',
      {
        method: 'POST',
        body: rawBody,
        headers: { 'x-pvb-signature': signature },
      }
    );

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      code: 'PIGGYVEST_BODY_TOO_LARGE',
    });
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
  });
});
