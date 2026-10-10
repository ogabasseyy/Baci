import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetPlatformAdminAuthForPermission = vi.fn();
const mockCreateClient = vi.fn();
const mockCheckCsrfProtection = vi.fn();
const mockCheckRateLimit = vi.fn();

vi.mock('@/lib/platform-admin-auth', () => ({
  getPlatformAdminAuthForPermission: (...args: unknown[]) =>
    mockGetPlatformAdminAuthForPermission(...args),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mockCheckCsrfProtection(...args),
}));

vi.mock('@/lib/rate-limiter', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const mockSelect = vi.fn();
const mockEq = vi.fn(() => ({ select: mockSelect }));
const mockIn = vi.fn(() => ({ eq: mockEq }));
const mockUpdate = vi.fn(() => ({ in: mockIn }));

const mockSupabase = {
  from: vi.fn(() => ({ update: mockUpdate })),
};

import { handleBlogMediaTombstoneRefresh } from './blog-media-tombstone-refresh-route';

function patchRequest(body: unknown): NextRequest {
  return {
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

describe('handleBlogMediaTombstoneRefresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue(mockSupabase);
    mockGetPlatformAdminAuthForPermission.mockResolvedValue({
      status: 'authenticated',
      user: { email: 'admin@baci.com', id: 'user-1' },
    });
    mockCheckCsrfProtection.mockResolvedValue({ valid: true, response: null });
    mockCheckRateLimit.mockResolvedValue(true);
    mockSelect.mockResolvedValue({
      data: [{ path: 'platform/blog/draft.webp' }],
      error: null,
    });
  });

  it('refreshes staged paths for an active draft', async () => {
    const response = await handleBlogMediaTombstoneRefresh(
      patchRequest({ path: 'platform/blog/draft.webp', variantPaths: [] })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      refreshed: ['platform/blog/draft.webp'],
      success: true,
    });
    expect(mockSupabase.from).toHaveBeenCalledWith(
      'blog_media_delete_tombstones'
    );
    expect(mockIn).toHaveBeenCalledWith('path', ['platform/blog/draft.webp']);
    expect(mockEq).toHaveBeenCalledWith('claimed', false);
  });

  it('rejects non-platform paths', async () => {
    const response = await handleBlogMediaTombstoneRefresh(
      patchRequest({ path: 'merchant/evil.webp', variantPaths: [] })
    );

    expect(response.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('validates the body before consuming the rate limit', async () => {
    // Ineligible bodies must not burn the 30-request heartbeat
    // budget: repeated invalid PATCHes would otherwise 429 later
    // valid beats and let active draft leases expire.
    const malformed = {
      json: vi.fn().mockRejectedValue(new Error('bad json')),
    } as unknown as NextRequest;
    const malformedResponse = await handleBlogMediaTombstoneRefresh(malformed);
    expect(malformedResponse.status).toBe(400);

    const scopeResponse = await handleBlogMediaTombstoneRefresh(
      patchRequest({ path: 'merchant/evil.webp', variantPaths: [] })
    );
    expect(scopeResponse.status).toBe(403);

    expect(mockCheckRateLimit).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('reports refresh failures', async () => {
    mockSelect.mockResolvedValueOnce({ data: [], error: { message: 'down' } });

    const response = await handleBlogMediaTombstoneRefresh(
      patchRequest({ path: 'platform/blog/draft.webp', variantPaths: [] })
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to refresh media lease',
    });
  });

  it('requires authentication', async () => {
    mockGetPlatformAdminAuthForPermission.mockResolvedValueOnce({
      status: 'unauthenticated',
    });

    const response = await handleBlogMediaTombstoneRefresh(
      patchRequest({ path: 'platform/blog/draft.webp', variantPaths: [] })
    );

    expect(response.status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
