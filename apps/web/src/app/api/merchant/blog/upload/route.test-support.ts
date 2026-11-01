import type { NextRequest } from 'next/server';
import { vi } from 'vitest';
import { DEFAULT_BLOG_MEDIA_CDN_ORIGIN } from '@/config/cdn';
import { createMediaDeletionRpcMock } from '@/lib/media/media-deletion-rpc.test-support';

export const mockCheckCsrfProtection = vi.fn();
export const mockAuthenticateApiRequest = vi.fn();
export const mockGetMerchantForApiRequest = vi.fn();
export const mockHasPermission = vi.fn();
export const mockCheckRateLimit = vi.fn();
export const mockGenerateFeaturedImageVariants = vi.fn();
export const mockIsManagedBlogStoragePath = vi.fn();
export const mockToUserAccess = vi.fn();
export const BLOG_MEDIA_CDN_BASE = `${DEFAULT_BLOG_MEDIA_CDN_ORIGIN}/media`;

export class MockBlogFeaturedImageError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'BlogFeaturedImageError';
    this.code = code;
  }
}

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mockCheckCsrfProtection(...args),
}));
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) =>
    mockAuthenticateApiRequest(...args),
  hasPermission: (...args: unknown[]) => mockHasPermission(...args),
}));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: (...args: unknown[]) =>
    mockGetMerchantForApiRequest(...args),
  toUserAccess: (...args: unknown[]) => mockToUserAccess(...args),
}));
vi.mock('@/lib/rate-limiter', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));
vi.mock('@/lib/blog-featured-image-variants', () => ({
  BlogFeaturedImageError: MockBlogFeaturedImageError,
  generateFeaturedImageVariants: (...args: unknown[]) =>
    mockGenerateFeaturedImageVariants(...args),
  isManagedBlogStoragePath: (...args: unknown[]) =>
    mockIsManagedBlogStoragePath(...args),
}));

const routeModule = await import('./route');
export const { POST, DELETE } = routeModule;

export const ownerAccess = {
  merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  isOwner: true,
  isStaff: false,
  role: 'owner',
  permissions: { '*': { '*': true } },
};

export function makeUploadRequest(input: {
  file?: File;
  purpose?: 'featured' | 'inline';
}): NextRequest {
  const formData = new FormData();
  if (input.file) formData.append('file', input.file);
  if (input.purpose) formData.append('purpose', input.purpose);
  return {
    headers: new Headers({ host: 'localhost:3000' }),
    formData: vi.fn().mockResolvedValue(formData),
  } as unknown as NextRequest;
}

export function makeDeleteRequest(body: unknown): NextRequest {
  return {
    headers: new Headers({ host: 'localhost:3000' }),
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

export function createSupabaseMock() {
  const upload = vi.fn().mockResolvedValue({ error: null });
  const remove = vi.fn().mockResolvedValue({ error: null });
  const storageBucket = { upload, remove };
  return {
    supabase: {
      rpc: createMediaDeletionRpcMock(),
      storage: {
        from: vi.fn((bucket: string) => {
          if (bucket !== 'media')
            throw new Error(`Unexpected bucket: ${bucket}`);
          return storageBucket;
        }),
      },
    },
    upload,
    remove,
  };
}

export function mockAuthenticatedRequest(supabase: unknown) {
  mockAuthenticateApiRequest.mockResolvedValue({
    user: { id: 'user-1' },
    error: null,
    supabase,
  });
}

export function mockAuthorizedMerchant() {
  mockGetMerchantForApiRequest.mockResolvedValue({
    merchantId: ownerAccess.merchantId,
    staffAccess: {},
  });
  mockToUserAccess.mockReturnValue(ownerAccess);
  mockHasPermission.mockReturnValue(true);
}
