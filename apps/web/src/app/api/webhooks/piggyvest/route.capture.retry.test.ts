import { createHmac, randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * R5 reply policy after a successful capture when processing does not
 * complete. Until the capture drain is attested as scheduled
 * (PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_SCHEDULED === 'true'), the provider's own
 * redeliveries are the only retry mechanism, so the receiver must keep
 * answering 503 (the row stays durable and pending). Once the drain is
 * scheduled, the drain owns the retry and the reply is a deferred 200.
 */

const mocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  processPiggyvestEvent: vi.fn(),
  recordPiggyvestEvent: vi.fn(),
  throwFromProcessing: false,
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
vi.mock('./process-delivery', async (importOriginal) => {
  const actual = await importOriginal<typeof ProcessDeliveryModule>();
  return {
    ...actual,
    processVerifiedDelivery: (
      ...args: Parameters<typeof actual.processVerifiedDelivery>
    ) => {
      if (mocks.throwFromProcessing) {
        return Promise.reject(new Error('unexpected processing failure'));
      }
      return actual.processVerifiedDelivery(...args);
    },
  };
});

import type * as ProcessDeliveryModule from './process-delivery';
import { POST } from './route';
import { createFakeCaptureStore } from './route.capture-test-support';

const DRAIN_FLAG = 'PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_SCHEDULED';

const accrued = JSON.stringify({
  eventId: 'evt-retry-1',
  eventType: 'interest-accrued.success',
  eventCategory: 'interest_accrued',
  customer_id: 'customer-1',
  eventData: { id: 'accrual-1', amount: 12.5 },
});

let current: string;
let store: ReturnType<typeof createFakeCaptureStore>;
let alerts: ReturnType<typeof vi.spyOn>;
let warns: ReturnType<typeof vi.spyOn>;

function post(body = accrued) {
  return POST(
    new NextRequest('https://usebaci.com/api/webhooks/piggyvest', {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/json',
        'x-pvb-signature': createHmac('sha512', current)
          .update(body)
          .digest('hex'),
      },
    })
  );
}

const RETRY_BODY = {
  received: true,
  captured: true,
  processing: 'retry',
  code: 'PIGGYVEST_PROCESSING_RETRY',
};

beforeEach(() => {
  vi.clearAllMocks();
  store = createFakeCaptureStore();
  current = randomBytes(32).toString('hex');
  mocks.throwFromProcessing = false;
  vi.stubEnv('PIGGYVEST_SECRET_KEY', current);
  vi.stubEnv('PVB_SECRET_KEY', '');
  vi.stubEnv('PIGGYVEST_WEBHOOK_KEY_ARCHIVE', '');
  vi.stubEnv('PIGGYVEST_WEBHOOK_KEY_OVERLAP_HOURS', '');
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv(DRAIN_FLAG, '');
  mocks.createServiceClient.mockImplementation(() => store.client());
  mocks.recordPiggyvestEvent.mockResolvedValue('new');
  mocks.processPiggyvestEvent.mockResolvedValue('processed');
  alerts = vi.spyOn(console, 'error').mockImplementation(() => {});
  warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  alerts.mockRestore();
  warns.mockRestore();
});

describe('drain not attested: provider redelivery stays the retry', () => {
  it('answers 503 and keeps the captured row pending when processing fails', async () => {
    mocks.processPiggyvestEvent.mockRejectedValue(new Error('ledger down'));

    const response = await post();

    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual(RETRY_BODY);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.processingState).toBe('pending');
    expect(store.resolveCalls).toEqual([]);
    expect(alerts).toHaveBeenCalledWith(
      expect.stringContaining('PIGGYVEST_WEBHOOK_PROCESSING_DEFERRED')
    );
  });

  it('answers 503 and keeps the row pending when processing itself throws', async () => {
    mocks.throwFromProcessing = true;

    const response = await post();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(RETRY_BODY);
    expect(store.rows[0]?.processingState).toBe('pending');
    expect(alerts).toHaveBeenCalledWith(
      expect.stringContaining('PIGGYVEST_WEBHOOK_PROCESSING_DEFERRED')
    );
  });

  it('never leaks the failure detail in the retry reply', async () => {
    mocks.processPiggyvestEvent.mockRejectedValue(
      new Error('db-host-7 refused connection')
    );

    const text = JSON.stringify(await (await post()).json());

    expect(text).not.toMatch(/db-host-7|refused|ledger/);
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['upper case', 'TRUE'],
    ['numeric', '1'],
    ['padded', ' true'],
    ['false', 'false'],
  ])('treats a %s attestation as not scheduled', async (_name, value) => {
    vi.stubEnv(DRAIN_FLAG, value);
    mocks.processPiggyvestEvent.mockRejectedValue(new Error('ledger down'));

    const response = await post();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(RETRY_BODY);
  });

  it('re-runs processing on the redelivery of a still-pending row, then marks it processed', async () => {
    mocks.processPiggyvestEvent.mockRejectedValueOnce(new Error('ledger down'));
    const first = await post();
    expect(first.status).toBe(503);
    expect(store.rows[0]?.processingState).toBe('pending');

    mocks.recordPiggyvestEvent.mockResolvedValue('duplicate');
    mocks.processPiggyvestEvent.mockResolvedValue('processed');
    const second = await post();

    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ received: true, duplicate: true });
    expect(mocks.processPiggyvestEvent).toHaveBeenCalledTimes(2);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.processingState).toBe('processed');
    expect(store.resolveCalls).toHaveLength(1);
  });
});

describe('drain attested: the drain owns the retry', () => {
  it('answers a deferred 200 when processing fails', async () => {
    vi.stubEnv(DRAIN_FLAG, 'true');
    mocks.processPiggyvestEvent.mockRejectedValue(new Error('ledger down'));

    const response = await post();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      received: true,
      captured: true,
      processing: 'deferred',
    });
    expect(store.rows[0]?.processingState).toBe('pending');
    expect(alerts).toHaveBeenCalledWith(
      expect.stringContaining('PIGGYVEST_WEBHOOK_PROCESSING_DEFERRED')
    );
  });

  it('answers a deferred 200 when processing itself throws', async () => {
    vi.stubEnv(DRAIN_FLAG, 'true');
    mocks.throwFromProcessing = true;

    const response = await post();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ processing: 'deferred' });
  });

  it('reads the attestation per request, not at module load', async () => {
    mocks.processPiggyvestEvent.mockRejectedValue(new Error('ledger down'));

    expect((await post()).status).toBe(503);
    vi.stubEnv(DRAIN_FLAG, 'true');
    expect((await post()).status).toBe(200);
    vi.stubEnv(DRAIN_FLAG, '');
    expect((await post()).status).toBe(503);
  });
});

describe('successful processing is unaffected by the attestation', () => {
  it.each([
    undefined,
    'true',
  ])('answers the processing result with flag %s', async (value) => {
    vi.stubEnv(DRAIN_FLAG, value);

    const response = await post();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, duplicate: false });
    expect(store.rows[0]?.processingState).toBe('processed');
  });
});
