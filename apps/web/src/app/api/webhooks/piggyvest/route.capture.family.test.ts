import { createHmac, randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A delivery quarantined because it was signed by the wrong key family
 * never ran the financial handler. Its capture must not be resolved as
 * processed: a later, correctly signed redelivery of the same bytes hits
 * the (event key, body digest) dedupe, and a processed short-circuit would
 * drop the deposit forever.
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
  processVerifiedDelivery,
} from './process-delivery';
import { POST } from './route';
import { createFakeCaptureStore } from './route.capture-test-support';

const HOUR = 3_600_000;
const sign = (secret: string, body: string) =>
  createHmac('sha512', secret).update(body).digest('hex');

const inflow = JSON.stringify({
  eventId: 'evt-family-1',
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
let wrongFamilyKey: string;
let bankKey: string;
let alerts: ReturnType<typeof vi.spyOn>;

function post(secret: string) {
  return POST(
    new NextRequest('https://usebaci.com/api/webhooks/piggyvest', {
      method: 'POST',
      body: inflow,
      headers: {
        'content-type': 'application/json',
        'x-pvb-signature': sign(secret, inflow),
      },
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  store = createFakeCaptureStore();
  wrongFamilyKey = randomBytes(32).toString('hex');
  bankKey = randomBytes(32).toString('hex');
  const retiredAt = new Date(Date.now() - 2 * HOUR).toISOString();
  vi.stubEnv('PIGGYVEST_SECRET_KEY', randomBytes(32).toString('hex'));
  vi.stubEnv('PVB_SECRET_KEY', '');
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('PIGGYVEST_WEBHOOK_KEY_OVERLAP_HOURS', '');
  vi.stubEnv(
    'PIGGYVEST_WEBHOOK_KEY_ARCHIVE',
    JSON.stringify([
      {
        version: 'k-wrong',
        family: 'interest',
        secret: wrongFamilyKey,
        retiredAt,
      },
      { version: 'k-bank', family: 'bank', secret: bankKey, retiredAt },
    ])
  );
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

describe('capture identity includes the matched signing family', () => {
  it('quarantines the wrong-family delivery and leaves its capture pending', async () => {
    const response = await post(wrongFamilyKey);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      received: true,
      quarantined: true,
    });
    expect(mocks.quarantine).toHaveBeenCalledTimes(1);
    expect(mocks.bankIntake).not.toHaveBeenCalled();
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.processingState).toBe('pending');
    expect(store.resolveCalls).toEqual([]);
  });

  it('a correctly signed redelivery gets its own row with its own signature and credits once', async () => {
    await post(wrongFamilyKey);

    const second = await post(bankKey);

    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ received: true, bankQueued: true });
    expect(mocks.bankIntake).toHaveBeenCalledTimes(1);
    expect(store.rows).toHaveLength(2);
    const [wrong, corrected] = store.rows;
    expect(wrong?.keyFamilies).toEqual(['interest']);
    expect(corrected?.keyFamilies).toEqual(['bank']);
    expect(wrong?.signature).toBe(sign(wrongFamilyKey, inflow));
    expect(corrected?.signature).toBe(sign(bankKey, inflow));
    expect(wrong?.rawHex).toBe(corrected?.rawHex);
    expect(wrong?.processingState).toBe('pending');
    expect(corrected?.processingState).toBe('processed');
  });

  it('a same-family duplicate is still deduplicated to one row', async () => {
    await post(wrongFamilyKey);
    await post(wrongFamilyKey);

    expect(store.rows).toHaveLength(1);
    expect(mocks.quarantine).toHaveBeenCalledTimes(2);

    await post(bankKey);
    await post(bankKey);
    expect(store.rows).toHaveLength(2);
  });

  it('a processed bank-family duplicate short-circuits without reprocessing', async () => {
    await post(wrongFamilyKey);
    await post(bankKey);
    mocks.bankIntake.mockClear();

    const third = await post(bankKey);

    expect(await third.json()).toEqual({ received: true, duplicate: true });
    expect(mocks.bankIntake).not.toHaveBeenCalled();
    expect(mocks.quarantine).toHaveBeenCalledTimes(1);
    expect(store.rows).toHaveLength(2);
  });

  it('the processed row of one family never short-circuits another family', async () => {
    await post(bankKey);
    expect(store.rows[0]?.processingState).toBe('processed');

    const wrong = await post(wrongFamilyKey);

    expect(await wrong.json()).toEqual({ received: true, quarantined: true });
    expect(store.rows).toHaveLength(2);
    expect(store.rows[1]?.processingState).toBe('pending');
  });
});

describe('a transient failure on the corrected delivery, then a drain run', () => {
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
        };
      },
    });
  }

  it('reaches the bank handler from the corrected row and credits exactly once', async () => {
    await post(wrongFamilyKey);
    mocks.bankIntake.mockRejectedValueOnce(
      new Error('transient intake failure')
    );

    const corrected = await post(bankKey);

    // The drain is attested, so the provider is told the delivery is
    // durable; the corrected row waits for the drain.
    expect(corrected.status).toBe(200);
    expect(await corrected.json()).toMatchObject({ processing: 'deferred' });
    expect(store.rows.map((row) => row.processingState)).toEqual([
      'pending',
      'pending',
    ]);

    const summary = await drain();

    // The wrong-family row is replayed under its OWN signature (still the
    // wrong family, never the bank handler); the corrected row credits.
    expect(summary).toMatchObject({
      claimed: 2,
      processed: 1,
      needsReview: 1,
    });
    expect(mocks.bankIntake).toHaveBeenCalledTimes(2);
    // One call failed transiently, exactly one was accepted.
    const settled = await Promise.allSettled(
      mocks.bankIntake.mock.results.map((result) => result.value)
    );
    expect(
      settled.filter((result) => result.status === 'fulfilled')
    ).toHaveLength(1);
    expect(
      store.rows.filter((row) => row.processingState === 'processed')
    ).toHaveLength(1);
    expect(store.rows[1]?.processingState).toBe('processed');
    // It can never succeed (its recorded authority is immutable), so the
    // drain parks it for review instead of retrying it 20 times.
    expect(store.rows[0]?.processingState).toBe('needs_review');

    // Replaying again must not credit a second time.
    await drain();
    expect(mocks.bankIntake).toHaveBeenCalledTimes(2);
  });
});
