import { createHmac, randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * R5: durable, always-on capture at the receiver. Real HMAC with ephemeral
 * per-test keys, the real key union, and an in-memory stand-in for the
 * capture functions that mirrors the SQL contract. Processing
 * collaborators are mocked: this file proves what happens at the HTTP edge
 * around them.
 */

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

import { POST } from './route';
import { createFakeCaptureStore } from './route.capture-test-support';

const sign = (secret: string, body: string) =>
  createHmac('sha512', secret).update(body).digest('hex');

function post(body: string, signature?: string, extra: HeadersInit = {}) {
  return POST(
    new NextRequest('https://usebaci.com/api/webhooks/piggyvest', {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/json',
        ...(signature ? { 'x-pvb-signature': signature } : {}),
        ...extra,
      },
    })
  );
}

const accrued = JSON.stringify({
  eventId: 'evt-accrued-1',
  eventType: 'interest-accrued.success',
  eventCategory: 'interest_accrued',
  customer_id: 'customer-1',
  eventData: { id: 'accrual-1', amount: 12.5 },
});

let current: string;
let store: ReturnType<typeof createFakeCaptureStore>;
let alerts: ReturnType<typeof vi.spyOn>;
let warns: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  store = createFakeCaptureStore();
  current = randomBytes(32).toString('hex');
  vi.stubEnv('PIGGYVEST_SECRET_KEY', current);
  vi.stubEnv('PVB_SECRET_KEY', '');
  vi.stubEnv('PIGGYVEST_WEBHOOK_KEY_ARCHIVE', '');
  vi.stubEnv('PIGGYVEST_WEBHOOK_KEY_OVERLAP_HOURS', '');
  vi.stubEnv('VERCEL_ENV', 'preview');
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

const HOUR = 3_600_000;

describe('R5 key rotation at ingress', () => {
  const archive = (secret: string, retiredHoursAgo: number) =>
    JSON.stringify([
      {
        version: 'pv-2026-09',
        family: 'legacy',
        secret,
        retiredAt: new Date(Date.now() - retiredHoursAgo * HOUR).toISOString(),
      },
    ]);

  it('accepts and captures a retired key inside the overlap window', async () => {
    const old = randomBytes(32).toString('hex');
    vi.stubEnv('PIGGYVEST_WEBHOOK_KEY_ARCHIVE', archive(old, 10));

    const response = await post(accrued, sign(old, accrued));

    expect(response.status).toBe(200);
    expect(store.rows[0]).toMatchObject({
      keyStatus: 'overlap',
      keyVersion: 'pv-2026-09',
    });
  });

  it('rejects a revoked key with 401 and an alert, storing nothing', async () => {
    const old = randomBytes(32).toString('hex');
    vi.stubEnv('PIGGYVEST_WEBHOOK_KEY_ARCHIVE', archive(old, 100));

    const response = await post(accrued, sign(old, accrued));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      received: false,
      code: 'PIGGYVEST_INVALID_SIGNATURE',
    });
    expect(store.rows).toEqual([]);
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
    expect(alerts).toHaveBeenCalledWith(
      expect.stringContaining('PIGGYVEST_WEBHOOK_KEY_REVOKED')
    );
    expect(alerts).toHaveBeenCalledWith(expect.stringContaining('pv-2026-09'));
  });
});

describe('R5 distinct failure statuses', () => {
  it('answers 401, warns and stores nothing for an invalid signature', async () => {
    const response = await post(
      accrued,
      sign(randomBytes(32).toString('hex'), accrued)
    );

    expect(response.status).toBe(401);
    expect(store.rows).toEqual([]);
    expect(warns).toHaveBeenCalledWith(
      expect.stringContaining('Rejected delivery with invalid signature')
    );
  });

  it('answers 401 for a missing signature header', async () => {
    expect((await post(accrued)).status).toBe(401);
    expect(store.rows).toEqual([]);
  });

  it('answers 503 with an alert, never 401, when no server key is configured', async () => {
    vi.stubEnv('PIGGYVEST_SECRET_KEY', '');

    const response = await post(accrued, sign(current, accrued));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Integration unavailable',
      code: 'PIGGYVEST_NOT_READY',
    });
    expect(store.rows).toEqual([]);
    expect(alerts).toHaveBeenCalledWith(
      expect.stringContaining('PIGGYVEST_WEBHOOK_KEYS_UNCONFIGURED')
    );
  });

  it('answers 503 with an alert and leaves no row when the storage write fails', async () => {
    store.failCapture = true;

    const response = await post(accrued, sign(current, accrued));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Event intake unavailable',
      code: 'PIGGYVEST_CAPTURE_UNAVAILABLE',
    });
    expect(store.rows).toEqual([]);
    expect(mocks.processPiggyvestEvent).not.toHaveBeenCalled();
    expect(alerts).toHaveBeenCalledWith(
      expect.stringContaining('PIGGYVEST_WEBHOOK_CAPTURE_FAILED')
    );
  });

  it('answers 503 and stores nothing when the storage client cannot be created', async () => {
    mocks.createServiceClient.mockImplementation(() => {
      throw new Error('missing service credentials');
    });

    const response = await post(accrued, sign(current, accrued));

    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('credentials');
    expect(alerts).toHaveBeenCalledWith(
      expect.stringContaining('PIGGYVEST_WEBHOOK_CAPTURE_FAILED')
    );
  });
});
