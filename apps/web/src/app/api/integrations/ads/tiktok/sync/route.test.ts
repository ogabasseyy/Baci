import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

const authenticate = vi.fn();
const access = vi.fn();
const permission = vi.fn();
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
const csrf = vi.fn();
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
const sync = vi.fn();
vi.mock('@/lib/ads/tiktok/sync', () => ({
  syncTikTokAdsSpendForMerchant: (...args: unknown[]) => sync(...args),
  TikTokAdsSyncError: class TikTokAdsSyncError extends Error {},
}));
vi.mock('@/lib/ads/tiktok/config', () => ({
  TikTokAdsConfigError: class TikTokAdsConfigError extends Error {},
}));
vi.mock('@/lib/ads/tiktok/provider', () => ({
  TikTokAdsProviderError: class TikTokAdsProviderError extends Error {},
}));

import { POST } from './route';

describe('TikTok Ads sync route', () => {
  it('denies a sync before any provider call', async () => {
    authenticate.mockResolvedValue({
      error: 'Unauthorized',
      supabase: null,
      user: null,
    });
    expect(
      (
        await POST(
          new NextRequest(
            'https://usebaci.com/api/integrations/ads/tiktok/sync',
            { body: '{}', method: 'POST' }
          )
        )
      ).status
    ).toBe(401);
    expect(createAdsSpendServiceClient).not.toHaveBeenCalled();
    expect(createAdsCredentialServiceClient).not.toHaveBeenCalled();
  });

  it('rejects a malformed authenticated sync body after CSRF validation', async () => {
    access.mockClear();
    authenticate.mockResolvedValue({
      error: null,
      supabase: {},
      user: { id: 'user' },
    });
    access.mockResolvedValue({ merchantId: 'merchant' });
    permission.mockReturnValue(true);
    csrf.mockResolvedValue({ valid: true });
    expect(
      (
        await POST(
          new NextRequest(
            'https://usebaci.com/api/integrations/ads/tiktok/sync',
            {
              body: JSON.stringify({ startDate: 'bad' }),
              method: 'POST',
            }
          )
        )
      ).status
    ).toBe(400);
    expect(access).not.toHaveBeenCalled();
    expect(createAdsSpendServiceClient).not.toHaveBeenCalled();
    expect(createAdsCredentialServiceClient).not.toHaveBeenCalled();
  });

  it('runs an authenticated valid CSRF/Zod sync and returns the normalized success', async () => {
    authenticate.mockResolvedValue({
      error: null,
      supabase: {},
      user: { id: 'user' },
    });
    access.mockResolvedValue({ merchantId: 'merchant' });
    permission.mockReturnValue(true);
    csrf.mockResolvedValue({ valid: true });
    sync.mockResolvedValue({ accountId: 'opaque-001', rowsWritten: 2 });
    const response = await POST(
      new NextRequest('https://usebaci.com/api/integrations/ads/tiktok/sync', {
        body: JSON.stringify({
          startDate: '2026-08-01',
          endDate: '2026-08-30',
          syncWindowEndDate: '2026-08-31',
          syncWindowStartDate: '2026-08-01',
        }),
        method: 'POST',
      })
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      accountId: 'opaque-001',
      rowsWritten: 2,
      syncRunId: expect.any(String),
      syncRunStartedAt: expect.any(String),
      synced: true,
    });
    expect(sync).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialSupabase: mockCredentialSupabase,
        spendSupabase: mockSpendSupabase,
        syncRunStartedAt: expect.any(String),
        syncWindowEndDate: '2026-08-31',
        syncWindowStartDate: '2026-08-01',
      })
    );
    expect(invalidateAdsAnalyticsCache).toHaveBeenCalledExactlyOnceWith(
      'merchant'
    );
  });

  it('does not invalidate after a successful non-final chunk', async () => {
    vi.clearAllMocks();
    authenticate.mockResolvedValue({
      error: null,
      supabase: {},
      user: { id: 'user' },
    });
    access.mockResolvedValue({ merchantId: 'merchant' });
    permission.mockReturnValue(true);
    csrf.mockResolvedValue({ valid: true });
    sync.mockResolvedValue({ accountId: 'opaque-001', rowsWritten: 2 });
    const response = await POST(
      new NextRequest('https://usebaci.com/api/integrations/ads/tiktok/sync', {
        body: JSON.stringify({
          endDate: '2026-08-30',
          finalChunk: false,
          startDate: '2026-08-01',
        }),
        method: 'POST',
      })
    );

    expect(response.status).toBe(200);
    expect(invalidateAdsAnalyticsCache).not.toHaveBeenCalled();
  });

  it('does not invalidate after a failed final chunk', async () => {
    vi.clearAllMocks();
    authenticate.mockResolvedValue({
      error: null,
      supabase: {},
      user: { id: 'user' },
    });
    access.mockResolvedValue({ merchantId: 'merchant' });
    permission.mockReturnValue(true);
    csrf.mockResolvedValue({ valid: true });
    sync.mockRejectedValueOnce(new Error('write failed'));

    const response = await POST(
      new NextRequest('https://usebaci.com/api/integrations/ads/tiktok/sync', {
        body: JSON.stringify({
          endDate: '2026-08-30',
          finalChunk: true,
          startDate: '2026-08-01',
        }),
        method: 'POST',
      })
    );

    expect(response.status).toBe(502);
    expect(invalidateAdsAnalyticsCache).not.toHaveBeenCalled();
  });
});
