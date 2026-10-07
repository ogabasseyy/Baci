import { describe, expect, it, vi } from 'vitest';
import {
  assertLegacyHistoryFinalizationTime,
  assertLegacyProofPublicationTime,
  readPrefundedLegacyHistory,
} from './legacy-history-read';

describe('live history reader boundaries', () => {
  it('reconciles one exact historical contribution while issuing only read-only queries and GET requests', async () => {
    const history = {
      integrationId: 'd91d9e87-8e0d-44de-9b84-1e1d709633d2',
      merchantId: '10000000-0000-4000-8000-000000000001',
      customerId: '10000000-0000-4000-8000-000000000002',
      goalId: '430314fd-cd8b-4579-98d4-e9f345713dd6',
      contributionId: '10000000-0000-4000-8000-000000000003',
      providerWalletId: '01M3CQX27G9687EFSF1TKYMPR9',
      providerCustomerId: 'c096507d-dc32-45d2-9c01-871a27abfd10',
      eventId: 'synthetic-event',
      eventDataId: 'synthetic-data',
      providerTransactionId: 'synthetic-uuid',
      amountKobo: 10000,
      feeKobo: 0,
      reference: 'synthetic-reference',
      sessionId: null,
      creditedAt: '2026-09-25T12:00:00Z',
    };
    const raw = Buffer.from(
      JSON.stringify({
        eventId: history.eventId,
        eventType: 'bank-transfer.inflow.success',
        eventCategory: 'inflow_transaction',
        customer_id: history.providerCustomerId,
        pvb_reference: 'PVB-synthetic',
        pvb_wallet: history.providerWalletId,
        eventData: {
          id: history.eventDataId,
          transaction_id: history.providerTransactionId,
          customer_id: history.providerCustomerId,
          destination_wallet_id: history.providerWalletId,
          type: 'inter',
          status: 'COMPLETED',
          category: 'bank_transfer_inflow',
          amount: 10000,
          fee: 0,
          currency: 'NGN',
          reference: history.reference,
          timestamp: history.creditedAt,
        },
      })
    );
    const key = Buffer.alloc(32, 3);
    const nonce = Buffer.alloc(12, 4);
    const digest = createHash('sha256').update(raw).digest('hex');
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from(`piggyvest-staging:staging-v1:${digest}`));
    const ciphertext = Buffer.concat([cipher.update(raw), cipher.final()]);
    const sealed = {
      payloadSha256: digest,
      ciphertext: ciphertext.toString('base64'),
      nonce: nonce.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      keyVersion: 'staging-v1',
    };
    const query = vi.fn((container: string, _login: string, _sql: string) =>
      Promise.resolve(
        container === 'baci-isolated-savings-db-1'
          ? {
              goalAmountKobo: 10000,
              goalStatus: 'active',
              completedContributions: 1,
              history: [history],
            }
          : {
              count: 1,
              receipts: [{ receiptId: history.contributionId, sealed }],
            }
      )
    );
    const fetchImplementation = vi.fn(
      async (url: string | URL | Request, _init?: RequestInit) => {
        const wallet = {
          id: history.providerWalletId,
          business_id: '01M2381RG34HQJMHQKE7DWDACR',
          currency: 'NGN',
          balance: 10000,
          status: 'active',
        };
        const data = String(url).includes('/transaction/')
          ? {
              id: 'PVB-synthetic',
              customer_id: history.providerCustomerId,
              source_wallet: '',
              destination_wallet: wallet.id,
              reference: history.reference,
              category: 'bank_transfer_inflow',
              status: 'successful',
              amount: 10000,
              fee: 0,
            }
          : String(url).includes('/wallet-type?')
            ? { paginatedPayload: { edges: [wallet] } }
            : wallet;
        return new Response(JSON.stringify({ status: true, data }));
      }
    );
    const result = await readPrefundedLegacyHistory({
      query,
      readConfig: () => ({
        environment: 'staging',
        providerSecret: 'test_key_synthetic',
        encryptionKey: key.toString('base64'),
      }),
      fetchImplementation,
      now: () => Date.parse('2026-09-27'),
    });
    expect(result.principalKobo).toBe(10000);
    expect(result.changesMade).toBe(false);
    expect(result.proofs[0].legacyProviderTransactionId).toBe('synthetic-uuid');
    expect(result.proofs[0].observation.providerTransactionId).toBe(
      'PVB-synthetic'
    );
    expect(result.proofs[0].provenance).toBe('provider_reconciliation');
    expect(query).toHaveBeenCalledTimes(2);
    for (const [, , statement] of query.mock.calls)
      expect(statement).toContain('READ ONLY;');
    for (const [, init] of fetchImplementation.mock.calls)
      expect(init?.method).toBe('GET');
    expect(JSON.stringify(result)).not.toContain('test_key_synthetic');
  });
  it('pins an explicitly read-only exact-goal query before reading credentials', async () => {
    const query = vi.fn(
      async (_container: string, _login: string, _sql: string) => ({
        goalAmountKobo: 0,
        goalStatus: 'active',
        history: [],
      })
    );
    const readConfig = vi.fn();
    await expect(
      readPrefundedLegacyHistory({
        query,
        readConfig,
        fetchImplementation: vi.fn(),
        now: () => Date.parse('2026-09-27'),
      })
    ).rejects.toThrow('Legacy history verification refused');
    expect(query).toHaveBeenCalledWith(
      'baci-isolated-savings-db-1',
      'postgres',
      expect.stringContaining(
        'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;'
      )
    );
    expect(query.mock.calls[0][2]).toContain("'7685292944002592802'");
    expect(query.mock.calls[0][2]).toContain(
      "'430314fd-cd8b-4579-98d4-e9f345713dd6'"
    );
    expect(query.mock.calls[0][2]).not.toMatch(
      /\b(INSERT|UPDATE|DELETE|GRANT|ALTER|CREATE)\b/
    );
    expect(readConfig).not.toHaveBeenCalled();
  });
  it('refuses multiple contributions that only add up to the expected 10000-kobo inflow', async () => {
    const first = {
      integrationId: 'd91d9e87-8e0d-44de-9b84-1e1d709633d2',
      merchantId: '10000000-0000-4000-8000-000000000001',
      customerId: '10000000-0000-4000-8000-000000000002',
      goalId: '430314fd-cd8b-4579-98d4-e9f345713dd6',
      contributionId: '10000000-0000-4000-8000-000000000003',
      providerWalletId: '01M3CQX27G9687EFSF1TKYMPR9',
      providerCustomerId: 'c096507d-dc32-45d2-9c01-871a27abfd10',
      eventId: 'event-one',
      eventDataId: 'data-one',
      providerTransactionId: 'transaction-one',
      amountKobo: 5000,
      feeKobo: 0,
      reference: 'reference-one',
      sessionId: null,
      creditedAt: '2026-09-25T12:00:00Z',
    };
    const second = {
      ...first,
      contributionId: '10000000-0000-4000-8000-000000000004',
      eventId: 'event-two',
      eventDataId: 'data-two',
      providerTransactionId: 'transaction-two',
      reference: 'reference-two',
    };
    const query = vi.fn().mockResolvedValue({
      goalAmountKobo: 10000,
      goalStatus: 'active',
      completedContributions: 2,
      history: [first, second],
    });

    await expect(
      readPrefundedLegacyHistory({
        query,
        readConfig: vi.fn(),
        fetchImplementation: vi.fn(),
        now: () => Date.parse('2026-09-27T12:00:00Z'),
      })
    ).rejects.toThrow('Legacy history verification refused');
    expect(query).toHaveBeenCalledOnce();
  });

  it('rejects aggregate finalization after expiry, non-finite time, or wall-clock rollback', () => {
    const start = Date.parse('2026-09-27T12:00:00Z');
    expect(() =>
      assertLegacyHistoryFinalizationTime(start, start - 1)
    ).toThrow();
    expect(() =>
      assertLegacyHistoryFinalizationTime(
        start,
        Date.parse('2026-09-29T15:59:10Z')
      )
    ).toThrow();
    expect(() =>
      assertLegacyHistoryFinalizationTime(start, Number.NaN)
    ).toThrow();
    expect(() =>
      assertLegacyHistoryFinalizationTime(start, start + 1)
    ).not.toThrow();
  });

  it('refuses proof publication after expiry or when the wall clock precedes proof verification', () => {
    const verifiedAt = '2026-09-27T12:00:00.000Z';
    expect(() =>
      assertLegacyProofPublicationTime(
        verifiedAt,
        Date.parse('2026-09-27T11:59:59Z')
      )
    ).toThrow();
    expect(() =>
      assertLegacyProofPublicationTime(
        verifiedAt,
        Date.parse('2026-09-29T15:59:10Z')
      )
    ).toThrow();
    expect(() =>
      assertLegacyProofPublicationTime(verifiedAt, Date.parse(verifiedAt))
    ).not.toThrow();
  });
  it('refuses after expiry without any database or provider call', async () => {
    const query = vi.fn();
    await expect(
      readPrefundedLegacyHistory({
        query,
        readConfig: vi.fn(),
        fetchImplementation: vi.fn(),
        now: () => Date.parse('2026-09-29T15:59:10Z'),
      })
    ).rejects.toThrow('Legacy history verification refused');
    expect(query).not.toHaveBeenCalled();
  });
  it('redacts database and parsing errors', async () => {
    const query = vi.fn().mockRejectedValue(new Error('private row values'));
    await expect(
      readPrefundedLegacyHistory({
        query,
        readConfig: vi.fn(),
        fetchImplementation: vi.fn(),
        now: () => Date.parse('2026-09-27'),
      })
    ).rejects.toThrow(
      /^Legacy history verification refused \(legacy-database\)$/
    );
  });
});

import { createCipheriv, createHash } from 'node:crypto';
