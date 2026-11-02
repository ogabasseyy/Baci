import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Replay re-verifies authenticity but must never widen authority. A key
 * that is current only for the interest family, whose legacy assignment (an
 * archived entry for the same secret) has expired, verifies as
 * {interest, legacy} on replay. A bank deposit that was quarantined at
 * ingress must not reach the legacy handler after a drain.
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

import { deterministicKeySource } from '@/lib/piggyvest/deterministic-test-data.test-support';
import { verifyStoredPiggyvestDelivery } from '@/lib/piggyvest/verify-stored-piggyvest-delivery';
import { drainPiggyvestWebhookCaptures } from '@/lib/piggyvest/webhook-capture-drain';
import {
  isAuthorizationQuarantine,
  processVerifiedDelivery,
} from './process-delivery';
import { POST } from './route';
import { createFakeCaptureStore } from './route.capture-test-support';

const freshKey = deterministicKeySource('route.capture.authority');

const HOUR = 3_600_000;
const inflow = JSON.stringify({
  eventId: 'evt-authority-1',
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
let sharedKey: string;

function post(secret: string) {
  return POST(
    new NextRequest('https://usebaci.com/api/webhooks/piggyvest', {
      method: 'POST',
      body: inflow,
      headers: {
        'content-type': 'application/json',
        'x-pvb-signature': createHmac('sha512', secret)
          .update(inflow)
          .digest('hex'),
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
      };
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  store = createFakeCaptureStore();
  sharedKey = freshKey();
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('PIGGYVEST_SECRET_KEY', freshKey());
  vi.stubEnv('PVB_SECRET_KEY', '');
  vi.stubEnv('PIGGYVEST_PRIMARY_PAID_INTEREST_WEBHOOK_SECRET', sharedKey);
  vi.stubEnv('PIGGYVEST_WEBHOOK_KEY_OVERLAP_HOURS', '');
  vi.stubEnv(
    'PIGGYVEST_WEBHOOK_KEY_ARCHIVE',
    JSON.stringify([
      {
        version: 'legacy-old',
        family: 'legacy',
        secret: sharedKey,
        retiredAt: new Date(Date.now() - 200 * HOUR).toISOString(),
      },
    ])
  );
  vi.stubEnv('PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_SCHEDULED', 'true');
  mocks.createServiceClient.mockImplementation(() => store.client());
  mocks.inflow.mockResolvedValue('ignored');
  mocks.quarantine.mockResolvedValue('recorded');
  mocks.recordPiggyvestEvent.mockResolvedValue('new');
  mocks.processPiggyvestEvent.mockResolvedValue('processed');
  mocks.bankIntake.mockResolvedValue({ outcome: 'accepted', response: null });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('a bank deposit quarantined at ingress cannot reach the legacy handler through a drain', () => {
  it('is admitted and quarantined as an interest-family delivery', async () => {
    const response = await post(sharedKey);

    expect(await response.json()).toEqual({
      received: true,
      quarantined: true,
    });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.keyFamilies).toEqual(['interest']);
    expect(store.rows[0]?.processingState).toBe('pending');
    expect(mocks.recordPiggyvestEvent).not.toHaveBeenCalled();
  });

  it('is not widened to legacy by replay, however often the drain runs', async () => {
    await post(sharedKey);

    for (let run = 0; run < 3; run += 1) await drain();

    expect(mocks.recordPiggyvestEvent).not.toHaveBeenCalled();
    expect(mocks.processPiggyvestEvent).not.toHaveBeenCalled();
    expect(mocks.bankIntake).not.toHaveBeenCalled();
    // Each replay re-quarantines it as the key-family mismatch it is.
    expect(mocks.quarantine.mock.calls.length).toBeGreaterThan(1);
    expect(
      mocks.quarantine.mock.calls.every(
        (call) => call[1].reason === 'key-family'
      )
    ).toBe(true);
  });
});
