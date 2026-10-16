import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type ServerModule = typeof import('next/server');
type GetMerchantForApiRequestModule =
  typeof import('@/lib/get-merchant-for-api-request');

const mockCheckCsrfProtection = vi.fn();
const mockAuthenticateApiRequest = vi.fn();
const mockGetMerchantForApiRequest = vi.fn();
const mockRpc = vi.fn();
const mockFrom = vi.fn();
const mockRevalidateMerchant = vi.fn();
const mockRevalidateDomains = vi.fn();
const mockRevalidatePageConfig = vi.fn();
const mockRevalidateMerchantFeed = vi.fn();
const mockRevalidateSlugLookup = vi.fn();
const mockRevalidateProductsSlugCache = vi.fn();
const mockRevalidateBlogFeed = vi.fn();
const mockTriggerSync = vi.fn();
const merchantAId = '11111111-1111-4111-8111-111111111111';

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<ServerModule>();
  // Run after() callbacks synchronously so we can assert the Edge Config resync.
  return { ...actual, after: (fn: () => unknown) => fn() };
});

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mockCheckCsrfProtection(...args),
}));

vi.mock('@/lib/edge-config-sync', () => ({
  triggerDomainEdgeConfigSync: (...args: unknown[]) => mockTriggerSync(...args),
}));

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) =>
    mockAuthenticateApiRequest(...args),
}));

vi.mock('@/lib/get-merchant-for-api-request', async (importOriginal) => {
  const actual = await importOriginal<GetMerchantForApiRequestModule>();

  return {
    ...actual,
    getMerchantForApiRequest: (...args: unknown[]) =>
      mockGetMerchantForApiRequest(...args),
  };
});

vi.mock('@/lib/cache-revalidation', () => ({
  revalidateMerchant: (...args: unknown[]) => mockRevalidateMerchant(...args),
  revalidateDomains: (...args: unknown[]) => mockRevalidateDomains(...args),
  revalidatePageConfig: (...args: unknown[]) =>
    mockRevalidatePageConfig(...args),
  revalidateMerchantFeed: (...args: unknown[]) =>
    mockRevalidateMerchantFeed(...args),
  revalidateMerchantSlugLookup: (...args: unknown[]) =>
    mockRevalidateSlugLookup(...args),
  revalidateStorefrontProductsSlugCache: (...args: unknown[]) =>
    mockRevalidateProductsSlugCache(...args),
  revalidateBlogFeed: (...args: unknown[]) => mockRevalidateBlogFeed(...args),
}));

vi.mock('@/env', () => ({ getRootDomain: () => 'usebaci.com' }));

const { POST } = await import('./route');

function createRequest(body: unknown): NextRequest {
  const requestBody =
    body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  return new Request('http://localhost/api/merchant/rename-slug', {
    method: 'POST',
    body:
      typeof body === 'string'
        ? body
        : JSON.stringify({
            merchantId: merchantAId,
            ...requestBody,
          }),
    headers: { 'Content-Type': 'application/json' },
  }) as unknown as NextRequest;
}

