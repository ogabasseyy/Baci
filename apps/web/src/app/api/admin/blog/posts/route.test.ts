import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetPlatformAdminAuthForPermission = vi.fn();
const mockCreateClient = vi.fn();
const mockCheckCsrfProtection = vi.fn();
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

vi.mock('@/lib/cache-revalidation', () => ({
  revalidatePlatformBlog: (...args: unknown[]) =>
    mockRevalidatePlatformBlog(...args),
}));

const mockSupabase = {
  eq: vi.fn(),
  from: vi.fn(),
  is: vi.fn(),
  order: vi.fn(),
  range: vi.fn(),
  rpc: vi.fn((name: string, args: Record<string, unknown>) => {
    if (name === 'mutate_platform_blog_post_create_atomic') {
      return Promise.resolve({
        data: [{ id: 'post-1', slug: 'launch-faster', title: 'Launch Faster' }],
        error: null,
      });
    }
    const paths = (args.p_paths as string[] | undefined) ?? [];
    return Promise.resolve({
      data: paths.map((path) => ({ path })),
      error: null,
    });
  }),
  select: vi.fn(),
};

mockSupabase.from.mockReturnValue(mockSupabase);
mockSupabase.select.mockReturnValue(mockSupabase);
mockSupabase.eq.mockReturnValue(mockSupabase);
mockSupabase.is.mockReturnValue(mockSupabase);
mockSupabase.order.mockReturnValue(mockSupabase);
mockSupabase.range.mockReturnValue(mockSupabase);

import { GET, POST } from './route';

function createPatchData(): Record<string, unknown> {
  const calls = mockSupabase.rpc.mock.calls as [
    string,
    Record<string, unknown>,
  ][];
  const match = calls.find(
    ([name]) => name === 'mutate_platform_blog_post_create_atomic'
  );
  if (!match) throw new Error('atomic create RPC was not called');
  return match[1].p_post_data as Record<string, unknown>;
}

describe('GET /api/admin/blog/posts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue(mockSupabase);
    mockGetPlatformAdminAuthForPermission.mockResolvedValue({
      status: 'authenticated',
      user: { email: 'admin@baci.com', id: 'user-1' },
    });
    mockSupabase.range.mockResolvedValue({
      count: 1,
      data: [{ id: 'post-1', slug: 'launch-faster', title: 'Launch Faster' }],
      error: null,
    });
  });

  it('returns 401 for unauthenticated users', async () => {
    mockGetPlatformAdminAuthForPermission.mockResolvedValueOnce({
      status: 'unauthenticated',
    });

    const response = await GET(
      new NextRequest('http://localhost/api/admin/blog/posts')
    );

    expect(response.status).toBe(401);
  });

  it('denies a lower-privilege platform admin without content access', async () => {
    mockGetPlatformAdminAuthForPermission.mockResolvedValueOnce({
      status: 'forbidden',
    });

    const response = await GET(
      new NextRequest('http://localhost/api/admin/blog/posts')
    );

    expect(response.status).toBe(403);
    expect(mockGetPlatformAdminAuthForPermission).toHaveBeenCalledWith(
      'content.manage'
    );
  });

  it('lists platform posts only', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/admin/blog/posts?limit=10&offset=0')
    );

    expect(response.status).toBe(200);
    expect(mockSupabase.eq).toHaveBeenCalledWith('is_platform_post', true);
    expect(mockSupabase.is).toHaveBeenCalledWith('merchant_id', null);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        posts: [
          { id: 'post-1', slug: 'launch-faster', title: 'Launch Faster' },
        ],
      })
    );
  });
});

