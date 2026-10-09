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

const mockUpsert = vi.fn();

const mockSupabase = {
  from: vi.fn(() => ({ upsert: mockUpsert })),
  storage: {
    from: vi.fn(() => mockStorageBucket),
  },
};

import { POST } from './route';

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
    mockUpsert.mockResolvedValue({ error: null });
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

  it('stages uploads as tombstones so an abandoned session still sweeps', async () => {
    // The unmount flush never runs when the tab closes mid-draft, so
    // the upload itself must leave the record the cron reaps. A later
    // save clears the staged rows; only abandoned uploads go due.
    const file = new File(['file-bytes'], 'inline.webp', {
      type: 'image/webp',
    });
    const request = {
      formData: vi.fn().mockResolvedValue({
        get: (key: string) => {
          if (key === 'file') return file;
          if (key === 'purpose') return 'inline';
          return null;
        },
      }),
    } as unknown as NextRequest;

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledWith(
      [{ path: expect.stringMatching(/^platform\/blog\//) }],
      { ignoreDuplicates: true, onConflict: 'path' }
    );
  });

  it('removes uploaded objects when staging fails instead of orphaning them', async () => {
    mockUpsert.mockResolvedValueOnce({ error: { message: 'down' } });
    mockStorageBucket.remove.mockResolvedValueOnce({ error: null });
    const file = new File(['file-bytes'], 'inline.webp', {
      type: 'image/webp',
    });
    const request = {
      formData: vi.fn().mockResolvedValue({
        get: (key: string) => {
          if (key === 'file') return file;
          if (key === 'purpose') return 'inline';
          return null;
        },
      }),
    } as unknown as NextRequest;

    const response = await POST(request);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      code: 'UPLOAD_FAILED',
      error: 'Failed to upload file',
    });
    expect(mockStorageBucket.remove).toHaveBeenCalledWith([
      expect.stringMatching(/^platform\/blog\//),
    ]);
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
