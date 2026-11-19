import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  createAdminClient: vi.fn(() => ({})),
  getCronSecret: vi.fn(() => 'cron-secret'),
  getEncryptionKey: vi.fn(() => 'encryption-key'),
  getPetrockConfig: vi.fn(() => ({
    baseUrl: 'https://petrock.test',
    token: 'token',
  })),
  markUnknown: vi.fn(),
  notifyRemediation: vi.fn(),
  reconcileRemediation: vi.fn(),
  resolve: vi.fn(),
}));

vi.mock('@/env', () => ({
  getCronSecret: mocks.getCronSecret,
  getImeiIdentifierEncryptionKey: mocks.getEncryptionKey,
  getPetrockConfig: mocks.getPetrockConfig,
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock('@/lib/imei-providers/petrock/petrock-lookup-state', () => ({
  claimPetrockImeiLookups: mocks.claim,
  markPetrockSubmissionUnknown: mocks.markUnknown,
}));
vi.mock('@/lib/imei-providers/petrock/petrock-lookup-resolution', () => ({
  resolveClaimedPetrockLookup: mocks.resolve,
}));
vi.mock('@/lib/imei-providers/petrock/petrock-client', () => ({
  createPetrockClient: () => ({}),
}));
vi.mock('@/lib/imei-providers/petrock/petrock-provider', () => ({
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

import { GET } from './route';

function request(secret = 'cron-secret') {
  return new Request('https://usebaci.com/api/cron/petrock-reconcile', {
    headers: { authorization: `Bearer ${secret}` },
  });
}

describe('GET /api/cron/petrock-reconcile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCronSecret.mockReturnValue('cron-secret');
    mocks.getEncryptionKey.mockReturnValue('encryption-key');
    mocks.getPetrockConfig.mockReturnValue({
      baseUrl: 'https://petrock.test',
      token: 'token',
    });
    mocks.markUnknown.mockResolvedValue(true);
    mocks.resolve.mockResolvedValue({ kind: 'pending', pollAfterMs: 5000 });
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

  it('rejects an invalid cron secret', async () => {
    expect((await GET(request('wrong'))).status).toBe(401);
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('promotes stale provider_submitting without retrying or refunding', async () => {
    mocks.claim.mockResolvedValue([
      {
        id: 'lookup-1',
        lease_token: 'lease-1',
        status: 'provider_submitting',
      },
    ]);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(mocks.markUnknown).toHaveBeenCalledWith(
      expect.objectContaining({
        leaseToken: 'lease-1',
        lookupId: 'lookup-1',
      })
    );
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it('does not count a stale submission transition after losing its lease', async () => {
    mocks.claim.mockResolvedValue([
      {
        id: 'lookup-1',
        lease_token: 'lease-1',
        status: 'provider_submitting',
      },
    ]);
    mocks.markUnknown.mockResolvedValue(false);

    const response = await GET(request());

    await expect(response.json()).resolves.toMatchObject({
      claimed: 1,
      submissionUnknown: 0,
    });
  });

  it('counts a lost resolution lease as pending work', async () => {
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
    mocks.resolve.mockResolvedValue({ kind: 'lease_lost', pollAfterMs: 5000 });

    const response = await GET(request());

    await expect(response.json()).resolves.toMatchObject({
      failed: 0,
      pending: 1,
    });
  });

  it('returns 503 for diagnostic submissions requiring manual review without exposing identifiers', async () => {
    mocks.claim.mockResolvedValue([
      {
        id: 'lookup-secret',
        lease_token: 'lease-secret',
        status: 'submission_unknown',
        reconcile_attempts: 12,
        merchant_id: 'merchant-secret',
        tier: 'simLock',
        provider_order_id: null,
      },
    ]);
    mocks.resolve.mockResolvedValue({
      kind: 'pending',
      pollAfterMs: 60000,
      needsReview: true,
    });
    const response = await GET(request());
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ manualReview: 1, pending: 1, failed: 0 });
    expect(JSON.stringify(body)).not.toContain('lookup-secret');
  });

  it('resolves leased pending provider orders', async () => {
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

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(mocks.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 2 })
    );
    await expect(response.json()).resolves.toMatchObject({
      claimed: 1,
      notifications: { processed: 0 },
      pending: 1,
    });
    expect(mocks.notifyRemediation).toHaveBeenCalled();
  });
});