describe('POST /api/admin/blog/posts', () => {
  afterEach(vi.unstubAllEnvs);
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN', 'https://cdn.example.com');
    mockCreateClient.mockResolvedValue(mockSupabase);
    mockGetPlatformAdminAuthForPermission.mockResolvedValue({
      status: 'authenticated',
      user: { email: 'admin@baci.com', id: 'user-1' },
    });
    mockCheckCsrfProtection.mockResolvedValue({ valid: true, response: null });
  });

  it('checks auth before csrf on write requests', async () => {
    mockGetPlatformAdminAuthForPermission.mockResolvedValueOnce({
      status: 'unauthenticated',
    });

    const response = await POST(
      new NextRequest('http://localhost/api/admin/blog/posts', {
        method: 'POST',
      })
    );

    expect(response.status).toBe(401);
    expect(mockCheckCsrfProtection).not.toHaveBeenCalled();
  });

  it('returns csrf failure response when invalid', async () => {
    mockCheckCsrfProtection.mockResolvedValueOnce({
      valid: false,
      response: NextResponse.json({ error: 'CSRF failed' }, { status: 403 }),
    });

    const response = await POST(
      new NextRequest('http://localhost/api/admin/blog/posts', {
        method: 'POST',
      })
    );

    expect(response.status).toBe(403);
  });

  it('returns 400 for malformed JSON after auth and CSRF validation', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/admin/blog/posts', {
        body: '{',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid JSON body',
    });
    expect(mockCheckCsrfProtection).toHaveBeenCalledTimes(1);
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('sends media paths to the atomic create RPC', async () => {
    // A concurrent tab may have staged an upload this payload reuses;
    // the RPC registers its paths in the insert transaction.
    const response = await POST(
      new NextRequest('http://localhost/api/admin/blog/posts', {
        body: JSON.stringify({
          author_name: 'Baci Editorial',
          content:
            '<p>Body</p><img src="https://cdn.example.com/media/platform/blog/shared.webp">',
          slug: 'launch-faster',
          title: 'Launch Faster',
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
    );

    expect(response.status).toBe(201);
    const calls = mockSupabase.rpc.mock.calls as [
      string,
      Record<string, unknown>,
    ][];
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe('mutate_platform_blog_post_create_atomic');
    expect(calls[0]?.[1].p_media_paths).toEqual(['platform/blog/shared.webp']);
  });

  it('strips ownership guards and revalidates on successful create', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/admin/blog/posts', {
        body: JSON.stringify({
          author_name: 'Baci Editorial',
          content: 'Article body',
          is_platform_post: false,
          merchant_id: 'merchant-1',
          slug: 'launch-faster',
          title: 'Launch Faster',
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
    );

    expect(response.status).toBe(201);
    expect(createPatchData()).toEqual(
      expect.objectContaining({
        reading_time_minutes: expect.any(Number),
        slug: 'launch-faster',
        word_count: expect.any(Number),
      })
    );
    expect(createPatchData()).not.toHaveProperty('is_platform_post');
    expect(createPatchData()).not.toHaveProperty('merchant_id');
    expect(mockRevalidatePlatformBlog).toHaveBeenCalledWith('launch-faster');
  });

  it.each([
    null,
    '',
    '   ',
  ])('accepts unset editorial metadata on POST: %j', async (value) => {
    const response = await POST(
      new NextRequest('http://localhost/api/admin/blog/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Guide',
          slug: 'guide',
          content: '<p>Guide</p>',
          author_name: 'Editorial',
          intent: value,
          intent_source: value,
          focus_keyword: value,
        }),
      })
    );
    expect(response.status).toBe(201);
    expect(createPatchData()).toEqual(
      expect.objectContaining({
        intent: null,
        intent_source: null,
        focus_keyword: null,
      })
    );
  });

  it('drops an orphan intent_source when intent is omitted on POST', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/admin/blog/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Guide',
          slug: 'guide',
          content: '<p>Guide</p>',
          author_name: 'Editorial',
          intent_source: 'draft_task_type',
        }),
      })
    );
    expect(response.status).toBe(201);
    expect(createPatchData()).toMatchObject({ intent_source: null });
    expect(createPatchData()).not.toHaveProperty('intent');
  });
});
