import { createCipheriv, createHash } from 'node:crypto';
import { vi } from 'vitest';
import type { ReplayAdapters, ReplayLease } from './replay-worker';

export const key = Buffer.alloc(32, 7);
export const event = {
  eventId: 'evt-worker-001',
  eventType: 'bank-transfer.inflow.success',
  eventCategory: 'inflow_transaction',
  customer_id: 'provider-customer-001',
  eventData: {
    id: 'event-data-001',
    customer_id: 'provider-customer-001',
    destination_wallet_id: 'conduit-wallet-001',
    type: 'inter',
    category: 'bank_transfer_inflow',
    amount: 10000,
    currency: 'NGN',
    narration: 'synthetic',
    ip_address: '127.0.0.1',
    transaction_id: 'transaction-001',
    timestamp: '2026-09-18T17:57:47.566Z',
    status: 'COMPLETED',
    third_party_reference: 'third-party-001',
    initiator_reference: 'initiator-001',
    internal_reference: 'internal-001',
    provider: 'FAAS',
    destination_wallet_balance: 10000,
    destination_wallet_ledger_balance: 10000,
    destination_transaction_balance: 10000,
    reference: 'reference-001',
    fee: 0,
  },
  pvb_reference: 'pvb-reference-001',
  pvb_wallet: 'api-wallet-001',
};

export function lease(eventValue = event): ReplayLease {
  const raw = Buffer.from(JSON.stringify(eventValue), 'utf8');
  const payloadSha256 = createHash('sha256').update(raw).digest('hex');
  const nonce = Buffer.alloc(12, 3);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(`piggyvest-staging:staging-v1:${payloadSha256}`));
  const ciphertext = Buffer.concat([cipher.update(raw), cipher.final()]);
  return {
    receiptId: 'receipt-001',
    eventId: eventValue.eventId,
    claimToken: 'claim-001',
    sealed: {
      payloadSha256,
      ciphertext: ciphertext.toString('base64'),
      nonce: nonce.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      keyVersion: 'staging-v1',
    },
  };
}

export function secondLease(): ReplayLease {
  return {
    ...lease({ ...event, eventId: 'evt-worker-002' }),
    receiptId: 'receipt-002',
    claimToken: 'claim-002',
  };
}

export function adapters(
  overrides: Partial<ReplayAdapters> = {}
): ReplayAdapters {
  return {
    claimBatch: vi.fn(async () => [lease()]),
    resolveMapping: vi.fn<ReplayAdapters['resolveMapping']>(async () => ({
      status: 'matched',
      mapping: {
        merchantId: 'merchant-001',
        customerId: 'customer-001',
        providerCustomerId: 'provider-customer-001',
        pvbWallet: 'api-wallet-001',
      },
    })),
    dispatch: vi.fn(async () => 'applied' as const),
    quarantine: vi.fn(async () => undefined),
    resolve: vi.fn(async () => undefined),
    ...overrides,
  };
}
