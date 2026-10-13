import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { createDurableReplayAdapters, type StoreRpc } from './replay-store';
import { key } from './replay-test-fixtures';
import { DispatchQuarantine } from './replay-worker';

const SEALED_ROW = {
  receipt_id: 'receipt-001',
  payload_sha256: 'a'.repeat(64),
  ciphertext: 'YWJj',
  nonce: 'AAAAAAAAAAAAAAAA',
  auth_tag: 'AAAAAAAAAAAAAAAAAAAAAA==',
  key_version: 'staging-v1',
  claim_token: 'claim-001',
  attempts: 1,
};

const MAPPING_ROW = {
  customer_id: 'customer-001',
  merchant_id: 'merchant-001',
  provider_customer_id: 'provider-customer-001',
  provider_wallet_id: 'api-wallet-001',
};

const INFLOW_EVENT = {
  eventId: 'evt-001',
  eventType: 'bank-transfer.inflow.success',
  eventCategory: 'inflow_transaction',
  customer_id: 'provider-customer-001',
  eventData: {
    id: 'event-data-001',
    customer_id: 'provider-customer-001',
    destination_wallet_id: 'conduit-001',
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
} as const;

function mockStore(
  rows: unknown[] = [SEALED_ROW],
  inflowOutcome: unknown = 'recognized'
): {
  rpc: StoreRpc;
  calls: Array<{ fn: string; params: Record<string, unknown> }>;
} {
  const calls: Array<{ fn: string; params: Record<string, unknown> }> = [];
  return {
    calls,
    rpc: {
      call: vi.fn(
        async <T>(fn: string, params: Record<string, unknown>): Promise<T> => {
          calls.push({ fn, params });
          if (fn === 'claim_piggyvest_staging_receipts') return rows as T;
          if (fn === 'recognize_piggyvest_staging_inflow')
            return inflowOutcome as T;
          return true as T;
        }
      ) as StoreRpc['call'],
    },
  };
}

function mockApp(
  mapping: unknown = MAPPING_ROW,
  credit: unknown[] = [{ provider_transaction_id: 'transaction-001' }]
): {
  client: SupabaseClient;
  upsert: ReturnType<typeof vi.fn>;
} {
  const upsert = vi.fn(() => ({
    select: vi.fn(async () => ({ data: credit, error: null })),
  }));
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    eq: vi.fn(() => chain),
    maybeSingle: async () => ({ data: mapping, error: null }),
    select: vi.fn(() => chain),
    upsert,
  });
  return {
    client: {
      from: vi.fn(() => chain),
      rpc: vi.fn(async () => ({ data: [mapping], error: null })),
    } as unknown as SupabaseClient,
    upsert,
  };
}

function adaptersFor(
  store: StoreRpc,
  app: SupabaseClient,
  leaseSeconds = 300,
  keyResolver: (keyVersion: string) => Promise<Buffer | null> = async () => key
) {
  return createDurableReplayAdapters({
    store,
    app,
    keyResolver,
    leaseSeconds,
  });
}

