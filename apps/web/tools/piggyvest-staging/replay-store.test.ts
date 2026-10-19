import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
  createDurableReplayAdapters,
  createSupabaseRpc,
  type StoreRpc,
} from './replay-store';
import { key, lease } from './replay-test-fixtures';

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
      rpc: vi.fn(async (fn: string) => ({
        data:
          fn === 'resolve_piggyvest_staging_goal_mapping'
            ? mapping
              ? [mapping]
              : []
            : null,
        error: null,
      })),
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

describe('durable claimBatch', () => {
  it('returns every sealed claim for worker validation and accounting', async () => {
    const sealed = lease();
    const { rpc, calls } = mockStore([
      {
        receipt_id: 'receipt-001',
        payload_sha256: sealed.sealed.payloadSha256,
        ciphertext: sealed.sealed.ciphertext,
        nonce: sealed.sealed.nonce,
        auth_tag: sealed.sealed.authTag,
        key_version: 'staging-v1',
        claim_token: 'claim-001',
        attempts: 1,
      },
    ]);
    const { client } = mockApp();
    const leases = await adaptersFor(rpc, client).claimBatch({ limit: 5 });

    expect(leases).toHaveLength(1);
    expect(leases[0]).toMatchObject({
      receiptId: 'receipt-001',
      eventId: null,
      claimToken: 'claim-001',
    });
    expect(calls[0]).toMatchObject({
      fn: 'claim_piggyvest_staging_receipts',
      params: { p_limit: 5, p_lease_seconds: 300 },
    });
  });

  it('returns undecryptable rows to the worker rather than hiding them from counts', async () => {
    const { rpc, calls } = mockStore([SEALED_ROW]);
    const { client } = mockApp();
    const leases = await adaptersFor(
      rpc,
      client,
      300,
      async () => null
    ).claimBatch({ limit: 5 });

    expect(leases).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it('fails closed on malformed claim rows rather than reporting an empty healthy batch', async () => {
    const { rpc } = mockStore([{ receipt_id: 'broken' }]);
    const { client } = mockApp();
    await expect(
      adaptersFor(rpc, client).claimBatch({ limit: 5 })
    ).rejects.toThrow('Replay claim schema mismatch');
  });
});

describe('durable resolveMapping', () => {
  it('matches exact provider customer and pvb_wallet', async () => {
    const { rpc } = mockStore();
    const { client } = mockApp();
    await expect(
      adaptersFor(rpc, client).resolveMapping({
        providerCustomerId: 'provider-customer-001',
        pvbWallet: 'api-wallet-001',
      })
    ).resolves.toMatchObject({
      status: 'matched',
      mapping: { merchantId: 'merchant-001', pvbWallet: 'api-wallet-001' },
    });
  });

  it('returns unmapped when no wallet row exists', async () => {
    const { rpc } = mockStore();
    const { client } = mockApp(null);
    await expect(
      adaptersFor(rpc, client).resolveMapping({
        providerCustomerId: 'provider-customer-001',
        pvbWallet: 'api-wallet-001',
      })
    ).resolves.toEqual({ status: 'unmapped' });
  });

  it('returns ambiguous on a customer mismatch instead of another tenant', async () => {
    const { rpc } = mockStore();
    const { client } = mockApp({
      ...MAPPING_ROW,
      provider_customer_id: 'other-provider',
    });
    await expect(
      adaptersFor(rpc, client).resolveMapping({
        providerCustomerId: 'provider-customer-001',
        pvbWallet: 'api-wallet-001',
      })
    ).resolves.toEqual({ status: 'ambiguous' });
  });

  it('uses the restricted private-map resolver rather than reading the public probe table', async () => {
    const { rpc } = mockStore();
    const { client } = mockApp();
    const adapter = adaptersFor(rpc, client);
    await adapter.resolveMapping({
      providerCustomerId: 'provider-customer-001',
      pvbWallet: 'api-wallet-001',
    });

    expect(client.from).not.toHaveBeenCalled();
    expect(client.rpc).toHaveBeenCalledWith(
      'resolve_piggyvest_staging_goal_mapping',
      {
        p_provider_customer_id: 'provider-customer-001',
        p_wallet_id: 'api-wallet-001',
      }
    );
  });

  it('refuses an ambiguous private resolver response', async () => {
    const { rpc } = mockStore();
    const { client } = mockApp();
    client.rpc = vi.fn(async () => ({
      data: [MAPPING_ROW, MAPPING_ROW],
      error: null,
    })) as unknown as SupabaseClient['rpc'];
    await expect(
      adaptersFor(rpc, client).resolveMapping({
        providerCustomerId: 'provider-customer-001',
        pvbWallet: 'api-wallet-001',
      })
    ).resolves.toEqual({ status: 'ambiguous' });
  });
});

describe('durable quarantine and resolve', () => {
  it('fences quarantine on the lease claim token', async () => {
    const { rpc, calls } = mockStore();
    const { client } = mockApp();
    await adaptersFor(rpc, client).quarantine({
      receiptId: 'receipt-001',
      eventId: 'evt-001',
      claimToken: 'claim-001',
      reason: 'ambiguous',
    });

    expect(calls).toContainEqual({
      fn: 'quarantine_piggyvest_staging_receipt',
      params: {
        p_receipt_id: 'receipt-001',
        p_claim_token: 'claim-001',
        p_event_id: 'evt-001',
        p_reason: 'ambiguous',
        p_detail: null,
      },
    });
  });

  it('rejects unlisted quarantine reasons instead of remapping', async () => {
    const { rpc } = mockStore();
    const { client } = mockApp();
    await expect(
      adaptersFor(rpc, client).quarantine({
        receiptId: 'receipt-001',
        eventId: 'evt-001',
        claimToken: 'claim-001',
        reason: 'made-up',
      })
    ).rejects.toThrow('Unsupported quarantine reason');
  });

  it('maps retryable resolve to a fenced reclaimable state', async () => {
    const { rpc, calls } = mockStore();
    const { client } = mockApp();
    await adaptersFor(rpc, client).resolve({
      receiptId: 'receipt-001',
      claimToken: 'claim-001',
      status: 'retryable',
      reason: 'dispatch-failed',
    });

    expect(calls).toContainEqual({
      fn: 'resolve_piggyvest_staging_receipt',
      params: {
        p_receipt_id: 'receipt-001',
        p_claim_token: 'claim-001',
        p_status: 'quarantined',
        p_last_error: 'worker retryable',
      },
    });
  });
});

describe('createSupabaseRpc', () => {
  it('surfaces RPC failures for the retryable path', async () => {
    const client = {
      rpc: vi.fn(async () => ({
        data: null,
        error: { message: 'down', code: '23503' },
      })),
    } as unknown as SupabaseClient;
    await expect(
      createSupabaseRpc(client).call('claim_piggyvest_staging_receipts', {})
    ).rejects.toMatchObject({ code: '23503' });
  });
});
