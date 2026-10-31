import { createHmac, randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A key set can be incomplete: an unreadable archive, or a family whose
 * configuration failed to load. A secret that is current for one family and
 * archived (inside overlap) for another then verifies under the loaded
 * family only. An event that family cannot authorize must NOT be answered
 * with the terminal key-family quarantine 200 in that state: the missing
 * assignment may be the one that authorizes it, and a 200 stops the
 * provider's retries for good. It is answered with the same retryable 503
 * as an unconfigured server instead, while a COMPLETE configuration keeps
 * the genuine quarantine.
 *
 * The capture row is left exactly as admitted (recorded families are
 * immutable and replay never widens them); recovery is the provider's
 * redelivery, which verifies under the full set and gets its own row.
 */

const mocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  processPiggyvestEvent: vi.fn(),
  recordPiggyvestEvent: vi.fn(),
  bankIntake: vi.fn(),
  inflow: vi.fn(),
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
vi.mock('@/lib/piggyvest/primary-wallet-bank-inbox-intake', () => ({
  dispatchPrimaryWalletBankInboxIntake: (...args: unknown[]) =>
    mocks.bankIntake(...args),
}));
vi.mock('@/lib/piggyvest/primary-wallet-inflow-dispatch', () => ({
  dispatchPrimaryWalletInflow: (...args: unknown[]) => mocks.inflow(...args),
}));
vi.mock('@/lib/piggyvest/event-quarantine', () => ({
  digestRawBody: () => 'f'.repeat(64),
  recordQuarantineEvent: (...args: unknown[]) => mocks.quarantine(...args),
}));

import { verifyStoredPiggyvestDelivery } from '@/lib/piggyvest/verify-stored-piggyvest-delivery';
import { drainPiggyvestWebhookCaptures } from '@/lib/piggyvest/webhook-capture-drain';
import {
  isAuthorizationQuarantine,
  isKeySetIncompleteRetry,
  processVerifiedDelivery,
} from './process-delivery';
import { POST } from './route';
import { createFakeCaptureStore } from './route.capture-test-support';

const HOUR = 3_600_000;
const sign = (secret: string, body: string) =>
  createHmac('sha512', secret).update(body).digest('hex');

const inflow = JSON.stringify({
  eventId: 'evt-incomplete-1',
  eventType: 'bank-transfer.inflow.success',
  eventCategory: 'inflow_transaction',
  customer_id: 'owned-customer',
  pvb_reference: 'provider-reference',
  pvb_wallet: 'owned-wallet',
  eventData: {
    id: 'detail',
    customer_id: 'owned-customer',
    destination_wallet_id: 'conduit-wallet',
    type: 'inter',
    category: 'bank_transfer_inflow',
    amount: 10000,
    currency: 'NGN',
    narration: '',
    ip_address: '',
    transaction_id: 'bank-transaction',
    timestamp: '2026-10-07T10:00:00.000Z',
    status: 'COMPLETED',
    third_party_reference: '',
    initiator_reference: '',
    internal_reference: '',
    provider: 'synthetic-bank',
    destination_wallet_balance: 10000,
    destination_wallet_ledger_balance: 10000,
    destination_transaction_balance: 10000,
    reference: 'bank-reference',
    fee: 0,
  },
});

let store: ReturnType<typeof createFakeCaptureStore>;
/** Current for the interest family AND archived (overlap) for bank. */
let sharedKey: string;
let alerts: ReturnType<typeof vi.spyOn>;

const UNREADABLE_ARCHIVE = '{not json';
const COMPLETE_ARCHIVE_WITHOUT_BANK = '[]';
const archiveWithBankAssignment = () =>
  JSON.stringify([
    {
      version: 'k-bank',
      family: 'bank',
      secret: sharedKey,
      retiredAt: new Date(Date.now() - 2 * HOUR).toISOString(),
    },
  ]);

function post() {
  return POST(
    new NextRequest('https://usebaci.com/api/webhooks/piggyvest', {
      method: 'POST',
      body: inflow,
      headers: {
        'content-type': 'application/json',
        'x-pvb-signature': sign(sharedKey, inflow),
      },
    })
  );
}

function drain() {
  const client = store.client();
  return drainPiggyvestWebhookCaptures({
    claim: () => Promise.resolve(store.claim(10)),
    resolve: async (id, token, state, error) => {
      const result = await client.rpc('resolve_piggyvest_webhook_capture', {
        p_id: id,
        p_claim_token: token,
        p_state: state,
        p_error: error,
      });
      return result.data === true;
    },
    verify: (input) => verifyStoredPiggyvestDelivery(input),
    process: async (delivery) => {
      const response = await processVerifiedDelivery(delivery, {
        createClient: () => client as never,
        getPiggyvestConfig: () => null,
      });
      return {
        status: response.status,
        authorizationQuarantine: isAuthorizationQuarantine(response),
        keySetIncomplete: isKeySetIncompleteRetry(response),
      };
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  store = createFakeCaptureStore();
  sharedKey = randomBytes(32).toString('hex');
  vi.stubEnv('PIGGYVEST_SECRET_KEY', randomBytes(32).toString('hex'));
  vi.stubEnv('PVB_SECRET_KEY', '');
  // The interest family only reads its key in production.
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('PIGGYVEST_PRIMARY_PAID_INTEREST_WEBHOOK_SECRET', sharedKey);
  vi.stubEnv('PIGGYVEST_WEBHOOK_KEY_OVERLAP_HOURS', '');
  vi.stubEnv('PIGGYVEST_WEBHOOK_KEY_ARCHIVE', COMPLETE_ARCHIVE_WITHOUT_BANK);
  // Attested: a 200 "deferred" would normally stop the provider's retries.
  vi.stubEnv('PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_SCHEDULED', 'true');
  mocks.createServiceClient.mockImplementation(() => store.client());
  mocks.inflow.mockResolvedValue('ignored');
  mocks.quarantine.mockResolvedValue('recorded');
  mocks.recordPiggyvestEvent.mockResolvedValue('new');
  mocks.processPiggyvestEvent.mockResolvedValue('processed');
  mocks.bankIntake.mockResolvedValue({
    outcome: 'accepted',
    response: Response.json({ received: true, bankQueued: true }),
  });
  alerts = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  alerts.mockRestore();
});

describe('an event the loaded families cannot authorize', () => {
  it('is a genuine quarantine (200) when the key configuration is complete', async () => {
    const response = await post();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      received: true,
      quarantined: true,
    });
    expect(mocks.quarantine).toHaveBeenCalledTimes(1);
    expect(mocks.bankIntake).not.toHaveBeenCalled();
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.keyFamilies).toEqual(['interest']);
    expect(store.rows[0]?.processingState).toBe('pending');
  });

  it('is retryable (503), not a terminal quarantine, while the archive is unreadable', async () => {
    vi.stubEnv('PIGGYVEST_WEBHOOK_KEY_ARCHIVE', UNREADABLE_ARCHIVE);

    const response = await post();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Integration unavailable',
      code: 'PIGGYVEST_NOT_READY',
    });
    // No terminal quarantine record, no handler, and the capture stays
    // pending exactly as admitted (recorded authority is never widened).
    expect(mocks.quarantine).not.toHaveBeenCalled();
    expect(mocks.bankIntake).not.toHaveBeenCalled();
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.keyFamilies).toEqual(['interest']);
    expect(store.rows[0]?.processingState).toBe('pending');
    expect(store.resolveCalls).toEqual([]);
    expect(alerts).toHaveBeenCalledWith(
      expect.stringContaining('PIGGYVEST_WEBHOOK_KEYS_UNCONFIGURED')
    );
  });

  it('is retryable (503) while a family configuration fails to load', async () => {
    vi.stubEnv('PIGGYVEST_PRIMARY_BANK_RETAINED_WEBHOOK_SECRETS', '{not json');

    const response = await post();

    expect(response.status).toBe(503);
    expect(mocks.quarantine).not.toHaveBeenCalled();
  });

  it('keeps answering 503 on redelivery while incomplete, on the same single row', async () => {
    vi.stubEnv('PIGGYVEST_WEBHOOK_KEY_ARCHIVE', UNREADABLE_ARCHIVE);

    expect((await post()).status).toBe(503);
    expect((await post()).status).toBe(503);

    expect(store.rows).toHaveLength(1);
    expect(mocks.quarantine).not.toHaveBeenCalled();
  });

  it('is credited by the redelivery once the archive is readable, on its own full-authority row', async () => {
    vi.stubEnv('PIGGYVEST_WEBHOOK_KEY_ARCHIVE', UNREADABLE_ARCHIVE);
    expect((await post()).status).toBe(503);

    vi.stubEnv('PIGGYVEST_WEBHOOK_KEY_ARCHIVE', archiveWithBankAssignment());
    const redelivery = await post();

    expect(redelivery.status).toBe(200);
    expect(await redelivery.json()).toEqual({
      received: true,
      bankQueued: true,
    });
    expect(mocks.bankIntake).toHaveBeenCalledTimes(1);
    expect(mocks.quarantine).not.toHaveBeenCalled();
    expect(store.rows).toHaveLength(2);
    const [partial, full] = store.rows;
    // The row admitted under the partial set keeps its recorded authority.
    expect(partial?.keyFamilies).toEqual(['interest']);
    expect(partial?.processingState).toBe('pending');
    expect([...(full?.keyFamilies ?? [])].sort()).toEqual(['bank', 'interest']);
    expect(full?.processingState).toBe('processed');
  });
});

