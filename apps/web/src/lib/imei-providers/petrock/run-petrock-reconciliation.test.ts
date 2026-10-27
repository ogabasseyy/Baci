import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  createAdminClient: vi.fn(() => ({})),
  getEncryptionKey: vi.fn(() => 'encryption-key'),
  getPetrockConfig: vi.fn<() => { baseUrl: string; token: string } | null>(
    () => ({
      baseUrl: 'https://petrock.test',
      token: 'token',
    })
  ),
  markUnknown: vi.fn(),
  notifyRemediation: vi.fn(),
  reconcileRemediation: vi.fn(),
  resolve: vi.fn(),
}));

vi.mock('@/env', () => ({
  getImeiIdentifierEncryptionKey: mocks.getEncryptionKey,
  getPetrockConfig: mocks.getPetrockConfig,
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock('./petrock-lookup-state', () => ({
  claimPetrockImeiLookups: mocks.claim,
  markPetrockSubmissionUnknown: mocks.markUnknown,
}));
vi.mock('./petrock-lookup-resolution', () => ({
  resolveClaimedPetrockLookup: mocks.resolve,
}));
vi.mock('./petrock-client', () => ({ createPetrockClient: () => ({}) }));
vi.mock('./petrock-provider', () => ({
  createPetrockProvider: () => ({ poll: vi.fn() }),
}));
vi.mock(
  '@/lib/imei-remediation/run-petrock-remediation-reconciliation',
  () => ({
    runPetrockRemediationReconciliation: mocks.reconcileRemediation,
  })
);
vi.mock('@/lib/imei-remediation/run-petrock-remediation-notifications', () => ({
  runPetrockRemediationNotifications: mocks.notifyRemediation,
}));

import { runPetrockReconciliation } from './run-petrock-reconciliation';

describe('runPetrockReconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEncryptionKey.mockReturnValue('encryption-key');
    mocks.getPetrockConfig.mockReturnValue({
      baseUrl: 'https://petrock.test',
      token: 'token',
    });
    mocks.claim.mockResolvedValue([]);
    mocks.markUnknown.mockResolvedValue(true);
    mocks.resolve.mockResolvedValue({ kind: 'pending', pollAfterMs: 5_000 });
    mocks.reconcileRemediation.mockResolvedValue({
      claimed: 0,
      completed: 0,
      eligibilityAdvanced: 0,
      errored: 0,
      failed: 0,
      pending: 0,
      submissionUnknown: 0,
    });
    mocks.notifyRemediation.mockResolvedValue({
      claimed: 0,
      errored: 0,
      processed: 0,
    });
  });

  it('signals a service failure when paid submissions require manual review', async () => {
    mocks.reconcileRemediation.mockResolvedValue({
      errored: 0,
      manualReview: 1,
    });
    await expect(
      runPetrockReconciliation({ origin: 'https://usebaci.com' })
    ).resolves.toMatchObject({
      status: 503,
      body: { remediation: { manualReview: 1 } },
    });
  });

  it('skips when Petrock is not configured', async () => {
    mocks.getPetrockConfig.mockReturnValue(null);

    await expect(
      runPetrockReconciliation({ origin: 'https://usebaci.com' })
    ).resolves.toEqual({
      body: { skipped: 'petrock_not_configured', success: true },
      status: 200,
    });
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('promotes stale provider submission without resolving it', async () => {
    mocks.claim.mockResolvedValue([
      { id: 'lookup-1', lease_token: 'lease-1', status: 'provider_submitting' },
    ]);

    const result = await runPetrockReconciliation({
      origin: 'https://usebaci.com',
    });

    expect(result.body).toMatchObject({ claimed: 1, submissionUnknown: 1 });
    expect(mocks.markUnknown).toHaveBeenCalledWith(
      expect.objectContaining({ leaseToken: 'lease-1', lookupId: 'lookup-1' })
    );
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it('keeps a lost lookup lease pending', async () => {
    mocks.claim.mockResolvedValue([
      {
        id: 'lookup-1',
        identifier_ciphertext: 'ciphertext',
        lease_token: 'lease-1',
        provider_order_id: 'order-1',
        reconcile_attempts: 2,
        status: 'pending_provider',
        tier: 'blacklist',
      },
    ]);
    mocks.resolve.mockResolvedValue({ kind: 'lease_lost', pollAfterMs: 5_000 });

    await expect(
      runPetrockReconciliation({ origin: 'https://usebaci.com' })
    ).resolves.toMatchObject({ body: { failed: 0, pending: 1 }, status: 200 });
  });

  it('runs remediation reconciliation and notification after lookups', async () => {
    await runPetrockReconciliation({ origin: 'https://usebaci.com' });

    expect(mocks.reconcileRemediation).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'https://usebaci.com' })
    );
    expect(mocks.notifyRemediation).toHaveBeenCalledWith(
      expect.objectContaining({ supabaseAdmin: expect.anything() })
    );
  });

  it('does not expose lookup identifiers or raw errors in worker logs', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mocks.claim.mockResolvedValue([
      {
        id: 'customer-linked-lookup-id',
        identifier_ciphertext: 'ciphertext',
        lease_token: 'lease-1',
        provider_order_id: 'order-1',
        reconcile_attempts: 2,
        status: 'pending_provider',
        tier: 'blacklist',
      },
    ]);
    mocks.resolve.mockRejectedValue(new Error('raw-provider-error'));

    await runPetrockReconciliation({ origin: 'https://usebaci.com' });

    expect(consoleError).toHaveBeenCalledWith(
      '[Petrock Reconcile] Lookup resolution failed'
    );
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ lookupId: 'customer-linked-lookup-id' })
    );
    consoleError.mockRestore();
  });
});

vi.mock('@/lib/imei-device-catalog', () => ({
  enrichImeiDeviceResult: vi.fn(
    async (_merchantId: string, result: unknown) => result
  ),
}));
