import { NextRequest } from 'next/server';
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
  rpc: vi.fn(
    (
      _name: string,
      args: { p_paths: string[] }
    ): Promise<{
      data: { path: string }[] | null;
      error: { message: string } | null;
    }> =>
      Promise.resolve({
        data: args.p_paths.map((path) => ({ path })),
        error: null,
      })
  ),
  select: vi.fn(),
  single: vi.fn(),
};

mockSupabase.from.mockReturnValue(mockSupabase);
mockSupabase.select.mockReturnValue(mockSupabase);
mockSupabase.eq.mockReturnValue(mockSupabase);
mockSupabase.insert.mockReturnValue(mockSupabase);
mockSupabase.delete.mockReturnValue(mockSupabase);
mockSupabase.in.mockResolvedValue({ error: null });

import { POST } from './route';

function postRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/admin/blog/posts', {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
}

describe('POST /api/admin/blog/posts media verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset per-test implementations so unconsumed once-queues can
    // never leak a stale probe result into the next test.
    mockSupabase.eq.mockReset();
    mockSupabase.eq.mockReturnValue(mockSupabase);
    mockSupabase.in.mockReset();
    mockSupabase.in.mockResolvedValue({ error: null });
    mockSupabase.rpc.mockReset();
    mockSupabase.rpc.mockImplementation(
      (
        _name: string,
        args: { p_paths: string[] }
      ): Promise<{
        data: { path: string }[] | null;
        error: { message: string } | null;
      }> =>
        Promise.resolve({
          data: args.p_paths.map((path) => ({ path })),
          error: null,
        })
    );
    mockCreateClient.mockResolvedValue(mockSupabase);
    mockGetPlatformAdminAuthForPermission.mockResolvedValue({
      status: 'authenticated',
      user: { email: 'admin@baci.com', id: 'user-1' },
    });
    mockCheckCsrfProtection.mockResolvedValue({ valid: true, response: null });
    mockSupabase.single.mockResolvedValue({
      data: { id: 'post-1', slug: 'launch-faster', title: 'Launch Faster' },
      error: null,
    });
  });

  it('rolls back the insert when the sweep claimed between insert and verify', async () => {
    // The N1 ordering: the sweep's atomic claim commits after this
    // save's insert but before its verification probe, so the probe
    // reports the path missing and the save deletes the just-inserted
    // post loudly instead of persisting broken media.
    mockSupabase.rpc.mockResolvedValueOnce({ data: [], error: null });

    const response = await POST(
      postRequest({
        author_name: 'Baci Editorial',
        content:
          '<p>Body</p><img src="https://cdn.example.com/media/platform/blog/swept.webp">',
        slug: 'launch-faster',
        title: 'Launch Faster',
      })
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Referenced media was removed during save',
    });
    expect(mockSupabase.delete).toHaveBeenCalled();
    expect(mockSupabase.eq).toHaveBeenCalledWith('id', 'post-1');
    expect(mockRevalidatePlatformBlog).not.toHaveBeenCalled();
  });

  it('rolls back when media presence is unverifiable', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'down' },
    });

    const response = await POST(
      postRequest({
        author_name: 'Baci Editorial',
        content:
          '<p>Body</p><img src="https://cdn.example.com/media/platform/blog/shared.webp">',
        slug: 'launch-faster',
        title: 'Launch Faster',
      })
    );

    expect(response.status).toBe(500);
    expect(mockSupabase.delete).toHaveBeenCalled();
    expect(mockRevalidatePlatformBlog).not.toHaveBeenCalled();
  });

  it('retries the rollback when the delete resolves with an error', async () => {
    // PostgREST reports deletion failures through the resolved error
    // field rather than throwing; the rollback must inspect it and
    // retry instead of returning 500 while the broken post persists.
    // The sweep flags the path claimed (first in-call clears, second
    // probes), and the delete fails twice before succeeding.
    mockSupabase.in
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({
        data: [{ path: 'platform/blog/swept.webp' }],
        error: null,
      });
    let rollbackAttempts = 0;
    mockSupabase.eq.mockImplementation((column: string) => {
      if (column !== 'id') return mockSupabase;
      rollbackAttempts += 1;
      return rollbackAttempts < 3
        ? { error: { message: 'locked' } }
        : { error: null };
    });

    const response = await POST(
      postRequest({
        author_name: 'Baci Editorial',
        content:
          '<p>Body</p><img src="https://cdn.example.com/media/platform/blog/swept.webp">',
        slug: 'launch-faster',
        title: 'Launch Faster',
      })
    );

    expect(response.status).toBe(500);
    expect(rollbackAttempts).toBe(3);
  });

  it('keeps the post when every referenced object still exists', async () => {
    const response = await POST(
      postRequest({
        author_name: 'Baci Editorial',
        content:
          '<p>Body</p><img src="https://cdn.example.com/media/platform/blog/shared.webp">',
        slug: 'launch-faster',
        title: 'Launch Faster',
      })
    );

    expect(response.status).toBe(201);
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'blog_media_objects_present_v1',
      { p_paths: ['platform/blog/shared.webp'] }
    );
    expect(mockSupabase.eq).not.toHaveBeenCalledWith('id', 'post-1');
  });
});
