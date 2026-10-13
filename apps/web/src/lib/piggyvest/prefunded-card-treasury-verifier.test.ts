import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { verifyPrefundedCardTreasurySnapshot } from './prefunded-card-treasury-verifier';

const currentTime = new Date('2026-09-27T12:00:00.000Z');
const configuration = {
  environment: 'staging',
  systemIdentifier: '7685292944002592802',
  expiresAt: '2026-09-29T15:59:10Z',
  treasuryBindingId: '10000000-0000-4000-8000-000000000001',
  expectedBusinessId: 'business-owner-configured',
  sourceWalletId: 'wallet-owner-configured',
  piggyvest: {
    apiSecret: 'synthetic-staging-secret',
    expectedBusinessId: 'business-owner-configured',
    expectedCurrency: 'NGN',
    timeoutMs: 500,
    maxResponseBytes: 1_024,
  },
};

function walletResponse(
  overrides: {
    id?: string;
    business_id?: string;
    currency?: string;
    balance?: number;
  } = {}
) {
  return {
    status: true,
    data: {
      id: overrides.id ?? configuration.sourceWalletId,
      business_id: overrides.business_id ?? configuration.expectedBusinessId,
      currency: overrides.currency ?? 'NGN',
      balance: overrides.balance ?? 50_000,
      status: 'active',
    },
  };
}

function makeDependencies(
  options: {
    response?: unknown;
    status?: number;
    databaseTime?: Date;
    now?: () => Date;
  } = {}
) {
  const fetchImplementation = vi.fn(
    async () =>
      new Response(JSON.stringify(options.response ?? walletResponse()), {
        status: options.status ?? 200,
        headers: { 'content-type': 'application/json' },
      })
  );
  const store = {
    verifyTreasuryBinding: vi.fn().mockResolvedValue('verified'),
    readDatabaseTime: vi
      .fn()
      .mockResolvedValue(options.databaseTime ?? currentTime),
    recordImmutableSnapshotWithDatabaseAssignedSequence: vi
      .fn()
      .mockResolvedValue('recorded' as const),
  };
  return {
    fetchImplementation,
    store,
    now: options.now ?? (() => currentTime),
  };
}

