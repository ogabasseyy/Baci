import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  delete: vi.fn(),
  eq: vi.fn(),
  from: vi.fn(),
  in: vi.fn(),
  insert: vi.fn(),
  is: vi.fn(),
  not: vi.fn(),
  order: vi.fn(),
  range: vi.fn(),
  select: vi.fn(),
  single: vi.fn(),
};

mockSupabase.from.mockReturnValue(mockSupabase);
mockSupabase.select.mockReturnValue(mockSupabase);
mockSupabase.eq.mockReturnValue(mockSupabase);
mockSupabase.is.mockReturnValue(mockSupabase);
mockSupabase.not.mockReturnValue(mockSupabase);
mockSupabase.order.mockReturnValue(mockSupabase);
mockSupabase.range.mockReturnValue(mockSupabase);
mockSupabase.insert.mockReturnValue(mockSupabase);
mockSupabase.delete.mockReturnValue(mockSupabase);
mockSupabase.in.mockResolvedValue({ error: null });

import { GET, POST } from './route';

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
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue(mockSupabase);
    mockGetPlatformAdminAuthForPermission.mockResolvedValue({
      status: 'authenticated',
      user: { email: 'admin@baci.com', id: 'user-1' },
    });
    mockCheckCsrfProtection.mockResolvedValue({ valid: true, response: null });
    mockSupabase.single.mockResolvedValue({
      data: {
        id: 'post-1',
        slug: 'launch-faster',
        title: 'Launch Faster',
      },
      error: null,
    });
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

  it('resurrects tombstones referenced by the created payload', async () => {
    // A concurrent tab may have staged an upload this payload reuses;
    // the save clears its tombstone before the sweep can remove it.
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
    expect(mockSupabase.from).toHaveBeenCalledWith(
      'blog_media_delete_tombstones'
    );
    expect(mockSupabase.in).toHaveBeenCalledWith('path', [
      'platform/blog/shared.webp',
    ]);
  });

  it('forces platform post fields and revalidates on successful create', async () => {
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
    expect(mockSupabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        is_platform_post: true,
        merchant_id: null,
        reading_time_minutes: expect.any(Number),
        slug: 'launch-faster',
        word_count: expect.any(Number),
      })
    );
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
    expect(mockSupabase.insert).toHaveBeenCalledWith(
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
    const inserted = mockSupabase.insert.mock.calls[0][0];
    expect(inserted).toMatchObject({ intent_source: null });
    expect(inserted).not.toHaveProperty('intent');
  });
});
