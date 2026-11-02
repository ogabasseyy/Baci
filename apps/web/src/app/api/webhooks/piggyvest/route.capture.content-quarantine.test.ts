import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  processPiggyvestEvent: vi.fn(),
  recordPiggyvestEvent: vi.fn(),
  quarantine: vi.fn(),
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
vi.mock('@/lib/piggyvest/event-quarantine', () => ({
  digestRawBody: () => 'f'.repeat(64),
  recordQuarantineEvent: (...args: unknown[]) => mocks.quarantine(...args),
}));

import { deterministicTestKey } from '@/lib/piggyvest/deterministic-test-data.test-support';
import { piggyvestWebhookEventSchema } from '@/schemas/piggyvest/events';
import { POST } from './route';
import { createFakeCaptureStore } from './route.capture-test-support';

/**
 * An authentic delivery the parser rejects is acknowledged (200) but its
 * capture must stay unresolved. If it were marked processed, a resend after
 * the parser fix would be swallowed as a processed duplicate and the money
 * never applied. The identical bytes must be processed once the parser
 * accepts them.
 */

const key = deterministicTestKey('content-quarantine');
const rejected = JSON.stringify({
  eventId: 'evt-fix-1',
  eventType: 'interest-accrued.success',
  eventCategory: 'interest_accrued',
  customer_id: 'customer-1',
  eventData: { id: 'accrual-1', amount: 12.5, unexpected: true },
});
const accepted = {
  eventId: 'evt-fix-1',
  eventType: 'interest-accrued.success',
  eventCategory: 'interest_accrued',
  customer_id: 'customer-1',
  eventData: { id: 'accrual-1', amount: 12.5 },
} as const;

let store: ReturnType<typeof createFakeCaptureStore>;

function post(body = rejected) {
  return POST(
    new NextRequest('https://usebaci.com/api/webhooks/piggyvest', {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/json',
        'x-pvb-signature': createHmac('sha512', key).update(body).digest('hex'),
      },
    })
  );
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
  mocks.quarantine.mockResolvedValue('recorded');
  // Stand-in for "the parser rejected this body".
  vi.spyOn(piggyvestWebhookEventSchema, 'safeParse').mockReturnValue({
    success: false,
    error: new Error('rejected') as never,
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('a delivery the parser rejects', () => {
  it('is acknowledged, quarantined and never resolved as processed', async () => {
    const response = await post();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      received: true,
      quarantined: true,
    });
    expect(mocks.quarantine).toHaveBeenCalledTimes(1);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.processingState).toBe('pending');
    expect(store.resolveCalls).toEqual([]);
  });

  it('is re-processed on a resend (not swallowed as a processed duplicate) while the parser still rejects it', async () => {
    await post();

    const resend = await post();

    expect(await resend.json()).toEqual({ received: true, quarantined: true });
    expect(mocks.quarantine).toHaveBeenCalledTimes(2);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.processingState).toBe('pending');
  });

  it('is processed on a resend once the parser accepts the identical bytes, and the capture closes', async () => {
    await post();
    vi.spyOn(piggyvestWebhookEventSchema, 'safeParse').mockReturnValue({
      success: true,
      data: accepted as never,
    });

    const resend = await post();

    expect(resend.status).toBe(200);
    expect(await resend.json()).toEqual({ received: true, duplicate: false });
    expect(mocks.processPiggyvestEvent).toHaveBeenCalledTimes(1);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.processingState).toBe('processed');
  });
});
