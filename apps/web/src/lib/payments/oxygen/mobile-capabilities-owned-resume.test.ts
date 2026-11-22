import { NextRequest } from 'next/server';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  rpc: vi.fn(),
  snapshot: vi.fn(),
  connect: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn().mockResolvedValue({ valid: true }),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkOxygenProviderRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));
vi.mock('@/lib/payments/oxygen/runtime-connection', () => ({
  connectOxygenRuntime: mocks.connect,
}));
vi.mock('@/lib/payments/oxygen/runtime-service', () => ({
  readOxygenSnapshot: mocks.snapshot,
  performOxygenAction: vi.fn(),
}));

import { GET as savedStatus } from '@/app/api/payments/oxygen/workflows/actions/route';
import { POST as resume } from '@/app/api/payments/oxygen/workflows/route';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it('keeps owned pending status and order resume available with new mobile initiation disabled', async () => {
  vi.stubEnv('OXYGEN_STAGING_MOBILE_ENABLED', 'false');
  const id = 'efaf0000-0000-4000-8000-000000000031';
  mocks.auth.mockResolvedValue({
    user: { id: 'owner' },
    supabase: { rpc: mocks.rpc },
  });
  mocks.connect.mockReturnValue(null);
  const pending = {
    action: 'refresh_eligibility',
    status: 'indeterminate',
    idempotencyKey: id,
  };
  mocks.snapshot.mockResolvedValue({
    workflowId: id,
    environment: 'staging',
    pending,
    executionEnabled: false,
  });
  const status = await savedStatus(
    new NextRequest(
      `https://usebaci.com/api/payments/oxygen/workflows/actions?workflowId=${id}`
    )
  );
  expect(status.status).toBe(200);
  expect(await status.json()).toMatchObject({
    pending,
    executionEnabled: false,
  });
  expect(mocks.snapshot).toHaveBeenCalledWith({ rpc: mocks.rpc }, id);
  mocks.rpc.mockResolvedValue({
    error: null,
    data: {
      id,
      order_id: id,
      version: 2,
      stage: 'eligibility_required',
      environment: 'staging',
      created_at: '2026-11-04',
      updated_at: '2026-11-04',
    },
  });
  const response = await resume(
    new NextRequest('https://usebaci.com/api/payments/oxygen/workflows', {
      method: 'POST',
      body: JSON.stringify({ orderId: id, channel: 'mobile' }),
    })
  );
  expect(response.status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('oxygen_start_workflow', {
    p_order_id: id,
    p_channel: 'mobile',
  });
  expect(await response.json()).toMatchObject({ executionEnabled: false });
});
