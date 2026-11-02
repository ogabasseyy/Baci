import { type NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE, POST } from '@/app/api/media/route';
import { createMediaDeletionRpcMock } from '@/lib/media/media-deletion-rpc.test-support';

const mockCreateServerClient = vi.fn();
const mockCookies = vi.fn();
const mockGetMerchantForApiRequest = vi.fn();
const mockToUserAccess = vi.fn();
const mockHasPermission = vi.fn();
const mockCheckCsrfProtection = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: (...args: unknown[]) => mockCreateServerClient(...args),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => mockCookies()),
}));

vi.mock('@/lib/api-auth', () => ({
  hasPermission: (...args: unknown[]) => mockHasPermission(...args),
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mockCheckCsrfProtection(...args),
}));

vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: (...args: unknown[]) =>
    mockGetMerchantForApiRequest(...args),
  toUserAccess: (...args: unknown[]) => mockToUserAccess(...args),
}));

// Mock Supabase storage
const mockRemove = vi.fn();
const mockUpload = vi.fn();
const mockGetPublicUrl = vi.fn();
const mockStorageFrom = vi.fn(() => ({
  remove: mockRemove,
  upload: mockUpload,
  getPublicUrl: mockGetPublicUrl,
}));

const mockSupabase = {
  rpc: createMediaDeletionRpcMock(),
  auth: {
    getUser: vi.fn().mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    }),
  },
  storage: {
    from: mockStorageFrom,
  },
};

describe('DELETE /api/media', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateServerClient.mockReturnValue(mockSupabase);
    mockCookies.mockReturnValue({
      get: vi.fn(),
    });
    mockGetMerchantForApiRequest.mockResolvedValue({
      merchantId: 'merchant-123',
    });
    mockToUserAccess.mockReturnValue({});
    mockHasPermission.mockReturnValue(true);
    mockRemove.mockResolvedValue({ error: null });
    mockCheckCsrfProtection.mockResolvedValue({ valid: true });
  });

  it('allows deletion of valid file ID', async () => {
    const request = new Request(
      'http://localhost:3000/api/media?id=valid-file.jpg',
      {
        method: 'DELETE',
        headers: {
          Cookie: 'csrf_token=test-csrf-token',
          'x-csrf-token': 'test-csrf-token',
        },
      }
    ) as unknown as NextRequest;

    const response = await DELETE(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockStorageFrom).toHaveBeenCalledWith('media');
    expect(mockRemove).toHaveBeenCalledWith(['merchant-123/valid-file.jpg']);
  });

  it('prevents path traversal in file ID', async () => {
    const request = new Request(
      'http://localhost:3000/api/media?id=../../secret.txt',
      {
        method: 'DELETE',
      }
    ) as unknown as NextRequest;

    const response = await DELETE(request);

    expect(mockRemove).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
  });

  it('prevents absolute path / root path attempts', async () => {
    const request = new Request(
      'http://localhost:3000/api/media?id=/etc/passwd',
      {
        method: 'DELETE',
      }
    ) as unknown as NextRequest;

    const response = await DELETE(request);

    expect(mockRemove).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
  });

  it('returns 400 when id query param is missing', async () => {
    const request = new Request('http://localhost:3000/api/media', {
      method: 'DELETE',
    }) as unknown as NextRequest;

    const response = await DELETE(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('File ID required');
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'Not authenticated' },
    });

    const request = new Request(
      'http://localhost:3000/api/media?id=valid-file.jpg',
      {
        method: 'DELETE',
      }
    ) as unknown as NextRequest;

    const response = await DELETE(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('returns pending when storage removal fails', async () => {
    mockRemove.mockResolvedValueOnce({
      error: { message: 'Storage error' },
    });

    const request = new Request(
      'http://localhost:3000/api/media?id=valid-file.jpg',
      {
        method: 'DELETE',
      }
    ) as unknown as NextRequest;

    const response = await DELETE(request);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.code).toBe('media_delete_pending');
  });

  it('returns 403 when CSRF token is invalid', async () => {
    mockCheckCsrfProtection.mockResolvedValue({
      valid: false,
      response: NextResponse.json(
        { error: 'Invalid CSRF token' },
        { status: 403 }
      ),
    });

    const request = new Request(
      'http://localhost:3000/api/media?id=valid-file.jpg',
      {
        method: 'DELETE',
      }
    ) as unknown as NextRequest;

    const response = await DELETE(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Invalid CSRF token');
    expect(mockCheckCsrfProtection).toHaveBeenCalled();
    expect(mockRemove).not.toHaveBeenCalled();
  });
});

describe('POST /api/media', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateServerClient.mockReturnValue(mockSupabase);
    mockCookies.mockReturnValue({
      get: vi.fn(),
    });
    mockGetMerchantForApiRequest.mockResolvedValue({
      merchantId: 'merchant-123',
    });
    mockToUserAccess.mockReturnValue({});
    mockHasPermission.mockReturnValue(true);
    mockCheckCsrfProtection.mockResolvedValue({ valid: true });
  });

  it('returns 403 when CSRF token is invalid', async () => {
    mockCheckCsrfProtection.mockResolvedValue({
      valid: false,
      response: NextResponse.json(
        { error: 'Invalid CSRF token' },
        { status: 403 }
      ),
    });

    const formData = new FormData();
    formData.append(
      'file',
      new File(['test'], 'test.jpg', { type: 'image/jpeg' })
    );

    const request = new Request('http://localhost:3000/api/media', {
      method: 'POST',
      body: formData,
    }) as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Invalid CSRF token');
    expect(mockCheckCsrfProtection).toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'Not authenticated' },
    });

    const formData = new FormData();
    formData.append(
      'file',
      new File(['test'], 'test.jpg', { type: 'image/jpeg' })
    );

    const request = new Request('http://localhost:3000/api/media', {
      method: 'POST',
      body: formData,
    }) as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('returns 403 when permission is denied', async () => {
    mockHasPermission.mockReturnValue(false);

    const request = new Request('http://localhost:3000/api/media', {
      method: 'POST',
    }) as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Forbidden');
    expect(mockUpload).not.toHaveBeenCalled();
  });
});
