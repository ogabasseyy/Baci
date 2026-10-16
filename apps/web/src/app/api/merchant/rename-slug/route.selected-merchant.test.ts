import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type ServerModule = typeof import('next/server');

const mockAuthenticateApiRequest = vi.fn();
const mockCheckCsrfProtection = vi.fn();
const mockGetMerchantForApiRequest = vi.fn();
const mockRpc = vi.fn();
const merchantAId = '11111111-1111-4111-8111-111111111111';
const merchantBId = '22222222-2222-4222-8222-222222222222';

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<ServerModule>();
  return { ...actual, after: vi.fn() };
});
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) =>
    mockAuthenticateApiRequest(...args),
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mockCheckCsrfProtection(...args),
}));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: (...args: unknown[]) =>
    mockGetMerchantForApiRequest(...args),
  toUserAccess: (context: {
    merchantId: string;
    staffAccess: Record<string, unknown>;
  }) => ({
    merchantId: context.merchantId,
    isOwner: true,
    isStaff: false,
    permissions: context.staffAccess.permissions ?? {},
    role: 'owner',
  }),
}));
vi.mock('@/lib/cache-revalidation', () => ({
  revalidateMerchant: vi.fn(),
  revalidateDomains: vi.fn(),
  revalidatePageConfig: vi.fn(),
  revalidateMerchantFeed: vi.fn(),
  revalidateMerchantSlugLookup: vi.fn(),
  revalidateStorefrontProductsSlugCache: vi.fn(),
  revalidateBlogFeed: vi.fn(),
}));
vi.mock('@/lib/domain-cache-simple', () => ({
  invalidateForwardDomainCacheForSlug: vi.fn(),
  invalidateReverseDomainCacheForSlug: vi.fn(),
}));
vi.mock('@/lib/slug-alias-cache', () => ({
  invalidateAliasCacheForSlug: vi.fn(),
}));
vi.mock('@/lib/edge-config-sync', () => ({
  triggerDomainEdgeConfigSync: vi.fn(),
}));
vi.mock('@/env', () => ({ getRootDomain: () => 'usebaci.com' }));

const { POST } = await import('./route');

function createRequest(merchantId: string): NextRequest {
  return new Request('http://localhost/api/merchant/rename-slug', {
    method: 'POST',
    body: JSON.stringify({ merchantId, new_slug: 'second-store' }),
    headers: { 'Content-Type': 'application/json' },
  }) as unknown as NextRequest;
}

describe('POST /api/merchant/rename-slug selected merchant boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticateApiRequest.mockResolvedValue({
      error: null,
      user: { id: 'user-1' },
      supabase: {
        rpc: mockRpc,
        from: () => ({
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: null }) }),
          }),
        }),
      },
    });
    mockCheckCsrfProtection.mockResolvedValue({ valid: true, response: null });
    mockRpc.mockResolvedValue({
      data: { slug: 'second-store', retired_slug: 'first-store' },
      error: null,
    });
  });

  it('authorizes and writes the explicitly selected merchant', async () => {
    mockGetMerchantForApiRequest.mockResolvedValue({
      merchantId: merchantBId,
      staffAccess: { permissions: {} },
    });
    const response = await POST(createRequest(merchantBId));

    expect(response.status).toBe(200);
    expect(mockGetMerchantForApiRequest).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      { requestedMerchantId: merchantBId }
    );
    expect(mockRpc).toHaveBeenCalledWith('rename_merchant_slug', {
      p_merchant_id: merchantBId,
      p_new_slug: 'second-store',
    });
  });

  it('refuses a resolver result that mismatches the selected merchant', async () => {
    mockGetMerchantForApiRequest.mockResolvedValue({
      merchantId: merchantAId,
      staffAccess: { permissions: {} },
    });
    const response = await POST(createRequest(merchantBId));

    expect(response.status).toBe(404);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
