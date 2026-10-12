import { Pool } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrefundedCardTreasurySnapshotStore } from './prefunded-card-treasury-snapshot-store';

vi.mock('server-only', () => ({}));
vi.mock('pg', () => ({ Pool: vi.fn() }));

const configuration = {
  scope: {
    integrationId: 'd91d9e87-8e0d-44de-9b84-1e1d709633d2',
    merchantId: '10000000-0000-4000-8000-000000000001',
  },
  verifier: {
    environment: 'staging',
    systemIdentifier: '7685292944002592802',
    expiresAt: '2026-09-29T15:59:10Z',
    treasuryBindingId: 'ffffcb16-2e95-5cff-a591-e9cc81cf5f57',
    expectedBusinessId: '01M2381RG34HQJMHQKE7DWDACR',
    sourceWalletId: '01M238A0V75387H4HZ15YFWGX3',
    piggyvest: {
      apiSecret: 'synthetic-provider-secret',
      expectedBusinessId: '01M2381RG34HQJMHQKE7DWDACR',
      expectedCurrency: 'NGN',
      timeoutMs: 500,
      maxResponseBytes: 1024,
    },
  },
  database: {
    environment: 'staging',
    transport: 'tls',
    host: 'piggyvest-db.staging.baci.internal',
    expectedHost: 'piggyvest-db.staging.baci.internal',
    port: 5432,
    login: 'prefunded_snapshot_verifier',
    expectedLogin: 'prefunded_snapshot_verifier',
    database: 'postgres',
    expectedDatabase: 'postgres',
    expectedSystemId: '7685292944002592802',
    certificateAuthority: 'synthetic-ca-pem',
    password: 'A'.repeat(64),
  },
};

const scope = {
  environment: 'staging' as const,
  systemIdentifier: '7685292944002592802',
  treasuryBindingId: 'ffffcb16-2e95-5cff-a591-e9cc81cf5f57',
  expectedBusinessId: '01M2381RG34HQJMHQKE7DWDACR',
  sourceWalletId: '01M238A0V75387H4HZ15YFWGX3',
};

const snapshot = {
  treasuryBindingId: scope.treasuryBindingId,
  evidenceId: `pvts_${'a'.repeat(64)}`,
  observedAt: '2026-09-27T12:00:00.000Z',
  availableKobo: 5000,
};

function mockPool() {
  const client = {
    end: vi.fn(async () => undefined),
    on: vi.fn(),
    query: vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ result: 'verified' }] })
      .mockResolvedValueOnce({ rows: [{ result: 'verified' }] })
      .mockResolvedValueOnce({
        rows: [{ result: new Date(snapshot.observedAt) }],
      })
      .mockResolvedValueOnce({ rows: [{ result: 'verified' }] })
      .mockResolvedValueOnce({ rows: [{ result: 'recorded' }] }),
  };
  vi.mocked(Pool).mockImplementation(function StubPool() {
    return client as never;
  } as never);
  return client;
}

