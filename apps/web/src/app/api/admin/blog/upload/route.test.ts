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
const mockDeleteEq = vi.fn();
const mockDeleteIn = vi.fn(() => ({ eq: mockDeleteEq }));

const mockSupabase = {
  from: vi.fn(() => ({
    delete: vi.fn(() => ({ in: mockDeleteIn })),
    upsert: mockUpsert,
  })),
  storage: {
    from: vi.fn(() => mockStorageBucket),
  },
};

import { POST } from './route';

function uploadRequest({
  bytes = ['file-bytes'],
  filename = 'inline.webp',
  purpose = null,
  type = 'image/webp',
}: {
  bytes?: BlobPart[];
  filename?: string;
  purpose?: string | null;
  type?: string;
} = {}): NextRequest {
  const file = new File(bytes, filename, { type });
  return {
    formData: vi.fn().mockResolvedValue({
      get: (key: string) => {
        if (key === 'file') return file;
        if (key === 'purpose') return purpose;
        return null;
      },
    }),
  } as unknown as NextRequest;
}

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
    const request = uploadRequest({ filename: 'cover.png', type: 'image/png' });

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
    const request = uploadRequest({ filename: 'cover.png', type: 'image/png' });

    const response = await POST(request);

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      code: 'rate_limited',
      error: 'Rate limit exceeded',
    });
    expect(mockStorageBucket.upload).not.toHaveBeenCalled();
  });

  it('rejects webp uploads for featured images', async () => {
    const request = uploadRequest({
      filename: 'cover.webp',
      purpose: 'featured',
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid file type',
    });
    expect(mockStorageBucket.upload).not.toHaveBeenCalled();
  });

  it('allows webp uploads for inline images', async () => {
    const request = uploadRequest();

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

  it('pre-stages uploads as tombstones so an abandoned session still sweeps', async () => {
    // The unmount flush never runs when the tab closes mid-draft, so
    // the upload itself must leave the record the cron reaps. A later
    // save clears the staged rows; only abandoned uploads go due.
    const request = uploadRequest({ purpose: 'inline' });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledWith(
      [{ path: expect.stringMatching(/^platform\/blog\//) }],
      { ignoreDuplicates: true, onConflict: 'path' }
    );
  });

  it('writes nothing when pre-staging fails instead of orphaning uploads', async () => {
    mockUpsert.mockResolvedValueOnce({ error: { message: 'down' } });
    mockStorageBucket.remove.mockResolvedValueOnce({ error: null });
    const request = uploadRequest({ purpose: 'inline' });

    const response = await POST(request);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      code: 'UPLOAD_FAILED',
      error: 'Failed to upload file',
    });
    expect(mockStorageBucket.upload).not.toHaveBeenCalled();
    expect(mockStorageBucket.remove).toHaveBeenCalledWith([
      expect.stringMatching(/^platform\/blog\//),
    ]);
  });

  it('releases the pre-staged tombstone when the storage write fails', async () => {
    mockStorageBucket.upload.mockResolvedValueOnce({
      error: { message: 'storage down' },
    });
    mockDeleteEq.mockResolvedValue({ error: null });
    const request = uploadRequest({ purpose: 'inline' });

    const response = await POST(request);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      code: 'UPLOAD_FAILED',
      error: 'Failed to upload file',
    });
    expect(mockDeleteIn).toHaveBeenCalledWith('path', [
      expect.stringMatching(/^platform\/blog\//),
    ]);
    expect(mockDeleteEq).toHaveBeenCalledWith('claimed', false);
  });

  it('rejects files above the OG-compatible max size', async () => {
    const request = uploadRequest({
      bytes: [new Uint8Array(MAX_FILE_SIZE + 1)],
      filename: 'cover.png',
      purpose: 'featured',
      type: 'image/png',
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'File too large. Maximum size is 4MB',
    });
    expect(mockStorageBucket.upload).not.toHaveBeenCalled();
  });
});
