import { createCipheriv, createHash, createHmac } from 'node:crypto';
import { vi } from 'vitest';
import { verifyPrefundedCardLegacyProof } from './prefunded-card-legacy-proof';

const configuration = {
  integrationId: 'd91d9e87-8e0d-44de-9b84-1e1d709633d2',
  systemIdentifier: '7685292944002592802',
  webhookSecret: 'synthetic-secret',
  piggyvest: {
    apiBaseUrl: 'https://staging.piggyvest.business',
    apiSecret: 'synthetic-secret',
    expectedBusinessId: 'business-test',
    expectedCurrency: 'NGN',
  },
};
const legacy = {
  integrationId: configuration.integrationId,
  merchantId: '10000000-0000-4000-8000-000000000001',
  customerId: '10000000-0000-4000-8000-000000000002',
  goalId: '430314fd-cd8b-4579-98d4-e9f345713dd6',
  contributionId: '10000000-0000-4000-8000-000000000003',
  providerTransactionId: 'legacy-uuid-transaction',
  eventDataId: 'legacy-event-data-id',
  eventId: 'event-legacy',
  providerWalletId: 'wallet-test',
  providerCustomerId: 'customer-test',
  amountKobo: 10000,
  feeKobo: 0,
  reference: 'reference-test',
  sessionId: null,
  creditedAt: '2026-09-25T12:00:00Z',
};
const envelope = {
  eventId: legacy.eventId,
  eventType: 'bank-transfer.inflow.success',
  eventCategory: 'inflow_transaction',
  customer_id: legacy.providerCustomerId,
  pvb_reference: 'PVB-normalized-transaction',
  pvb_wallet: legacy.providerWalletId,
  eventData: {
    id: legacy.eventDataId,
    transaction_id: legacy.providerTransactionId,
    customer_id: legacy.providerCustomerId,
    destination_wallet_id: 'provider-inner-wallet-id',
    type: 'inter',
    category: 'bank_transfer_inflow',
    status: 'COMPLETED',
    amount: 10000,
    fee: 0,
    currency: 'NGN',
    reference: legacy.reference,
    timestamp: legacy.creditedAt,
    session_id: null,
  },
};

function setup(
  options: {
    legacy?: Partial<typeof legacy>;
    transaction?: Record<string, unknown>;
    businessId?: string;
    apiCustomerId?: string;
    signature?: string | null;
    fingerprint?: string;
    now?: () => number;
    nowValues?: number[];
    monotonicNow?: () => number;
    reconcileStoredReceipt?: boolean;
  } = {}
) {
  const rawPayload = Buffer.from(JSON.stringify(envelope));
  const fingerprint = createHash('sha256').update(rawPayload).digest('hex');
  const encryptionKey = Buffer.alloc(32, 9);
  const nonce = Buffer.alloc(12, 8);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, nonce);
  cipher.setAAD(Buffer.from(`piggyvest-staging:staging-v1:${fingerprint}`));
  const ciphertext = Buffer.concat([cipher.update(rawPayload), cipher.final()]);
  const sealed = {
    payloadSha256: fingerprint,
    ciphertext: ciphertext.toString('base64'),
    nonce: nonce.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    keyVersion: 'staging-v1',
  };
  const fetchImplementation = vi.fn(
    (url: string | URL | Request, _init?: RequestInit) => {
      const address = String(url);
      const wallet = {
        id: legacy.providerWalletId,
        business_id: options.businessId ?? 'business-test',
        currency: 'NGN',
        balance: 10000,
        status: 'active',
        ...(options.apiCustomerId
          ? { api_customer_id: options.apiCustomerId }
          : {}),
      };
      let data: unknown = wallet;
      if (address.includes('/wallet-type?')) {
        data = { paginatedPayload: { edges: [wallet] } };
      } else if (address.includes('/transaction/')) {
        data = {
          id: envelope.pvb_reference,
          customer_id: legacy.providerCustomerId,
          source_wallet: '',
          destination_wallet: legacy.providerWalletId,
          reference: legacy.reference,
          category: 'bank_transfer_inflow',
          status: 'successful',
          amount: 10000,
          fee: 0,
          ...options.transaction,
        };
      }
      return Promise.resolve(
        new Response(JSON.stringify({ status: true, data }), {
          headers: { 'Content-Type': 'application/json' },
        })
      );
    }
  );
  let nowValueIndex = 0;
  const now = () => {
    if (options.nowValues) {
      return (
        options.nowValues[nowValueIndex++] ??
        options.nowValues.at(-1) ??
        Date.parse('2026-09-27T12:00:00Z')
      );
    }
    return options.now?.() ?? Date.parse('2026-09-27T12:00:00Z');
  };
  const run = () =>
    verifyPrefundedCardLegacyProof({
      configuration,
      legacy: { ...legacy, ...options.legacy },
      receipt: {
        receiptId: '20000000-0000-4000-8000-000000000001',
        payloadSha256: options.fingerprint ?? fingerprint,
        rawPayload,
        signature:
          options.signature === undefined
            ? createHmac('sha512', configuration.webhookSecret)
                .update(rawPayload)
                .digest('hex')
            : options.signature,
        ...(options.reconcileStoredReceipt
          ? { sealed, encryptionKey: encryptionKey.toString('base64') }
          : {}),
      },
      fetchImplementation,
      now,
      monotonicNow: options.monotonicNow ?? (() => 0),
    });
  return { run, fetchImplementation, fingerprint };
}

export const prefundedCardLegacyProofTestFixture = { setup, legacy, envelope };