describe('createPrefundedCardTreasurySnapshotStore', () => {
  beforeEach(() => vi.clearAllMocks());

  it('revalidates binding on every operation and returns only the SQL-assigned outcome over strict TLS', async () => {
    const pool = mockPool();
    const adapter = createPrefundedCardTreasurySnapshotStore(configuration);

    await expect(adapter.store.verifyTreasuryBinding(scope)).resolves.toBe(
      'verified'
    );
    await expect(
      adapter.store.readDatabaseTime(scope.treasuryBindingId)
    ).resolves.toEqual(new Date(snapshot.observedAt));
    await expect(
      adapter.store.recordImmutableSnapshotWithDatabaseAssignedSequence(
        snapshot
      )
    ).resolves.toBe('recorded');

    expect(Pool).toHaveBeenCalledWith(
      expect.objectContaining({
        host: configuration.database.host,
        database: configuration.database.database,
        user: 'prefunded_snapshot_verifier',
        ssl: {
          ca: configuration.database.certificateAuthority,
          rejectUnauthorized: true,
          servername: configuration.database.host,
        },
        max: 1,
        connectionTimeoutMillis: 1_500,
        query_timeout: 2_500,
      })
    );
    expect(pool.query).toHaveBeenCalledTimes(5);
    expect(pool.query.mock.calls[0][0]).toContain(
      'prefunded_card.verify_snapshot_binding'
    );
    expect(pool.query.mock.calls[0][1]).toEqual([
      scope.treasuryBindingId,
      scope.systemIdentifier,
      scope.expectedBusinessId,
      scope.sourceWalletId,
    ]);
    expect(pool.query.mock.calls[1][0]).toContain(
      'prefunded_card.verify_snapshot_binding'
    );
    expect(pool.query.mock.calls[1][1]).toEqual([
      scope.treasuryBindingId,
      scope.systemIdentifier,
      scope.expectedBusinessId,
      scope.sourceWalletId,
    ]);
    expect(pool.query.mock.calls[2][0]).toContain(
      'prefunded_card.snapshot_database_time'
    );
    expect(pool.query.mock.calls[2][1]).toEqual([scope.treasuryBindingId]);
    expect(pool.query.mock.calls[3][0]).toContain(
      'prefunded_card.verify_snapshot_binding'
    );
    expect(pool.query.mock.calls[4][0]).toContain(
      'prefunded_card.record_scoped_treasury_snapshot'
    );
    expect(pool.query.mock.calls[4][1]).toEqual([
      snapshot.treasuryBindingId,
      snapshot.evidenceId,
      snapshot.observedAt,
      String(snapshot.availableKobo),
    ]);
    expect(pool.query.mock.calls[4][1]).toHaveLength(4);
    await adapter.close();
    expect(pool.end).toHaveBeenCalledOnce();
  });

  it('refuses a mismatched treasury scope before querying PostgreSQL', async () => {
    const pool = mockPool();
    const adapter = createPrefundedCardTreasurySnapshotStore(configuration);

    await expect(
      adapter.store.verifyTreasuryBinding({
        ...scope,
        sourceWalletId: 'other-wallet',
      })
    ).rejects.toThrow('Prefunded card treasury snapshot store unavailable');
    expect(pool.query).not.toHaveBeenCalled();
  });

  it.each([
    ['worker login', { login: 'prefunded_treasury_operator' }],
    ['wrong physical identity', { expectedSystemId: '1' }],
    ['non-TLS transport', { transport: 'local_test' }],
  ])('refuses %s configuration before opening a pool', (_case, override) => {
    expect(() =>
      createPrefundedCardTreasurySnapshotStore({
        ...configuration,
        database: { ...configuration.database, ...override },
      })
    ).toThrow('Prefunded card treasury snapshot store unavailable');
    expect(Pool).not.toHaveBeenCalled();
  });

  it('redacts database errors and still closes the pool', async () => {
    const pool = mockPool();
    pool.query.mockReset();
    pool.query.mockRejectedValueOnce(
      new Error('password=synthetic-database-password provider-payload')
    );
    const adapter = createPrefundedCardTreasurySnapshotStore(configuration);

    await expect(adapter.store.verifyTreasuryBinding(scope)).rejects.toThrow(
      'Prefunded card treasury snapshot store unavailable'
    );
    await adapter.close();
    expect(pool.end).toHaveBeenCalledOnce();
  });

  it('rejects an unexpected SQL outcome instead of inventing a sequence result', async () => {
    const pool = mockPool();
    pool.query
      .mockReset()
      .mockResolvedValueOnce({ rows: [{ result: 'allocated' }] });
    const adapter = createPrefundedCardTreasurySnapshotStore(configuration);

    await expect(
      adapter.store.recordImmutableSnapshotWithDatabaseAssignedSequence(
        snapshot
      )
    ).rejects.toThrow('Prefunded card treasury snapshot store unavailable');
  });

  it('refuses a snapshot above the owner-approved 10,000-kobo ceiling', async () => {
    const pool = mockPool();
    const adapter = createPrefundedCardTreasurySnapshotStore(configuration);

    await expect(
      adapter.store.recordImmutableSnapshotWithDatabaseAssignedSequence({
        ...snapshot,
        availableKobo: 10001,
      })
    ).rejects.toThrow('Prefunded card treasury snapshot store unavailable');
    expect(pool.query).not.toHaveBeenCalled();
  });
});
