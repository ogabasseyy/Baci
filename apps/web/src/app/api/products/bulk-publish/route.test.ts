import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Mocks ----

vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://test.supabase.co',
  getSupabaseAnonKey: () => 'test-anon-key',
  getSupabaseServiceRoleKey: () => 'test-service-role-key',
  getRootDomain: () => 'localhost',
}));

const mockRevalidateProducts = vi.fn();
const mockRevalidateProductSlugs = vi.fn();
vi.mock('@/lib/cache-revalidation', () => ({
  revalidateProducts: (...args: unknown[]) => mockRevalidateProducts(...args),
  revalidateProductSlugs: (...args: unknown[]) =>
    mockRevalidateProductSlugs(...args),
}));

const mockScheduleStorefrontProductPurge = vi.fn();
vi.mock('@/lib/storefront-product-purge', () => ({
  scheduleStorefrontProductPurge: (...args: unknown[]) =>
    mockScheduleStorefrontProductPurge(...args),
}));
const mockScheduleProductBlogPurgeAfterResponse = vi.fn();
vi.mock('@/lib/schedule-product-blog-purge-after-response', () => ({
  scheduleProductBlogPurgeAfterResponse: (...args: unknown[]) =>
    mockScheduleProductBlogPurgeAfterResponse(...args),
}));

const mockCheckCsrfProtection = vi.fn();
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mockCheckCsrfProtection(...args),
}));

const mockHasPermission = vi.fn();
vi.mock('@/lib/api-auth', () => ({
  hasPermission: (...args: unknown[]) => mockHasPermission(...args),
}));

// Supabase mock
const MERCHANT_ID = 'merchant-123';
const USER_ID = 'user-123';

let authUser: { id: string } | null = { id: USER_ID };
let merchantContext: {
  merchantId: string;
  merchantSlug?: string;
  staffAccess: {
    isStaff: boolean;
    isOwner: boolean;
    role: null;
    permissions: Record<string, unknown>;
  };
} | null = {
  merchantId: MERCHANT_ID,
  merchantSlug: 'test-store',
  staffAccess: {
    isStaff: false,
    isOwner: true,
    role: null,
    permissions: { full_access: { all: true } },
  },
};
let deleteData: unknown[] = [{ id: 'draft-1' }];
let deleteError: unknown = null;
let updateData: unknown[] = [{ id: 'product-1' }];
let updateError: unknown = null;

const mockGetMerchantForApiRequest = vi.fn();
const mockToUserAccess = vi.fn();
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: (...args: unknown[]) =>
    mockGetMerchantForApiRequest(...args),
  toUserAccess: (...args: unknown[]) => mockToUserAccess(...args),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn(),
    set: vi.fn(),
  }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(() =>
        Promise.resolve({
          data: { user: authUser },
          error: authUser ? null : { message: 'Not authenticated' },
        })
      ),
    },
    from: vi.fn((table: string) => {
      if (table === 'products') {
        return {
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                select: vi.fn(() =>
                  Promise.resolve({ data: deleteData, error: deleteError })
                ),
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              neq: vi.fn().mockReturnValue({
                select: vi.fn(() =>
                  Promise.resolve({ data: updateData, error: updateError })
                ),
              }),
            }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
        single: vi.fn(() => Promise.resolve({ data: null, error: null })),
      };
    }),
  })),
}));

// ---- Tests ----

describe('POST /api/products/bulk-publish', () => {
  const createRequest = (
    body?: unknown,
    headers: Record<string, string> = {}
  ) =>
    new Request('http://localhost/api/products/bulk-publish', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }) as unknown as NextRequest;

  beforeEach(() => {
    vi.clearAllMocks();
    authUser = { id: USER_ID };
    merchantContext = {
      merchantId: MERCHANT_ID,
      merchantSlug: 'test-store',
      staffAccess: {
        isStaff: false,
        isOwner: true,
        role: null,
        permissions: { full_access: { all: true } },
      },
    };
    deleteData = [{ id: 'draft-1' }];
    deleteError = null;
    updateData = [{ id: 'product-1' }, { id: 'product-2' }];
    updateError = null;
    mockCheckCsrfProtection.mockResolvedValue({ valid: true, response: null });
    mockHasPermission.mockReturnValue(true);
    mockGetMerchantForApiRequest.mockResolvedValue(merchantContext);
    // Owner merchant context uses role `null`; `toUserAccess` normalizes that to `owner`.
    mockToUserAccess.mockReturnValue({
      merchantId: MERCHANT_ID,
      isStaff: false,
      isOwner: true,
      role: 'owner',
      permissions: { full_access: { all: true } },
    });
  });

  it('returns 401 when not authenticated', async () => {
    const { POST } = await import('./route');
    authUser = null;

    const res = await POST(createRequest());
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toBe('Unauthorized');
  });

  it('returns 404 when merchant not found', async () => {
    const { POST } = await import('./route');
    merchantContext = null;
    mockGetMerchantForApiRequest.mockResolvedValue(merchantContext);

    const res = await POST(createRequest());
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('Merchant not found');
  });

  it('returns 403 when permission is denied', async () => {
    const { POST } = await import('./route');
    mockHasPermission.mockReturnValue(false);

    const res = await POST(createRequest());
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toBe('Permission denied');
  });

  it('deletes drafts and publishes products', async () => {
    const { POST } = await import('./route');

    const res = await POST(createRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.deletedDrafts).toBe(1);
    expect(json.publishedProducts).toBe(2);
  });

  it('calls revalidateProducts after publish', async () => {
    const { POST } = await import('./route');

    await POST(createRequest());

    expect(mockRevalidateProducts).toHaveBeenCalledWith(MERCHANT_ID);
  });

  it('does not purge deleted drafts when no products became public', async () => {
    const { POST } = await import('./route');
    deleteData = [{ id: 'draft-1' }];
    updateData = [];

    const response = await POST(createRequest());

    expect(response.status).toBe(200);
    expect(mockRevalidateProducts).toHaveBeenCalledWith(MERCHANT_ID);
    expect(mockRevalidateProductSlugs).not.toHaveBeenCalled();
    expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
  });

  it('returns 500 when update fails', async () => {
    const { POST } = await import('./route');
    updateError = { message: 'DB error' };

    const res = await POST(createRequest());
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('Failed to publish products');
  });

  it('returns 500 when delete drafts fails', async () => {
    const { POST } = await import('./route');
    deleteError = { message: 'Delete failed' };

    const res = await POST(createRequest());
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('Failed to delete draft products');
  });

  it('handles zero deleted drafts and zero published', async () => {
    const { POST } = await import('./route');
    deleteData = [];
    updateData = [];

    const res = await POST(createRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.deletedDrafts).toBe(0);
    expect(json.publishedProducts).toBe(0);
  });

  it('returns csrf rejection response when token is invalid', async () => {
    const { POST } = await import('./route');
    mockCheckCsrfProtection.mockResolvedValue({
      valid: false,
      response: new Response(JSON.stringify({ error: 'Invalid CSRF token' }), {
        status: 403,
      }),
    });

    const res = await POST(createRequest());
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toBe('Invalid CSRF token');
  });
});
