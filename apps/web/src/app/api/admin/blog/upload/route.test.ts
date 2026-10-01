import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_FILE_SIZE } from './upload-helpers';

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

const mockSupabase = {
  storage: {
    from: vi.fn(() => mockStorageBucket),
  },
};

import { DELETE, POST } from './route';

describe('POST /api/admin/blog/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue(mockSupabase);
    mockGetPlatformAdminAuthForPermission.mockResolvedValue({
      status: 'authenticated',
      user: { email: 'admin@baci.com', id: 'user-1' },
    });
    mockCheckCsrfProtection.mockResolvedValue({ valid: true, response: null });
    mockCheckRateLimit.mockResolvedValue(true);
    mockStorageBucket.upload.mockResolvedValue({ error: null });
  });

  it('returns 401 for unauthenticated users', async () => {
    mockGetPlatformAdminAuthForPermission.mockResolvedValueOnce({
      status: 'unauthenticated',
    });

    const response = await POST(
      new NextRequest('http://localhost/api/admin/blog/upload', {
        method: 'POST',
      })
    );

    expect(response.status).toBe(401);
  });

  it('denies a lower-privilege platform admin without content access', async () => {
    mockGetPlatformAdminAuthForPermission.mockResolvedValueOnce({
      status: 'forbidden',
    });

    const response = await POST(
      new NextRequest('http://localhost/api/admin/blog/upload', {
        method: 'POST',
      })
    );

    expect(response.status).toBe(403);
    expect(mockGetPlatformAdminAuthForPermission).toHaveBeenCalledWith(
      'content.manage'
    );
    expect(mockCheckCsrfProtection).not.toHaveBeenCalled();
  });

  it('uploads media under the platform/blog prefix', async () => {
    const file = new File(['file-bytes'], 'cover.png', {
      type: 'image/png',
    });
    const request = {
      formData: vi.fn().mockResolvedValue({
        get: (key: string) => (key === 'file' ? file : null),
      }),
    } as unknown as NextRequest;

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockStorageBucket.upload).toHaveBeenCalledWith(
      expect.stringMatching(/^platform\/blog\//),
      expect.any(Buffer),
      expect.objectContaining({
        contentType: 'image/png',
      })
    );
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      mockSupabase,
      'user-1',
      'platform_blog_upload',
      30,
      1
    );
    expect(mockRevalidatePlatformBlog).toHaveBeenCalled();
  });

  it('returns 429 when upload rate limit is exceeded', async () => {
    mockCheckRateLimit.mockResolvedValueOnce(false);
    const file = new File(['file-bytes'], 'cover.png', {
      type: 'image/png',
    });
    const request = {
      formData: vi.fn().mockResolvedValue({
        get: (key: string) => (key === 'file' ? file : null),
      }),
    } as unknown as NextRequest;

    const response = await POST(request);

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      code: 'rate_limited',
      error: 'Rate limit exceeded',
    });
    expect(mockStorageBucket.upload).not.toHaveBeenCalled();
  });

  it('rejects webp uploads for featured images', async () => {
    const file = new File(['file-bytes'], 'cover.webp', {
      type: 'image/webp',
    });
    const request = {
      formData: vi.fn().mockResolvedValue({
        get: (key: string) => {
          if (key === 'file') return file;
          if (key === 'purpose') return 'featured';
          return null;
        },
      }),
    } as unknown as NextRequest;

    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid file type',
    });
    expect(mockStorageBucket.upload).not.toHaveBeenCalled();
  });

  it('allows webp uploads for inline images', async () => {
    const file = new File(['file-bytes'], 'inline.webp', {
      type: 'image/webp',
    });
    const request = {
      formData: vi.fn().mockResolvedValue({
        get: (key: string) => (key === 'file' ? file : null),
      }),
    } as unknown as NextRequest;

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockStorageBucket.upload).toHaveBeenCalledWith(
      expect.stringMatching(/^platform\/blog\//),
      expect.any(Buffer),
      expect.objectContaining({
        contentType: 'image/webp',
      })
    );
  });

  it('rejects files above the OG-compatible max size', async () => {
    const file = new File([new Uint8Array(MAX_FILE_SIZE + 1)], 'cover.png', {
      type: 'image/png',
    });
    const request = {
      formData: vi.fn().mockResolvedValue({
        get: (key: string) => {
          if (key === 'file') return file;
          if (key === 'purpose') return 'featured';
          return null;
        },
      }),
    } as unknown as NextRequest;

    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'File too large. Maximum size is 4MB',
    });
    expect(mockStorageBucket.upload).not.toHaveBeenCalled();
  });
});

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
      'platform_blog_upload',
      30,
      1
    );
    expect(mockRevalidatePlatformBlog).toHaveBeenCalled();
  });
});
