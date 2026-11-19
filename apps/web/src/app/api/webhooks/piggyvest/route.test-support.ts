import { createHash, createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { type Mock, vi } from 'vitest';

/**
 * Fixtures shared by the PiggyVest receiver suites (route.test.ts and
 * route.processing-failure.test.ts). The suites keep their own `vi.mock`
 * calls: those are hoisted per test file and cannot live here.
 */

// HMAC key derived at runtime from a stable non-secret label: deterministic
// for reproducibility (no random test data); the label is an identifier,
// not key material, and is used only by these test verifiers.
export const SECRET = createHash('sha256')
  .update('synthetic-staging-secret')
  .digest('hex');

export function chainable(
  result: { data: unknown; error: unknown },
  existing: unknown = MATCHING_ENVELOPE
): {
  query: Record<string, unknown>;
  upsert: Mock<(...args: unknown[]) => Record<string, unknown>>;
} {
  const query: Record<string, unknown> = {};
  const upsert = vi.fn((..._args: unknown[]) => query);
  // select() is both awaitable (upsert result) and chainable (duplicate
  // verify read via .eq().maybeSingle()).
  const select = vi.fn(() =>
    Object.assign(Promise.resolve(result), {
      eq: vi.fn(() => ({
        maybeSingle: async () => ({ data: existing, error: null }),
      })),
    })
  );
  const then = (resolve: (value: unknown) => void) =>
    Promise.resolve(result).then(resolve);
  Object.assign(query, { select, then, upsert });
  return { query, upsert };
}

export function signPayload(rawBody: string): string {
  return createHmac('sha512', SECRET).update(rawBody).digest('hex');
}

export function createRequest(
  rawBody: string,
  signature?: string
): NextRequest {
  return new NextRequest('https://usebaci.com/api/webhooks/piggyvest', {
    body: rawBody,
    headers: {
      'Content-Type': 'application/json',
      ...(signature ? { 'x-pvb-signature': signature } : {}),
    },
    method: 'POST',
  });
}

export const inflowEvent = {
  eventId: '4204dc18-efb3-44d0-b9a2-1362448d4f21',
  eventType: 'bank-transfer.inflow.success',
  eventCategory: 'bank-transfer',
  customer_id: 'c0065070-dc32-45d2-9c01-871a27abfd10',
  eventData: {
    id: 'faas-txn-synthetic-001',
    customer_id: 'c0065070-dc32-45d2-9c01-871a27abfd10',
    source_wallet_id: '',
    destination_wallet_id: 'faas-wallet-synthetic-001',
    type: 'inflow',
    category: 'bank_transfer_inflow',
    amount: 1750000,
    currency: 'NGN',
    narration: 'Transfer from SYNTHETIC SENDER',
    ip_address: '',
    transaction_id: 'provider-txn-synthetic-001',
    timestamp: '2026-09-15T10:12:00.000Z',
    status: 'success',
    third_party_reference: 'synthetic-third-party-ref',
    initiator_reference: 'synthetic-initiator-ref',
    internal_reference: 'synthetic-internal-ref',
    attempts: 1,
    provider: 'wema',
    destination_wallet_balance: 5000000,
    destination_wallet_ledger_balance: 5000000,
    destination_transaction_balance: 5000000,
    reference: 'faas-ref-synthetic-001',
    recipient_bank_account_number: '9000000001',
    recipient_bank_account_name: 'SYNTHETIC LTD',
    sender_bank_account_number: '0000000001',
    sender_bank_name: 'Synthetic Bank',
    sender_name: 'SYNTHETIC SENDER',
    session_id: '000000000001',
    fee: 0,
  },
  pvb_reference: 'pvb-txn-synthetic-001',
  pvb_wallet: 'pvb-wallet-synthetic-001',
  pvb_destination_wallet: null,
  pvb_third_party_reference: null,
  pvb_schedule_payment_id: null,
  pvb_destination_account_creation_reference: null,
  pvb_meta: null,
};

export const MATCHING_ENVELOPE = {
  event_type: 'bank-transfer.inflow.success',
  event_category: 'bank-transfer',
  customer_id: inflowEvent.customer_id,
  wallet_id: inflowEvent.pvb_wallet,
  reference: inflowEvent.pvb_reference,
  amount_kobo: 1750000,
  event_details: { transaction_id: inflowEvent.eventData.transaction_id },
};