describe('verifyPrefundedCardTreasurySnapshot', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('reads only the configured staging source wallet and submits an immutable evidence snapshot', async () => {
    const dependencies = makeDependencies();

    const result = await verifyPrefundedCardTreasurySnapshot({
      configuration,
      ...dependencies,
    });

    expect(result).toMatchObject({ outcome: 'recorded' });
    expect(dependencies.store.verifyTreasuryBinding).toHaveBeenCalledWith({
      environment: 'staging',
      systemIdentifier: '7685292944002592802',
      treasuryBindingId: configuration.treasuryBindingId,
      expectedBusinessId: configuration.expectedBusinessId,
      sourceWalletId: configuration.sourceWalletId,
    });
    expect(dependencies.fetchImplementation).toHaveBeenCalledExactlyOnceWith(
      'https://staging.piggyvest.business/api/v1/wallet/wallet-owner-configured',
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
        redirect: 'error',
      })
    );
    expect(
      dependencies.store.recordImmutableSnapshotWithDatabaseAssignedSequence
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        treasuryBindingId: configuration.treasuryBindingId,
        observedAt: currentTime.toISOString(),
        availableKobo: 50_000,
        evidenceId: expect.stringMatching(/^pvts_[a-f0-9]{64}$/),
      })
    );
  });

  it('refuses a wallet belonging to another business without recording it', async () => {
    const dependencies = makeDependencies({
      response: walletResponse({ business_id: 'other-business' }),
    });

    await expect(
      verifyPrefundedCardTreasurySnapshot({ configuration, ...dependencies })
    ).resolves.toEqual({
      outcome: 'refused',
      reason: 'provider_identity_mismatch',
    });
    expect(
      dependencies.store.recordImmutableSnapshotWithDatabaseAssignedSequence
    ).not.toHaveBeenCalled();
  });

  it('requires the adapter to verify the live database and treasury binding before the provider read', async () => {
    const dependencies = makeDependencies();
    dependencies.store.verifyTreasuryBinding.mockResolvedValue('mismatch');

    await expect(
      verifyPrefundedCardTreasurySnapshot({ configuration, ...dependencies })
    ).resolves.toEqual({
      outcome: 'refused',
      reason: 'treasury_binding_unverified',
    });
    expect(dependencies.fetchImplementation).not.toHaveBeenCalled();
    expect(
      dependencies.store.recordImmutableSnapshotWithDatabaseAssignedSequence
    ).not.toHaveBeenCalled();
  });

  it('refuses customer sub-accounts when the provider returns a different wallet id', async () => {
    const dependencies = makeDependencies({
      response: walletResponse({ id: 'customer-sub-account' }),
    });

    await expect(
      verifyPrefundedCardTreasurySnapshot({ configuration, ...dependencies })
    ).resolves.toMatchObject({
      outcome: 'refused',
      reason: 'provider_identity_mismatch',
    });
    expect(
      dependencies.store.recordImmutableSnapshotWithDatabaseAssignedSequence
    ).not.toHaveBeenCalled();
  });

  it.each([
    Number.MAX_SAFE_INTEGER + 1,
    12.5,
    -1,
  ])('refuses unsafe kobo balance %s', async (balance) => {
    const dependencies = makeDependencies({
      response: walletResponse({ balance }),
    });

    await expect(
      verifyPrefundedCardTreasurySnapshot({ configuration, ...dependencies })
    ).resolves.toEqual({ outcome: 'refused', reason: 'invalid_balance' });
    expect(
      dependencies.store.recordImmutableSnapshotWithDatabaseAssignedSequence
    ).not.toHaveBeenCalled();
  });

  it('fails closed when PiggyVest is unavailable and does not expose provider errors', async () => {
    const dependencies = makeDependencies({
      response: { message: 'provider-secret-detail' },
      status: 503,
    });

    const result = await verifyPrefundedCardTreasurySnapshot({
      configuration,
      ...dependencies,
    });

    expect(result).toEqual({
      outcome: 'refused',
      reason: 'provider_unavailable',
    });
    expect(JSON.stringify(result)).not.toContain('provider-secret-detail');
    expect(
      dependencies.store.recordImmutableSnapshotWithDatabaseAssignedSequence
    ).not.toHaveBeenCalled();
  });

  it('refuses snapshots after the fixed staging deadline before calling the provider', async () => {
    const dependencies = makeDependencies({
      now: () => new Date('2026-09-29T15:59:10.000Z'),
    });

    await expect(
      verifyPrefundedCardTreasurySnapshot({ configuration, ...dependencies })
    ).resolves.toEqual({ outcome: 'refused', reason: 'expired' });
    expect(dependencies.fetchImplementation).not.toHaveBeenCalled();
  });

  it('refuses when verifier and database clocks disagree', async () => {
    const dependencies = makeDependencies({
      databaseTime: new Date(currentTime.getTime() + 31_000),
    });

    await expect(
      verifyPrefundedCardTreasurySnapshot({ configuration, ...dependencies })
    ).resolves.toEqual({ outcome: 'refused', reason: 'stale_clock' });
    expect(
      dependencies.store.recordImmutableSnapshotWithDatabaseAssignedSequence
    ).not.toHaveBeenCalled();
  });

  it('refuses when the local clock moves backwards across the provider read', async () => {
    const times = [currentTime, new Date(currentTime.getTime() - 1)];
    const dependencies = makeDependencies({
      now: () => times.shift() ?? currentTime,
    });

    await expect(
      verifyPrefundedCardTreasurySnapshot({ configuration, ...dependencies })
    ).resolves.toEqual({ outcome: 'refused', reason: 'stale_clock' });
    expect(dependencies.store.readDatabaseTime).not.toHaveBeenCalled();
    expect(
      dependencies.store.recordImmutableSnapshotWithDatabaseAssignedSequence
    ).not.toHaveBeenCalled();
  });

  it('bounds a hung database clock read and refuses to record the wallet result', async () => {
    vi.useFakeTimers();
    try {
      const dependencies = makeDependencies();
      dependencies.store.readDatabaseTime.mockImplementation(
        () => new Promise(() => {})
      );
      const verification = verifyPrefundedCardTreasurySnapshot({
        configuration,
        ...dependencies,
      });

      await vi.advanceTimersByTimeAsync(2_001);
      await expect(verification).resolves.toEqual({
        outcome: 'refused',
        reason: 'snapshot_store_unavailable',
      });
      expect(
        dependencies.store.recordImmutableSnapshotWithDatabaseAssignedSequence
      ).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('checks the fixed deadline again immediately before persistence', async () => {
    const times = [
      currentTime,
      currentTime,
      currentTime,
      currentTime,
      new Date('2026-09-29T15:59:10.000Z'),
    ];
    const dependencies = makeDependencies({
      now: () => times.shift() ?? currentTime,
    });

    await expect(
      verifyPrefundedCardTreasurySnapshot({ configuration, ...dependencies })
    ).resolves.toEqual({ outcome: 'refused', reason: 'expired' });
    expect(
      dependencies.store.recordImmutableSnapshotWithDatabaseAssignedSequence
    ).not.toHaveBeenCalled();
  });

  it('records a higher provider balance only as a snapshot and never invokes float adjustment', async () => {
    const dependencies = makeDependencies({
      response: walletResponse({ balance: 900_000 }),
    });

    const result = await verifyPrefundedCardTreasurySnapshot({
      configuration,
      ...dependencies,
    });

    expect(result).toMatchObject({ outcome: 'recorded' });
    expect(
      dependencies.store.recordImmutableSnapshotWithDatabaseAssignedSequence
    ).toHaveBeenCalledWith(expect.objectContaining({ availableKobo: 900_000 }));
    expect(Object.keys(dependencies.store)).toEqual([
      'verifyTreasuryBinding',
      'readDatabaseTime',
      'recordImmutableSnapshotWithDatabaseAssignedSequence',
    ]);
  });

  it('returns duplicate for idempotent persistence without exposing storage details', async () => {
    const dependencies = makeDependencies();
    dependencies.store.recordImmutableSnapshotWithDatabaseAssignedSequence.mockResolvedValue(
      'duplicate'
    );

    await expect(
      verifyPrefundedCardTreasurySnapshot({ configuration, ...dependencies })
    ).resolves.toMatchObject({ outcome: 'duplicate' });
  });

  it('refuses an unexpected runtime persistence result', async () => {
    const dependencies = makeDependencies();
    dependencies.store.recordImmutableSnapshotWithDatabaseAssignedSequence.mockResolvedValue(
      'unexpected' as never
    );

    await expect(
      verifyPrefundedCardTreasurySnapshot({ configuration, ...dependencies })
    ).resolves.toEqual({
      outcome: 'refused',
      reason: 'snapshot_store_unavailable',
    });
  });
});
