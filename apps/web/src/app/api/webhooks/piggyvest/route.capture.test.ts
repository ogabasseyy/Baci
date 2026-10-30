import { createHash, createHmac, randomBytes } from 'node:crypto';
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
  // These suites exercise the deployment where the capture drain is
  // scheduled, so a failed processing attempt answers the deferred 200.
  vi.stubEnv('PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_SCHEDULED', 'true');
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

describe('R5 capture at ingress', () => {
  it('stores a delivery signed by the current key before answering 200', async () => {
    const response = await post(accrued, sign(current, accrued));

    expect(response.status).toBe(200);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({
      eventKey: 'evt-accrued-1',
      eventType: 'interest-accrued.success',
      keyStatus: 'current',
      keyFamilies: ['legacy'],
      headers: { 'content-type': 'application/json' },
    });
    expect(store.rows[0]?.keyVersion).toMatch(/^k-[0-9a-f]{16}$/);
  });

  it('keeps the bytes exactly as sent and normalises an uppercase signature', async () => {
    const body = ` \r\n{"eventId": "evt-ws-1",\t"eventType":"interest-accrued.success"}\r\n`;
    const signature = sign(current, body);

    const response = await post(body, signature.toUpperCase());

    expect(response.status).toBe(200);
    expect(store.rows[0]?.rawHex).toBe(Buffer.from(body).toString('hex'));
    expect(store.rows[0]?.signature).toBe(signature);
    expect(store.rows[0]?.headers['x-pvb-signature']).toBe(
      signature.toUpperCase()
    );
  });

  it('stores unknown event types and unparseable bodies, never dropping them', async () => {
    const unknown = JSON.stringify({
      eventId: 'evt-unknown-1',
      eventType: 'wallet.brand-new.success',
      eventCategory: 'x',
      customer_id: 'c',
      eventData: {},
    });
    const garbage = '<<not json>>';

    expect((await post(unknown, sign(current, unknown))).status).toBe(200);
    expect((await post(garbage, sign(current, garbage))).status).toBe(200);

    expect(store.rows.map((row) => row.eventType)).toEqual([
      'wallet.brand-new.success',
      null,
    ]);
    expect(store.rows[1]?.eventKey).toBe(
      `raw:${createHash('sha256').update(garbage).digest('hex')}`
    );
  });

  it('answers 200 with exactly one stored row for a duplicate delivery', async () => {
    const signature = sign(current, accrued);

    expect((await post(accrued, signature)).status).toBe(200);
    const second = await post(accrued, signature);

    expect(second.status).toBe(200);
    expect(store.rows).toHaveLength(1);
  });

  it('does not reprocess a duplicate whose first delivery already completed', async () => {
    const signature = sign(current, accrued);
    await post(accrued, signature);
    mocks.processPiggyvestEvent.mockClear();

    const second = await post(accrued, signature);

    expect(await second.json()).toEqual({ received: true, duplicate: true });
    expect(mocks.processPiggyvestEvent).not.toHaveBeenCalled();
  });

  it('captures even when every financial-processing flag is off', async () => {
    for (const flag of [
      'PIGGYVEST_PRIMARY_PAID_INTEREST_INBOX_ENABLED',
      'PIGGYVEST_PRIMARY_WALLET_BANK_INBOX_ENABLED',
      'PIGGYVEST_PRIMARY_CARD_CUSTODY_INBOX_ENABLED',
      'PIGGYVEST_PRIMARY_ENABLED',
    ]) {
      vi.stubEnv(flag, 'false');
    }
    const payout = JSON.stringify({
      eventId: 'evt-payout-1',
      eventType: 'interest-payout.success',
      eventCategory: 'interest-payout',
      customer_id: 'customer-1',
      eventData: { id: 'payout-1' },
    });
    mocks.processPiggyvestEvent.mockRejectedValue(new Error('flags off'));

    const response = await post(payout, sign(current, payout));

    expect(response.status).toBe(200);
    expect(store.rows.map((row) => row.eventKey)).toEqual(['evt-payout-1']);
  });
});

describe('R5 processing is separate from the reply', () => {
  it('marks the row processed only after processing completes', async () => {
    await post(accrued, sign(current, accrued));

    expect(store.rows[0]?.processingState).toBe('processed');
    expect(store.resolveCalls).toEqual([
      {
        p_id: store.rows[0]?.id,
        p_claim_token: null,
        p_state: 'processed',
        p_error: null,
      },
    ]);
  });

  it('answers 200 and leaves the row pending for retry when processing fails', async () => {
    mocks.processPiggyvestEvent.mockRejectedValue(new Error('ledger down'));

    const response = await post(accrued, sign(current, accrued));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      received: true,
      captured: true,
      processing: 'deferred',
    });
    expect(store.rows[0]?.processingState).toBe('pending');
    expect(store.resolveCalls).toEqual([]);
    expect(alerts).toHaveBeenCalledWith(
      expect.stringContaining('PIGGYVEST_WEBHOOK_PROCESSING_DEFERRED')
    );
  });
});
