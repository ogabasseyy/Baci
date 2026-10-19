import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

vi.mock('@/env', () => ({
  getCronSecret: () => process.env.CRON_SECRET,
}));

const mockRpc = vi.fn().mockResolvedValue({ data: 3, error: null });

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: mockRpc,
  }),
}));

const FIXTURE_CRON = 'cron-fixture-value';
const WRONG_CRON = 'cron-wrong-value';

function createCronRequest(authHeader?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (authHeader) {
    headers.Authorization = authHeader;
  }
  return new NextRequest(
    'http://localhost:3000/api/cron/cleanup-checkout-shipping-recovery-previews',
    { method: 'GET', headers }
  );
}

describe('GET /api/cron/cleanup-checkout-shipping-recovery-previews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = FIXTURE_CRON;
  });

  it('returns 500 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(createCronRequest(`Bearer ${FIXTURE_CRON}`));

    expect(response.status).toBe(500);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns 401 for a wrong secret', async () => {
    const response = await GET(createCronRequest(`Bearer ${WRONG_CRON}`));

    expect(response.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('runs the retention sweep with the service client', async () => {
    const response = await GET(createCronRequest(`Bearer ${FIXTURE_CRON}`));

    expect(response.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      'cleanup_customer_checkout_shipping_recovery_previews',
      { p_limit: 1000 }
    );
    await expect(response.json()).resolves.toEqual({ purged: 3 });
  });
});
