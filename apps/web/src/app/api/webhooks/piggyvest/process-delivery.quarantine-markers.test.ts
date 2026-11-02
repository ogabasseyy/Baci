import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  record: vi.fn(),
  process: vi.fn(),
  recordQuarantine: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/piggyvest/event-quarantine', () => ({
  digestRawBody: () => 'f'.repeat(64),
  recordQuarantineEvent: (...args: unknown[]) =>
    mocks.recordQuarantine(...args),
}));
vi.mock('@/lib/piggyvest/webhook-inbox', () => ({
  recordPiggyvestEvent: (...args: unknown[]) => mocks.record(...args),
}));
vi.mock('@/lib/piggyvest/webhook-processor', () => ({
  processPiggyvestEvent: (...args: unknown[]) => mocks.process(...args),
}));
vi.mock('@/lib/piggyvest/primary-wallet-inflow-dispatch', () => ({
  dispatchPrimaryWalletInflow: vi.fn(async () => 'ignored'),
}));

import type { PiggyvestWebhookKeyFamily } from '@/lib/piggyvest/webhook-secret-union';
import type { PiggyvestIntakeServiceClient } from '@/lib/supabase/service';
import {
  isAuthorizationQuarantine,
  isContentQuarantine,
  processVerifiedDelivery,
} from './process-delivery';

/**
 * Which acknowledged quarantines leave the capture unresolved (so a resend
 * is re-processed instead of swallowed as a processed duplicate):
 * - wrong signing family: an authorization quarantine;
 * - an unparseable or schema-rejected body: a content quarantine, because a
 *   parser fix makes the very same bytes processable;
 * - a conflicting redelivery stays terminal (no fix changes it).
 */

const client = {} as unknown as PiggyvestIntakeServiceClient;

function run(body: string, families: PiggyvestWebhookKeyFamily[] = ['legacy']) {
  return processVerifiedDelivery(
    {
      rawBody: Buffer.from(body),
      signature: 'ab'.repeat(64),
      matchedSecret: 'matched-secret',
      families,
    },
    { createClient: () => client, getPiggyvestConfig: () => null }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.recordQuarantine.mockResolvedValue('recorded');
  mocks.record.mockResolvedValue('new');
  mocks.process.mockResolvedValue('processed');
});

describe('content quarantines', () => {
  it.each([
    ['an unparseable body', '<<not json>>'],
    [
      'a schema-rejected known event type',
      JSON.stringify({
        eventId: 'evt-1',
        eventType: 'interest-payout.success',
        eventData: { amount: 'not a number' },
      }),
    ],
    ['an unknown event shape', JSON.stringify({ foo: 'bar' })],
  ])('flag %s as unresolved, acknowledged with 200', async (_name, body) => {
    const response = await run(body);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      received: true,
      quarantined: true,
    });
    expect(isContentQuarantine(response)).toBe(true);
    expect(isAuthorizationQuarantine(response)).toBe(false);
  });

  it('does not flag a quarantine whose durable write failed (that is a retryable 503)', async () => {
    mocks.recordQuarantine.mockRejectedValue(new Error('write failed'));

    const response = await run('<<not json>>');

    expect(response.status).toBe(503);
    expect(isContentQuarantine(response)).toBe(false);
  });

  it('does not flag a delivery that was processed', async () => {
    const response = await run(
      JSON.stringify({
        eventId: 'evt-accrued-1',
        eventType: 'interest-accrued.success',
        eventCategory: 'interest_accrued',
        customer_id: 'customer-1',
        eventData: { id: 'accrual-1', amount: 12.5 },
      })
    );

    expect(response.status).toBe(200);
    expect(isContentQuarantine(response)).toBe(false);
    expect(isAuthorizationQuarantine(response)).toBe(false);
  });
});

describe('interest-accrued.success (record-only, no ledger write)', () => {
  const accrued = JSON.stringify({
    eventId: 'evt-accrued-1',
    eventType: 'interest-accrued.success',
    eventCategory: 'interest_accrued',
    customer_id: 'customer-1',
    eventData: { id: 'accrual-1', amount: 12.5 },
  });

  it.each([
    ['the interest family', ['interest']],
    ['the legacy family', ['legacy']],
  ] as [
    string,
    PiggyvestWebhookKeyFamily[],
  ][])('is authorized and recorded when signed by %s', async (_name, families) => {
    const response = await run(accrued, families);

    expect(response.status).toBe(200);
    expect(isAuthorizationQuarantine(response)).toBe(false);
    expect(mocks.recordQuarantine).not.toHaveBeenCalled();
    expect(mocks.process).toHaveBeenCalledTimes(1);
  });

  it.each([
    'bank',
    'custody',
  ] as const)('is still a wrong-family quarantine when signed by the %s family', async (family) => {
    const response = await run(accrued, [family]);

    expect(isAuthorizationQuarantine(response)).toBe(true);
    expect(mocks.process).not.toHaveBeenCalled();
  });
});
