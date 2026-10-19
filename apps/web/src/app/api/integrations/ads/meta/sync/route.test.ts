import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authenticate = vi.fn();
const csrf = vi.fn();
const access = vi.fn();
const permission = vi.fn();
const sync = vi.fn();
const invalidateAdsAnalyticsCache = vi.fn();
const {
  createAdsCredentialServiceClient,
  createAdsSpendServiceClient,
  mockCredentialSupabase,
  mockSpendSupabase,
} = vi.hoisted(() => ({
  createAdsCredentialServiceClient: vi.fn(),
  createAdsSpendServiceClient: vi.fn(),
  mockCredentialSupabase: { rpc: vi.fn() },
  mockSpendSupabase: { rpc: vi.fn() },
}));
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) => authenticate(...args),
  getUserAccess: (...args: unknown[]) => access(...args),
  hasPermission: (...args: unknown[]) => permission(...args),
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => csrf(...args),
}));
vi.mock('@/lib/ads/analytics-cache', () => ({
  invalidateAdsAnalyticsCache: (...args: unknown[]) =>
    invalidateAdsAnalyticsCache(...args),
}));
vi.mock('@/lib/ads/server-spend-client', () => ({
  createAdsSpendServiceClient: () => {
    createAdsSpendServiceClient();
    return mockSpendSupabase;
  },
}));
vi.mock('@/lib/ads/server-credential-client', () => ({
  createAdsCredentialServiceClient: () => {
    createAdsCredentialServiceClient();
    return mockCredentialSupabase;
  },
}));
vi.mock('@/lib/ads/meta/sync', () => ({
  MetaAdsSyncError: class MetaAdsSyncError extends Error {},
  syncMetaAdsSpendForMerchant: (...args: unknown[]) => sync(...args),
}));

import { POST } from './route';

describe('Meta Ads sync route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes the privileged client only after every request gate succeeds', async () => {
    authenticate.mockResolvedValue({
      error: null,
      supabase: {},
      user: { id: 'user' },
    });
    csrf.mockResolvedValue({ valid: true });
    access.mockResolvedValue({ merchantId: 'merchant' });
    permission.mockReturnValue(true);
    sync.mockResolvedValue({ accountId: 'act_12', rowsWritten: 1 });

    const response = await POST(
      new NextRequest('https://usebaci.com/api/integrations/ads/meta/sync', {
        body: JSON.stringify({
          endDate: '2026-08-20',
          startDate: '2026-08-20',
          syncWindowEndDate: '2026-08-31',
          syncWindowStartDate: '2026-08-01',
        }),
        method: 'POST',
      })
    );

    expect(response.status).toBe(200);
    expect(sync).toHaveBeenCalledWith({
      credentialSupabase: mockCredentialSupabase,
      endDate: '2026-08-20',
      finalChunk: true,
      merchantId: 'merchant',
      spendSupabase: mockSpendSupabase,
      startDate: '2026-08-20',
      supabase: {},
      syncRunId: expect.any(String),
      syncRunStartedAt: expect.any(String),
      syncWindowEndDate: '2026-08-31',
      syncWindowStartDate: '2026-08-01',
    });
    expect(invalidateAdsAnalyticsCache).toHaveBeenCalledExactlyOnceWith(
      'merchant'
    );
  });

  it('invalidates only after a successful final chunk', async () => {
    authenticate.mockResolvedValue({
      error: null,
      supabase: {},
      user: { id: 'user' },
    });
    csrf.mockResolvedValue({ valid: true });
    access.mockResolvedValue({ merchantId: 'merchant' });
    permission.mockReturnValue(true);
    sync.mockResolvedValue({ accountId: 'act_12', rowsWritten: 1 });
    const request = (finalChunk: boolean) =>
      new NextRequest('https://usebaci.com/api/integrations/ads/meta/sync', {
        body: JSON.stringify({
          endDate: '2026-08-20',
          finalChunk,
          startDate: '2026-08-20',
        }),
        method: 'POST',
      });

    expect((await POST(request(false))).status).toBe(200);
    expect(invalidateAdsAnalyticsCache).not.toHaveBeenCalled();

    sync.mockRejectedValueOnce(new Error('write failed'));
    expect((await POST(request(true))).status).toBe(502);
    expect(invalidateAdsAnalyticsCache).not.toHaveBeenCalled();
  });

  it('requires auth before parsing a browser sync request', async () => {
    authenticate.mockResolvedValue({
      error: 'Unauthorized',
      supabase: null,
      user: null,
    });
    expect(
      (
        await POST(
          new NextRequest(
            'https://usebaci.com/api/integrations/ads/meta/sync',
            { method: 'POST' }
          )
        )
      ).status
    ).toBe(401);
    expect(createAdsSpendServiceClient).not.toHaveBeenCalled();
    expect(createAdsCredentialServiceClient).not.toHaveBeenCalled();
  });

  it('validates an authenticated body before resolving merchant access', async () => {
    authenticate.mockResolvedValue({
      error: null,
      supabase: {},
      user: { id: 'user' },
    });
    csrf.mockResolvedValue({ valid: true });
    access.mockClear();

    const response = await POST(
      new NextRequest('https://usebaci.com/api/integrations/ads/meta/sync', {
        body: '{',
        method: 'POST',
      })
    );

    expect(response.status).toBe(400);
    expect(access).not.toHaveBeenCalled();
    expect(createAdsSpendServiceClient).not.toHaveBeenCalled();
    expect(createAdsCredentialServiceClient).not.toHaveBeenCalled();
  });
});
