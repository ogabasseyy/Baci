import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetPlatformAdminAuthForPermission = vi.fn();
const mockCreateClient = vi.fn();
const mockCheckCsrfProtection = vi.fn();
const mockCheckRateLimit = vi.fn();
const mockRevalidatePlatformBlog = vi.fn();

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

vi.mock('@/lib/cache-revalidation', () => ({
  revalidatePlatformBlog: (...args: unknown[]) =>
    mockRevalidatePlatformBlog(...args),
}));

const mockStorageBucket = {
  remove: vi.fn(),
  upload: vi.fn(),
};

const mockTombstoneUpsert = vi.fn();

type PostsQueryResult = {
  data:
    | {
        content?: string | null;
        excerpt?: string | null;
        featured_image_url?: string | null;
        featured_image_variants?: unknown;
        author_image_url?: string | null;
      }[]
    | null;
  error: { message: string } | null;
};

function postsQuery(result: PostsQueryResult) {
  return {
    select: () => ({
      order: () => ({
        range: (from: number, to: number) =>
          Promise.resolve(
            result.error
              ? result
              : {
                  data: (result.data ?? []).slice(from, to + 1),
                  error: null,
                }
          ),
      }),
    }),
  };
}

const mockSupabase = {
  from: vi.fn(),
  storage: {
    from: vi.fn(() => mockStorageBucket),
  },
};

let postsResult: PostsQueryResult = { data: [], error: null };

import { DELETE } from './route';

describe('DELETE /api/admin/blog/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    postsResult = { data: [], error: null };
    mockCreateClient.mockResolvedValue(mockSupabase);
    mockGetPlatformAdminAuthForPermission.mockResolvedValue({
      status: 'authenticated',
      user: { email: 'admin@baci.com', id: 'user-1' },
    });
    mockCheckCsrfProtection.mockResolvedValue({ valid: true, response: null });
    mockCheckRateLimit.mockResolvedValue(true);
    mockStorageBucket.remove.mockResolvedValue({ error: null });
    mockTombstoneUpsert.mockResolvedValue({ error: null });
    mockSupabase.from.mockImplementation((table: string) =>
      table === 'blog_media_delete_tombstones'
        ? { upsert: mockTombstoneUpsert }
        : postsQuery(postsResult)
    );
  });

  it('rejects non-platform media paths', async () => {
    const response = await DELETE(
      new NextRequest('http://localhost/api/admin/blog/upload', {
        body: JSON.stringify({ path: 'merchant-1/blog/cover.png' }),
        headers: { 'Content-Type': 'application/json' },
        method: 'DELETE',
      })
    );

    expect(response.status).toBe(403);
  });

  it('tombstones platform media paths and revalidates', async () => {
    const response = await DELETE(
      new NextRequest('http://localhost/api/admin/blog/upload', {
        body: JSON.stringify({ path: 'platform/blog/cover.png' }),
        headers: { 'Content-Type': 'application/json' },
        method: 'DELETE',
      })
    );

    expect(response.status).toBe(200);
    expect(mockTombstoneUpsert).toHaveBeenCalledWith(
      [{ path: 'platform/blog/cover.png' }],
      { ignoreDuplicates: true, onConflict: 'path' }
    );
    expect(mockStorageBucket.remove).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({
      skipped: [],
      success: true,
      tombstoned: ['platform/blog/cover.png'],
    });
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      mockSupabase,
      'user-1',
      'platform_blog_media_delete',
      30,
      1
    );
    expect(mockRevalidatePlatformBlog).toHaveBeenCalled();
  });

  it('allows cleanup when the upload budget is exhausted', async () => {
    // An invalidated upload may itself be the request that exhausts the
    // upload bucket; its cleanup must draw from a separate budget so a
    // 429 cannot strand the persisted source and variants.
    mockCheckRateLimit.mockImplementation(
      async (_supabase: unknown, _userId: string, key: string) =>
        key !== 'platform_blog_upload'
    );
    const response = await DELETE(
      new NextRequest('http://localhost/api/admin/blog/upload', {
        body: JSON.stringify({ path: 'platform/blog/cover.png' }),
        headers: { 'Content-Type': 'application/json' },
        method: 'DELETE',
      })
    );

    expect(response.status).toBe(200);
    expect(mockTombstoneUpsert).toHaveBeenCalledWith(
      [{ path: 'platform/blog/cover.png' }],
      { ignoreDuplicates: true, onConflict: 'path' }
    );
  });

  it('skips paths referenced by a persisted post from another session', async () => {
    // Tab A abandons an upload whose URL tab B already saved: the
    // persisted reference vetoes deletion instead of breaking tab B.
    postsResult = {
      data: [
        {
          author_image_url: null,
          content:
            '<p>Body</p><img src="https://cdn.example.com/media/platform/blog/shared.webp">',
          excerpt: null,
          featured_image_url: null,
          featured_image_variants: null,
        },
      ],
      error: null,
    };
    const response = await DELETE(
      new NextRequest('http://localhost/api/admin/blog/upload', {
        body: JSON.stringify({ path: 'platform/blog/shared.webp' }),
        headers: { 'Content-Type': 'application/json' },
        method: 'DELETE',
      })
    );

    expect(response.status).toBe(200);
    expect(mockTombstoneUpsert).not.toHaveBeenCalled();
    expect(mockStorageBucket.remove).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({
      skipped: ['platform/blog/shared.webp'],
      success: true,
      tombstoned: [],
    });
  });

  it('tombstones only paths no persisted post references', async () => {
    postsResult = {
      data: [
        {
          author_image_url: null,
          content:
            '<p>Body</p><img src="https://cdn.example.com/media/platform/blog/shared.webp">',
          excerpt: null,
          featured_image_url: null,
          featured_image_variants: null,
        },
      ],
      error: null,
    };
    const response = await DELETE(
      new NextRequest('http://localhost/api/admin/blog/upload', {
        body: JSON.stringify({
          path: 'platform/blog/shared.webp',
          variantPaths: ['platform/blog/orphan.webp'],
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'DELETE',
      })
    );

    expect(response.status).toBe(200);
    expect(mockTombstoneUpsert).toHaveBeenCalledWith(
      [{ path: 'platform/blog/orphan.webp' }],
      { ignoreDuplicates: true, onConflict: 'path' }
    );
    expect(mockStorageBucket.remove).not.toHaveBeenCalled();
  });

  it('fails closed when the reference scan errors', async () => {
    postsResult = { data: null, error: { message: 'down' } };
    const response = await DELETE(
      new NextRequest('http://localhost/api/admin/blog/upload', {
        body: JSON.stringify({ path: 'platform/blog/orphan.webp' }),
        headers: { 'Content-Type': 'application/json' },
        method: 'DELETE',
      })
    );

    expect(response.status).toBe(500);
    expect(mockTombstoneUpsert).not.toHaveBeenCalled();
    expect(mockStorageBucket.remove).not.toHaveBeenCalled();
  });

  it('fails closed when tombstone staging errors', async () => {
    mockTombstoneUpsert.mockResolvedValueOnce({ error: { message: 'down' } });
    const response = await DELETE(
      new NextRequest('http://localhost/api/admin/blog/upload', {
        body: JSON.stringify({ path: 'platform/blog/orphan.webp' }),
        headers: { 'Content-Type': 'application/json' },
        method: 'DELETE',
      })
    );

    expect(response.status).toBe(500);
    expect(mockStorageBucket.remove).not.toHaveBeenCalled();
  });
});