describe('POST /api/merchant/rename-slug', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateApiRequest.mockResolvedValue({
      error: null,
      user: { id: 'user-1' },
      supabase: { rpc: mockRpc, from: mockFrom },
    });
    // The route reads the current slug (before the rename) via
    // from('merchants').select('slug').eq(...).maybeSingle().
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { slug: 'oldslug' },
        error: null,
      }),
    });
    mockCheckCsrfProtection.mockResolvedValue({ valid: true, response: null });
    mockGetMerchantForApiRequest.mockResolvedValue({
      merchantId: merchantAId,
      staffAccess: {
        isOwner: true,
        isStaff: false,
        permissions: {},
        role: 'owner',
      },
    });
    // rename_merchant_slug returns { slug, retired_slug } (jsonb).
    mockRpc.mockResolvedValue({
      data: { slug: 'newslug', retired_slug: 'oldslug' },
      error: null,
    });
  });

  it('returns 401 when the request is not authenticated', async () => {
    mockAuthenticateApiRequest.mockResolvedValue({
      error: 'Unauthorized',
      user: null,
      supabase: null,
    });
    const response = await POST(createRequest({ new_slug: 'newslug' }));
    expect(response.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns 403 when CSRF validation fails', async () => {
    mockCheckCsrfProtection.mockResolvedValue({ valid: false, response: null });
    const response = await POST(createRequest({ new_slug: 'newslug' }));
    expect(response.status).toBe(403);
  });

  it('returns 403 when the staff member lacks settings-edit permission', async () => {
    mockGetMerchantForApiRequest.mockResolvedValue({
      merchantId: merchantAId,
      staffAccess: {
        isOwner: false,
        isStaff: true,
        permissions: { products: { edit: true } },
        role: 'staff',
      },
    });
    const response = await POST(createRequest({ new_slug: 'newslug' }));
    expect(response.status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('allows a staff member granted full_access.all (matches the DB check)', async () => {
    mockGetMerchantForApiRequest.mockResolvedValue({
      merchantId: merchantAId,
      staffAccess: {
        isOwner: false,
        isStaff: true,
        permissions: { full_access: { all: true } },
        role: 'staff',
      },
    });
    const response = await POST(createRequest({ new_slug: 'newslug' }));
    expect(response.status).toBe(200);
    expect(mockRpc).toHaveBeenCalled();
  });

  it('allows a wildcard-resource edit grant ({ "*": { edit: true } })', async () => {
    mockGetMerchantForApiRequest.mockResolvedValue({
      merchantId: merchantAId,
      staffAccess: {
        isOwner: false,
        isStaff: true,
        permissions: { '*': { edit: true } },
        role: 'staff',
      },
    });
    const response = await POST(createRequest({ new_slug: 'newslug' }));
    expect(response.status).toBe(200);
  });

  it('allows a wildcard-action settings grant ({ settings: { "*": true } })', async () => {
    mockGetMerchantForApiRequest.mockResolvedValue({
      merchantId: merchantAId,
      staffAccess: {
        isOwner: false,
        isStaff: true,
        permissions: { settings: { '*': true } },
        role: 'staff',
      },
    });
    const response = await POST(createRequest({ new_slug: 'newslug' }));
    expect(response.status).toBe(200);
  });

  it('returns 400 for a slug that fails schema validation', async () => {
    const response = await POST(createRequest({ new_slug: 'A' }));
    expect(response.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('renames via the RPC and busts caches on success', async () => {
    const response = await POST(createRequest({ new_slug: 'newslug' }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('rename_merchant_slug', {
      p_merchant_id: merchantAId,
      p_new_slug: 'newslug',
    });
    expect(payload).toEqual({
      slug: 'newslug',
      url: 'https://newslug.usebaci.com',
    });
    expect(mockRevalidateMerchant).toHaveBeenCalledWith(merchantAId, 'newslug');
    expect(mockRevalidateDomains).toHaveBeenCalled();
    expect(mockRevalidatePageConfig).toHaveBeenCalledWith(merchantAId);
    expect(mockRevalidateMerchantFeed).toHaveBeenCalledWith(merchantAId);
    // The by-slug lookup cache must be busted for BOTH the retired slug (so it
    // stops resolving to a live store) and the new slug (so it serves at once).
    expect(mockRevalidateSlugLookup).toHaveBeenCalledWith('oldslug');
    expect(mockRevalidateSlugLookup).toHaveBeenCalledWith('newslug');
    // The /api/storefront/[slug]/products lookup caches under a generic tag not
    // covered above — bust it so a pre-rename miss doesn't 404 the products API.
    expect(mockRevalidateProductsSlugCache).toHaveBeenCalled();
    // The blog RSS feed caches slug-bearing URLs by merchant id — bust it too.
    expect(mockRevalidateBlogFeed).toHaveBeenCalled();
    // Backstop resync so a custom domain's Edge Config mapping follows the rename.
    expect(mockTriggerSync).toHaveBeenCalled();
  });

  it('invalidates the slug the RPC actually retired, not the pre-RPC read', async () => {
    // Concurrent rename: the pre-RPC read captured 'store-a', but a rename that
    // interleaved made THIS call actually retire 'store-b'. The RPC reports the
    // real retired slug, and caches for that intermediate URL must be busted.
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi
        .fn()
        .mockResolvedValue({ data: { slug: 'store-a' }, error: null }),
    });
    mockRpc.mockResolvedValue({
      data: { slug: 'store-c', retired_slug: 'store-b' },
      error: null,
    });

    const response = await POST(createRequest({ new_slug: 'store-c' }));

    expect(response.status).toBe(200);
    // Busts the ACTUAL retired slug + the final slug, NOT the stale pre-RPC read.
    expect(mockRevalidateSlugLookup).toHaveBeenCalledWith('store-b');
    expect(mockRevalidateSlugLookup).toHaveBeenCalledWith('store-c');
    expect(mockRevalidateSlugLookup).not.toHaveBeenCalledWith('store-a');
  });

  it('maps a slug_taken RPC error to 409', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'slug_taken', code: 'P0001' },
    });
    const response = await POST(createRequest({ new_slug: 'takenslug' }));
    expect(response.status).toBe(409);
    expect(mockRevalidateMerchant).not.toHaveBeenCalled();
  });

  it('maps a forbidden RPC error to 403', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'forbidden' } });
    const response = await POST(createRequest({ new_slug: 'newslug' }));
    expect(response.status).toBe(403);
  });

  it('maps an unknown RPC error to 500', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const response = await POST(createRequest({ new_slug: 'newslug' }));
    expect(response.status).toBe(500);
  });

  it('rejects a reserved storefront route word (e.g. "wallet") with 400 before calling the RPC', async () => {
    const response = await POST(createRequest({ new_slug: 'wallet' }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.code).toBe('reserved_slug');
    // Rejected up-front — the RPC (and its cache busting) is never reached.
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockRevalidateMerchant).not.toHaveBeenCalled();
  });
});
