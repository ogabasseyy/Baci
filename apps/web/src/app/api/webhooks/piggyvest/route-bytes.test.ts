import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createServiceClient: vi.fn() }));
const secret = 'synthetic-staging-byte-test';

vi.mock('@/env', () => ({
  getPiggyvestWebhookSecret: () => 'synthetic-staging-byte-test',
  getPiggyvestApiConfig: () => null,
}));
vi.mock('@/lib/piggyvest/webhook-secret-union', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/lib/piggyvest/webhook-secret-union')
    >();
  return {
    ...actual,
    verifyPiggyvestWebhookSecrets: (input: {
      rawBody: Uint8Array;
      signature: string | null;
    }) => {
      const secret = actual.matchPiggyvestWebhookSecret({
        ...input,
        secrets: ['synthetic-staging-byte-test'],
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
  createServiceClient: () => mocks.createServiceClient(),
}));

import { POST } from './route';

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
    const upsert = vi.fn(() => ({
      select: vi.fn(async () => ({
        data: [{ body_digest: 'synthetic-digest' }],
        error: null,
      })),
    }));
    const from = vi.fn(() => ({ upsert }));
    mocks.createServiceClient.mockReturnValue({ from });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      received: true,
      quarantined: true,
    });
    expect(from).toHaveBeenCalledWith('piggyvest_event_quarantine');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'unparseable', detail: null }),
      { onConflict: 'body_digest', ignoreDuplicates: true }
    );
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
