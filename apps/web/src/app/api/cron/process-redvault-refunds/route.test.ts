import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(() => ({ rpc: vi.fn() })),
  runRedvaultRefundRecovery: vi.fn(async () => ({
    reconciliation: 'idle',
    submission: 'idle',
  })),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: mocks.createServiceClient,
}));

vi.mock('@/lib/payments/redvault-refund-recovery-runner', () => ({
  REDVAULT_PRODUCTION_REFUND_APPLY_GUARD: 'apply-redvault-production-refunds',
  runRedvaultRefundRecovery: mocks.runRedvaultRefundRecovery,
}));

import { GET, POST } from './route';

function makeRequest(auth = 'Bearer cron-secret') {
  return new NextRequest(
    'http://localhost:3000/api/cron/process-redvault-refunds',
    { headers: auth ? { authorization: auth } : {}, method: 'POST' }
  );
}

describe('POST /api/cron/process-redvault-refunds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    vi.stubEnv('PAYSTACK_SECRET_KEY', 'paystack-secret');
    mocks.runRedvaultRefundRecovery.mockResolvedValue({
      reconciliation: 'idle',
      submission: 'idle',
    });
  });

  it('returns 401 when the cron secret is missing or wrong', async () => {
    expect((await POST(makeRequest(''))).status).toBe(401);
    expect((await POST(makeRequest('Bearer wrong'))).status).toBe(401);
    expect(mocks.runRedvaultRefundRecovery).not.toHaveBeenCalled();
  });

  it('stays unavailable until the restricted-role transport is approved', async () => {
    const res = await POST(makeRequest());

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: 'Refund recovery is not available',
    });
    expect(mocks.runRedvaultRefundRecovery).not.toHaveBeenCalled();
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
  });

  it('refuses GET outside development', async () => {
    const res = await GET(
      new NextRequest('http://localhost:3000/api/cron/process-redvault-refunds')
    );

    expect(res.status).toBe(405);
  });
});
