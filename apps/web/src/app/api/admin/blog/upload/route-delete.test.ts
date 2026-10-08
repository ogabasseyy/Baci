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
      eq: () => ({ is: () => ({ limit: () => Promise.resolve(result) }) }),
    }),
  };
}

const mockSupabase = {
  from: vi.fn(),
  storage: {
    from: vi.fn(() => mockStorageBucket),
  },
};

import { DELETE } from './route';

describe('DELETE /api/admin/blog/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue(mockSupabase);
    mockGetPlatformAdminAuthForPermission.mockResolvedValue({
      status: 'authenticated',
      user: { email: 'admin@baci.com', id: 'user-1' },
    });
    mockCheckCsrfProtection.mockResolvedValue({ valid: true, response: null });
    mockCheckRateLimit.mockResolvedValue(true);
    mockStorageBucket.remove.mockResolvedValue({ error: null });
    mockSupabase.from.mockReturnValue(postsQuery({ data: [], error: null }));
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

  it('deletes platform media paths and revalidates', async () => {
    const response = await DELETE(
      new NextRequest('http://localhost/api/admin/blog/upload', {
        body: JSON.stringify({ path: 'platform/blog/cover.png' }),
        headers: { 'Content-Type': 'application/json' },
        method: 'DELETE',
      })
    );

    expect(response.status).toBe(200);
    expect(mockStorageBucket.remove).toHaveBeenCalledWith([
      'platform/blog/cover.png',
    ]);
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
    expect(mockStorageBucket.remove).toHaveBeenCalledWith([
      'platform/blog/cover.png',
    ]);
  });

  it('skips paths referenced by a persisted post from another session', async () => {
    // Tab A abandons an upload whose URL tab B already saved: the
    // persisted reference vetoes deletion instead of breaking tab B.
    mockSupabase.from.mockReturnValueOnce(
      postsQuery({
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
      })
    );
    const response = await DELETE(
      new NextRequest('http://localhost/api/admin/blog/upload', {
        body: JSON.stringify({ path: 'platform/blog/shared.webp' }),
        headers: { 'Content-Type': 'application/json' },
        method: 'DELETE',
      })
    );

    expect(response.status).toBe(200);
    expect(mockStorageBucket.remove).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({
      skipped: ['platform/blog/shared.webp'],
      success: true,
    });
  });

  it('deletes only paths no persisted post references', async () => {
    mockSupabase.from.mockReturnValueOnce(
      postsQuery({
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
      })
    );
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
    expect(mockStorageBucket.remove).toHaveBeenCalledWith([
      'platform/blog/orphan.webp',
    ]);
  });

  it('fails closed when the reference scan errors', async () => {
    mockSupabase.from.mockReturnValueOnce(
      postsQuery({ data: null, error: { message: 'down' } })
    );
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