describe('replay of a row whose recorded family is not loaded right now', () => {
  async function pendingFullAuthorityRow() {
    vi.stubEnv('PIGGYVEST_WEBHOOK_KEY_ARCHIVE', archiveWithBankAssignment());
    mocks.bankIntake.mockRejectedValueOnce(new Error('transient intake'));
    const first = await post();
    // Attested drain owns the retry, so the provider is told it is durable.
    expect(first.status).toBe(200);
    expect(store.rows).toHaveLength(1);
    expect([...(store.rows[0]?.keyFamilies ?? [])].sort()).toEqual([
      'bank',
      'interest',
    ]);
    expect(store.rows[0]?.processingState).toBe('pending');
    mocks.bankIntake.mockClear();
  }

  it('defers instead of quarantining or burning attempts while the archive is unreadable, then credits once readable', async () => {
    await pendingFullAuthorityRow();
    vi.stubEnv('PIGGYVEST_WEBHOOK_KEY_ARCHIVE', UNREADABLE_ARCHIVE);

    const blocked = await drain();

    expect(blocked).toMatchObject({ claimed: 1, retried: 1, needsReview: 0 });
    expect(mocks.bankIntake).not.toHaveBeenCalled();
    expect(mocks.quarantine).not.toHaveBeenCalled();
    expect(store.resolveCalls).toEqual([
      expect.objectContaining({
        p_state: 'deferred',
        p_error: 'KEY_SET_INCOMPLETE',
      }),
    ]);
    expect(store.rows[0]?.processingState).toBe('pending');

    vi.stubEnv('PIGGYVEST_WEBHOOK_KEY_ARCHIVE', archiveWithBankAssignment());
    const recovered = await drain();

    expect(recovered).toMatchObject({ claimed: 1, processed: 1 });
    expect(mocks.bankIntake).toHaveBeenCalledTimes(1);
    expect(store.rows[0]?.processingState).toBe('processed');
  });
});
