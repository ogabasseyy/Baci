import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A secret current for `legacy` and archived for another family, with the
 * archive unreadable, is admitted with ['legacy'] only. The capture's
 * recorded authority is immutable and replay cannot widen it, so the drain
 * may never be able to finish that row. While the key set is incomplete ANY
 * non-2xx processing outcome must therefore stay provider-retryable (503),
 * attested drain or not; a complete key set keeps the attested deferred
 * 200. (An event type a primary family owns is retried even earlier, see
 * process-delivery.incomplete-keys.test.ts; this suite uses a
 * legacy-handled event to exercise the ordinary-failure path.)
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

import { paidInterestFixture } from '@/lib/piggyvest/primary-wallet-paid-interest.test-support';
import { testKey } from '@/lib/piggyvest/webhook-secret-union.test-support';
import { POST } from './route';
import {
  COMPLETE_ARCHIVE_WITHOUT_BANK,
  UNREADABLE_ARCHIVE,
} from './route.capture.incomplete-keys.test-support';
import { createFakeCaptureStore } from './route.capture-test-support';

const legacyKey = testKey('retry-legacy');
const legacyEvent = JSON.stringify({
  eventId: 'evt-accrued-1',
  eventType: 'interest-accrued.success',
  eventCategory: 'interest_accrued',
  customer_id: 'customer-1',
  eventData: { id: 'accrual-1', amount: 12.5 },
});
const payout = JSON.stringify(paidInterestFixture.event);

let store: ReturnType<typeof createFakeCaptureStore>;
let alerts: ReturnType<typeof vi.spyOn>;

function post(body = legacyEvent) {
  return POST(
    new NextRequest('https://usebaci.com/api/webhooks/piggyvest', {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/json',
        'x-pvb-signature': createHmac('sha512', legacyKey)
          .update(body)
          .digest('hex'),
      },
    })
  );
}

const attested = (value: 'true' | 'false') =>
  vi.stubEnv('PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_SCHEDULED', value);

beforeEach(() => {
  vi.clearAllMocks();
  store = createFakeCaptureStore();
  vi.stubEnv('PIGGYVEST_SECRET_KEY', legacyKey);
  vi.stubEnv('PVB_SECRET_KEY', '');
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('PIGGYVEST_WEBHOOK_KEY_OVERLAP_HOURS', '');
  vi.stubEnv('PIGGYVEST_WEBHOOK_KEY_ARCHIVE', COMPLETE_ARCHIVE_WITHOUT_BANK);
  attested('true');
  mocks.createServiceClient.mockImplementation(() => store.client());
  mocks.recordPiggyvestEvent.mockResolvedValue('new');
  mocks.processPiggyvestEvent.mockResolvedValue('processed');
  alerts = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  alerts.mockRestore();
});

const unmappedWallet = () =>
  mocks.processPiggyvestEvent.mockRejectedValue(
    new Error('unmapped wallet for payout')
  );

describe('while the key set is incomplete', () => {
  beforeEach(() => {
    vi.stubEnv('PIGGYVEST_WEBHOOK_KEY_ARCHIVE', UNREADABLE_ARCHIVE);
  });

  it('keeps an ordinary processing failure provider-retryable (503) even with the drain attested', async () => {
    unmappedWallet();

    const response = await post();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      received: true,
      captured: true,
      processing: 'retry',
      code: 'PIGGYVEST_PROCESSING_RETRY',
    });
    // Admitted with the loaded family only; its recorded authority stays.
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.keyFamilies).toEqual(['legacy']);
    expect(store.rows[0]?.processingState).toBe('pending');
    expect(alerts).toHaveBeenCalledWith(
      expect.stringContaining('PIGGYVEST_WEBHOOK_PROCESSING_DEFERRED')
    );
  });

  it('is still 503 when the drain is not attested', async () => {
    attested('false');
    unmappedWallet();

    expect((await post()).status).toBe(503);
  });

  it('keeps answering 503 on redelivery, on the same single row', async () => {
    unmappedWallet();

    expect((await post()).status).toBe(503);
    expect((await post()).status).toBe(503);
    expect(store.rows).toHaveLength(1);
  });

  it('retries a primary-owned payout that only the legacy fallback could complete, attested or not', async () => {
    for (const drainAttested of ['true', 'false'] as const) {
      attested(drainAttested);

      const response = await post(payout);

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: 'Integration unavailable',
        code: 'PIGGYVEST_NOT_READY',
      });
    }
    expect(mocks.processPiggyvestEvent).not.toHaveBeenCalled();
    expect(store.rows[0]?.processingState).toBe('pending');
  });

  it('does not change a successful delivery: it is processed and acknowledged', async () => {
    const response = await post();

    expect(response.status).toBe(200);
    expect(store.rows[0]?.processingState).toBe('processed');
  });
});

describe('with a complete key set (behaviour unchanged)', () => {
  it('still answers the attested deferred 200 for a processing failure', async () => {
    unmappedWallet();

    const response = await post();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      received: true,
      captured: true,
      processing: 'deferred',
    });
    expect(store.rows[0]?.processingState).toBe('pending');
  });

  it('still answers 503 for a processing failure when the drain is not attested', async () => {
    attested('false');
    unmappedWallet();

    expect((await post()).status).toBe(503);
  });
});