describe('durable dispatch', () => {
  it('returns applied only after the ledger insert reports back', async () => {
    const { rpc, calls } = mockStore();
    const { client } = mockApp();
    client.rpc = vi.fn(async (fn, params) => ({
      data: await rpc.call(fn, params ?? {}),
      error: null,
    })) as unknown as SupabaseClient['rpc'];
    const adapters = adaptersFor(rpc, client);

    await expect(
      adapters.dispatch({
        lease: {
          receiptId: 'receipt-001',
          eventId: 'evt-001',
          claimToken: 'claim-001',
          sealed: {
            payloadSha256: 'a'.repeat(64),
            ciphertext: 'YWJj',
            nonce: 'AAAAAAAAAAAAAAAA',
            authTag: 'AAAAAAAAAAAAAAAAAAAAAA==',
            keyVersion: 'staging-v1',
          },
        },
        event: INFLOW_EVENT as unknown as Parameters<
          typeof adapters.dispatch
        >[0]['event'],
        mapping: {
          merchantId: 'merchant-001',
          customerId: 'customer-001',
          providerCustomerId: 'provider-customer-001',
          pvbWallet: 'api-wallet-001',
        },
      })
    ).resolves.toBe('applied');
    expect(calls).toContainEqual({
      fn: 'recognize_piggyvest_staging_inflow',
      params: expect.objectContaining({
        p_provider_transaction_id: 'transaction-001',
        p_event_data_id: 'event-data-001',
        p_event_id: 'evt-001',
        p_provider_customer_id: 'provider-customer-001',
        p_wallet_id: 'api-wallet-001',
        p_amount_kobo: 10000,
        p_fee_kobo: 0,
        p_reference: 'reference-001',
        p_session_id: null,
        p_credited_at: '2026-09-18T17:57:47.566Z',
      }),
    });
  });

  it('returns duplicate when the ledger collapses the redelivery', async () => {
    const { rpc } = mockStore([SEALED_ROW], 'duplicate');
    const { client } = mockApp(MAPPING_ROW, []);
    client.rpc = vi.fn(async (fn, params) => ({
      data: await rpc.call(fn, params ?? {}),
      error: null,
    })) as unknown as SupabaseClient['rpc'];
    const adapters = adaptersFor(rpc, client);

    await expect(
      adapters.dispatch({
        lease: {
          receiptId: 'receipt-001',
          eventId: 'evt-001',
          claimToken: 'claim-001',
          sealed: {
            payloadSha256: 'a'.repeat(64),
            ciphertext: 'YWJj',
            nonce: 'AAAAAAAAAAAAAAAA',
            authTag: 'AAAAAAAAAAAAAAAAAAAAAA==',
            keyVersion: 'staging-v1',
          },
        },
        event: INFLOW_EVENT as unknown as Parameters<
          typeof adapters.dispatch
        >[0]['event'],
        mapping: {
          merchantId: 'merchant-001',
          customerId: 'customer-001',
          providerCustomerId: 'provider-customer-001',
          pvbWallet: 'api-wallet-001',
        },
      })
    ).resolves.toBe('duplicate');
  });

  it('quarantines poison instead of reporting processed', async () => {
    const rpc: StoreRpc = {
      call: vi.fn(async <T>(fn: string): Promise<T> => {
        if (fn === 'recognize_piggyvest_staging_inflow') {
          throw Object.assign(new Error('invalid inflow'), { code: '22023' });
        }
        return [] as T;
      }) as StoreRpc['call'],
    };
    const { client } = mockApp();
    client.rpc = vi.fn(async (fn, params) => ({
      data: await rpc.call(fn, params ?? {}),
      error: null,
    })) as unknown as SupabaseClient['rpc'];
    const adapters = adaptersFor(rpc, client);

    const error = await adapters
      .dispatch({
        lease: {
          receiptId: 'receipt-001',
          eventId: 'evt-001',
          claimToken: 'claim-001',
          sealed: {
            payloadSha256: 'a'.repeat(64),
            ciphertext: 'YWJj',
            nonce: 'AAAAAAAAAAAAAAAA',
            authTag: 'AAAAAAAAAAAAAAAAAAAAAA==',
            keyVersion: 'staging-v1',
          },
        },
        event: INFLOW_EVENT as unknown as Parameters<
          typeof adapters.dispatch
        >[0]['event'],
        mapping: {
          merchantId: 'merchant-001',
          customerId: 'customer-001',
          providerCustomerId: 'provider-customer-001',
          pvbWallet: 'api-wallet-001',
        },
      })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(DispatchQuarantine);
    expect(error).toMatchObject({ reason: 'poison', eventId: 'evt-001' });
  });

  it('quarantines unsupported shapes without touching the ledger', async () => {
    const { rpc } = mockStore();
    const { client, upsert } = mockApp();
    const adapters = adaptersFor(rpc, client);

    const error = await adapters
      .dispatch({
        lease: {
          receiptId: 'receipt-001',
          eventId: 'evt-001',
          claimToken: 'claim-001',
          sealed: {
            payloadSha256: 'a'.repeat(64),
            ciphertext: 'YWJj',
            nonce: 'AAAAAAAAAAAAAAAA',
            authTag: 'AAAAAAAAAAAAAAAAAAAAAA==',
            keyVersion: 'staging-v1',
          },
        },
        event: {
          ...INFLOW_EVENT,
          eventType: 'restriction-created.success',
        } as unknown as Parameters<typeof adapters.dispatch>[0]['event'],
        mapping: {
          merchantId: 'merchant-001',
          customerId: 'customer-001',
          providerCustomerId: 'provider-customer-001',
          pvbWallet: 'api-wallet-001',
        },
      })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(DispatchQuarantine);
    expect(error).toMatchObject({ reason: 'unsupported' });
    expect(upsert).not.toHaveBeenCalled();
  });
});
