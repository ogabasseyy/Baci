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

const mockEq = vi.fn();
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
    mockEq.mockResolvedValue({ error: null });
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

  it('reports refresh failures', async () => {
    mockEq.mockResolvedValueOnce({ error: { message: 'down' } });

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
      status: 'unauthorized',
    });

    const response = await handleBlogMediaTombstoneRefresh(
      patchRequest({ path: 'platform/blog/draft.webp', variantPaths: [] })
    );

    expect(response.status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
