import { createHmac } from 'node:crypto';
import { verifyStoredPiggyvestDelivery } from '@/lib/piggyvest/verify-stored-piggyvest-delivery';
import { drainPiggyvestWebhookCaptures } from '@/lib/piggyvest/webhook-capture-drain';
import {
  isAuthorizationQuarantine,
  isKeySetIncompleteRetry,
  processVerifiedDelivery,
} from './process-delivery';
import type { createFakeCaptureStore } from './route.capture-test-support';

/**
 * Fixtures for the incomplete-key-set receiver suite. The suite keeps its
 * own `vi.mock` calls (hoisted per test file) and its own mutable state.
 */

const HOUR = 3_600_000;
export const sign = (secret: string, body: string) =>
  createHmac('sha512', secret).update(body).digest('hex');

export const inflow = JSON.stringify({
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

export const UNREADABLE_ARCHIVE = '{not json';
export const COMPLETE_ARCHIVE_WITHOUT_BANK = '[]';

/** The archive entry that gives `sharedKey` its overlap assignment for bank. */
export const archiveWithBankAssignment = (sharedKey: string) =>
  JSON.stringify([
    {
      version: 'k-bank',
      family: 'bank',
      secret: sharedKey,
      retiredAt: new Date(Date.now() - 2 * HOUR).toISOString(),
    },
  ]);

/** One drain run over the fake capture store, replaying with the real verifier. */
export function replayDrain(store: ReturnType<typeof createFakeCaptureStore>) {
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
