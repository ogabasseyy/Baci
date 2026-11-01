import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  processPiggyvestEvent: vi.fn(),
  recordPiggyvestEvent: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({ getPiggyvestApiConfig: () => null }));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => mocks.createServiceClient(),
}));
vi.mock('@/lib/piggyvest/webhook-processor', () => ({
  processPiggyvestEvent: (...args: unknown[]) =>
    mocks.processPiggyvestEvent(...args),
}));
vi.mock('@/lib/piggyvest/webhook-inbox', () => ({
  recordPiggyvestEvent: (...args: unknown[]) =>
    mocks.recordPiggyvestEvent(...args),
}));

import { deterministicTestKey } from '@/lib/piggyvest/deterministic-test-data.test-support';
import { POST } from './route';
import { createFakeCaptureStore } from './route.capture-test-support';

/**
 * The attested "deferred" 200 tells the provider the drain owns the retry,
 * which is true only while the drain can still claim the row (pending or
 * claimed). A needs_review row is never claimed again, so a resend that
 * fails must stay provider-retryable (503), and a resend that succeeds must
 * close the row instead of leaving it in review.
 */

const key = deterministicTestKey('needs-review');
const payload = JSON.stringify({
  eventId: 'evt-review-1',
  eventType: 'interest-accrued.success',
  eventCategory: 'interest_accrued',
  customer_id: 'customer-1',
  eventData: { id: 'accrual-1', amount: 12.5 },
});

let store: ReturnType<typeof createFakeCaptureStore>;

function post() {
  return POST(
    new NextRequest('https://usebaci.com/api/webhooks/piggyvest', {
      method: 'POST',
      body: payload,
      headers: {
        'content-type': 'application/json',
        'x-pvb-signature': createHmac('sha512', key)
          .update(payload)
          .digest('hex'),
      },
    })
  );
}

const failProcessing = () =>
  mocks.processPiggyvestEvent.mockRejectedValue(new Error('intake down'));

/** Capture the delivery (inline processing fails), then dead-letter its row. */
async function deadLetter() {
  failProcessing();
  await post();
  const [claimed] = store.claim(1);
  store.resolve({
    p_id: claimed?.capture_id,
    p_claim_token: claimed?.claim_token,
    p_state: 'needs_review',
    p_error: 'PROCESSING_ATTEMPTS_EXHAUSTED',
  });
  expect(store.rows[0]?.processingState).toBe('needs_review');
}

beforeEach(() => {
  vi.clearAllMocks();
  store = createFakeCaptureStore();
  vi.stubEnv('PIGGYVEST_SECRET_KEY', key);
  vi.stubEnv('PVB_SECRET_KEY', '');
  vi.stubEnv('PIGGYVEST_WEBHOOK_KEY_ARCHIVE', '[]');
  vi.stubEnv('PIGGYVEST_WEBHOOK_KEY_OVERLAP_HOURS', '');
  vi.stubEnv('PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_SCHEDULED', 'true');
  mocks.createServiceClient.mockImplementation(() => store.client());
  mocks.recordPiggyvestEvent.mockResolvedValue('new');
  mocks.processPiggyvestEvent.mockResolvedValue('processed');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('a resend of a needs_review capture (attested drain, complete key set)', () => {
  it('stays provider-retryable (503) when the inline retry fails, instead of the drain-owns-it 200', async () => {
    await deadLetter();

    const response = await post();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      received: true,
      captured: true,
      processing: 'retry',
      code: 'PIGGYVEST_PROCESSING_RETRY',
    });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.processingState).toBe('needs_review');
  });

  it('closes the row as processed when the inline retry succeeds', async () => {
    await deadLetter();
    mocks.processPiggyvestEvent.mockResolvedValue('processed');

    const response = await post();

    expect(response.status).toBe(200);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.processingState).toBe('processed');
  });

  it('then short-circuits further resends as processed duplicates', async () => {
    await deadLetter();
    mocks.processPiggyvestEvent.mockResolvedValue('processed');
    await post();
    mocks.processPiggyvestEvent.mockClear();

    const again = await post();

    expect(await again.json()).toEqual({ received: true, duplicate: true });
    expect(mocks.processPiggyvestEvent).not.toHaveBeenCalled();
  });
});

describe('a duplicate the drain can still claim keeps the deferred 200', () => {
  const deferred = {
    received: true,
    captured: true,
    processing: 'deferred',
  };

  it('for a pending capture', async () => {
    failProcessing();
    await post();

    const response = await post();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(deferred);
    expect(store.rows[0]?.processingState).toBe('pending');
  });

  it('for a capture currently leased by the drain', async () => {
    failProcessing();
    await post();
    store.claim(1);
    expect(store.rows[0]?.processingState).toBe('claimed');

    const response = await post();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(deferred);
  });
});
