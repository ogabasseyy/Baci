import { NextRequest } from 'next/server';
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
  rpc: vi.fn(),
};

import { POST } from './route';

function postRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/admin/blog/posts', {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
}

function validBody(): Record<string, unknown> {
  return {
    author_name: 'Baci Editorial',
    content: 'Article body',
    slug: 'launch-faster',
    title: 'Launch Faster',
  };
}

describe('POST /api/admin/blog/posts error paths', () => {
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

  it('maps duplicate slugs to a conflict response', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: null,
      error: { code: '23505' },
    });

    const response = await POST(postRequest(validBody()));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'A post with this slug already exists',
    });
    expect(mockRevalidatePlatformBlog).not.toHaveBeenCalled();
  });

  it('maps a swept-media abort to the removed-media response', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: null,
      error: {
        code: 'P0001',
        message:
          'platform_blog_media_swept_during_save: platform/blog/gone.webp',
      },
    });

    const response = await POST(postRequest(validBody()));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Referenced media was removed during save',
    });
    expect(mockRevalidatePlatformBlog).not.toHaveBeenCalled();
  });

  it('maps an empty RPC result to the generic failure response', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: [], error: null });

    const response = await POST(postRequest(validBody()));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to create platform blog post',
    });
  });
});
