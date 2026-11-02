import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  processPiggyvestEvent: vi.fn(),
}));

vi.mock('@/env', () => ({
  getPiggyvestApiConfig: () => ({
    baseUrl: 'https://staging.example.com',
    token: process.env.PVB_SECRET_KEY?.trim() || 'synthetic',
  }),
  getPiggyvestWebhookSecret: () =>
    process.env.PVB_SECRET_KEY?.trim() || undefined,
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => withCaptureRpc(mocks.createServiceClient()),
}));

vi.mock('@/lib/piggyvest/webhook-processor', () => ({
  processPiggyvestEvent: (...args: unknown[]) =>
    mocks.processPiggyvestEvent(...args),
}));

import { POST } from './route';
import { withCaptureRpc } from './route.capture-test-support';
import {
  chainable,
  createRequest,
  inflowEvent,
  SECRET,
  signPayload,
} from './route.test-support';

/**
 * How the receiver answers once a delivery is captured but its processing
 * fails or is rejected: these cases run the deployment where the capture
 * drain is scheduled, so a failed processing attempt answers the deferred
 * 200, while a bad signature is rejected and stores nothing.
 */

const DEFERRED = { received: true, captured: true, processing: 'deferred' };

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_SCHEDULED', 'true');
  mocks.processPiggyvestEvent.mockResolvedValue('processed');
  // The union gate reads every secret var directly; pin the rotation vars
  // empty so each test's PVB_SECRET_KEY stub fully decides the outcome.
  vi.stubEnv('PIGGYVEST_WEBHOOK_SECRETS', '');
  vi.stubEnv('PIGGYVEST_WEBHOOK_SECRET_PREVIOUS', '');
});

describe('POST event intake: capture succeeded, processing did not', () => {
  it('rejects with 401 and stores nothing when the signature is invalid', async () => {
    vi.stubEnv('PVB_SECRET_KEY', SECRET);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const rawBody = JSON.stringify(inflowEvent);

      const response = await POST(createRequest(rawBody, '0'.repeat(128)));

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        received: false,
        code: 'PIGGYVEST_INVALID_SIGNATURE',
      });
      expect(mocks.createServiceClient).not.toHaveBeenCalled();
      // Monitoring surface for the log drain: presence only.
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(
          '[PiggyVest Webhook] Rejected delivery with invalid signature (signature header present)'
        )
      );
      expect(warn).not.toHaveBeenCalledWith(
        expect.stringContaining('0'.repeat(128))
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('keeps the captured row and answers 200 when the quarantine write fails', async () => {
    vi.stubEnv('PVB_SECRET_KEY', SECRET);
    mocks.createServiceClient.mockReturnValue({
      from: vi.fn(
        () =>
          chainable({ data: null, error: { message: 'synthetic db outage' } })
            .query
      ),
    });
    const rawBody = JSON.stringify({
      ...inflowEvent,
      eventType: 'wallet.transfer.success',
    });

    const response = await POST(createRequest(rawBody, signPayload(rawBody)));

    // Already captured; the failed digest quarantine never changes the reply.
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(DEFERRED);
  });

  it('answers 200 and leaves the captured row for retry when the processor throws', async () => {
    vi.stubEnv('PVB_SECRET_KEY', SECRET);
    const { query } = chainable({
      data: [{ event_id: inflowEvent.eventId }],
      error: null,
    });
    mocks.createServiceClient.mockReturnValue({
      from: vi.fn(() => query),
    });
    mocks.processPiggyvestEvent.mockRejectedValue(new Error('synthetic'));
    const rawBody = JSON.stringify(inflowEvent);

    const response = await POST(createRequest(rawBody, signPayload(rawBody)));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(DEFERRED);
  });

  it('answers 200 without leaking internals when the inbox write fails after capture', async () => {
    vi.stubEnv('PVB_SECRET_KEY', SECRET);
    mocks.createServiceClient.mockReturnValue({
      from: vi.fn(
        () =>
          chainable({ data: null, error: { message: 'synthetic db outage' } })
            .query
      ),
    });
    const rawBody = JSON.stringify(inflowEvent);

    const response = await POST(createRequest(rawBody, signPayload(rawBody)));

    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain('outage');
  });
});
