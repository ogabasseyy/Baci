import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  csrf: vi.fn(),
  purgeMutation: vi.fn(),
  revalidateProducts: vi.fn(),
}));

vi.mock('@/env', () => ({
  getSupabaseAnonKey: () => 'test-anon-key',
  getSupabaseServiceRoleKey: () => 'test-service-role-key',
  getSupabaseUrl: () => 'https://test.supabase.co',
  getRootDomain: () => 'localhost',
}));
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: vi.fn(), set: vi.fn() }),
}));
vi.mock('@/lib/api-auth', () => ({
  hasPermission: vi.fn(() => true),
}));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: vi.fn().mockResolvedValue({
    merchantId: 'merchant-1',
    merchantSlug: 'test-store',
    businessName: 'Test Store',
    staffAccess: { isOwner: true, isStaff: false, role: null, permissions: {} },
  }),
  toUserAccess: vi.fn(() => ({
    isOwner: true,
    isStaff: false,
    permissions: { full_access: { all: true } },
    role: 'owner',
  })),
}));
vi.mock('@/lib/cache-revalidation', () => ({
  revalidateProducts: mocks.revalidateProducts,
}));
vi.mock('@/lib/schedule-product-mutation-purge', () => ({
  scheduleProductMutationPurge: (...args: unknown[]) =>
    mocks.purgeMutation(...args),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-1' } },
        error: null,
      }),
    },
  })),
}));

import { DELETE } from './route';

const PRODUCT_ID = '00000000-0000-4000-8000-000000000001';

function makeRequest() {
  return new NextRequest(`http://localhost:3000/api/products/${PRODUCT_ID}`, {
    method: 'DELETE',
  });
}

function createSupabase() {
  const linkedBlogPostRows = Array.from({ length: 1000 }, (_, index) => ({
    blog_post_id: `post-${index}`,
  }));
  const limit = vi.fn((size: number) =>
    Promise.resolve({ data: linkedBlogPostRows.slice(0, size), error: null })
  );
  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-1' } },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      if (table === 'products') {
        const productQuery = {
          select: vi.fn(() => productQuery),
          eq: vi.fn(() => productQuery),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: PRODUCT_ID,
              slug: 'phone',
              name: 'Phone',
              category: 'Electronics',
              categories: null,
              product_categories: [],
            },
            error: null,
          }),
        };
        let deleteEqCount = 0;
        const deleteQuery: { eq: ReturnType<typeof vi.fn> } = {
          eq: vi.fn(() => {
            deleteEqCount += 1;
            return deleteEqCount >= 2
              ? Promise.resolve({ error: null })
              : deleteQuery;
          }),
        };
        return {
          ...productQuery,
          delete: vi.fn(() => deleteQuery),
        };
      }
      if (table === 'blog_post_products') {
        const blogQuery = {
          select: vi.fn(() => blogQuery),
          eq: vi.fn(() => blogQuery),
          limit,
        };
        return blogQuery;
      }
      throw new Error(`Unexpected table ${table}`);
    }),
  };
  return { limit, supabase };
}

describe('DELETE /api/products/[id] purge snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.csrf.mockResolvedValue({ valid: true, response: null });
  });

  it('bounds the pre-delete linked-post snapshot for high-cardinality products', async () => {
    // Arrange
    const { limit, supabase } = createSupabase();
    const createClient = (await import('@/lib/supabase/server')).createClient;
    vi.mocked(createClient).mockReturnValue(supabase as never);

    // Act
    const response = await DELETE(makeRequest(), {
      params: Promise.resolve({ id: PRODUCT_ID }),
    });

    // Assert
    expect(response.status).toBe(200);
    expect(limit).toHaveBeenCalledWith(257);
    expect(mocks.purgeMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        blogPostIds: expect.any(Array),
        purgeWholeStorefront: true,
      })
    );
    const purgeInput = mocks.purgeMutation.mock.calls[0]?.[0] as {
      blogPostIds?: unknown[];
    };
    expect(purgeInput.blogPostIds).toHaveLength(257);
  });

  it('purges the hostname if the pre-delete relationship snapshot fails', async () => {
    const { limit, supabase } = createSupabase();
    limit.mockRejectedValueOnce(new Error('temporary failure'));
    vi.mocked(
      (await import('@/lib/supabase/server')).createClient
    ).mockReturnValue(supabase as never);
    const response = await DELETE(makeRequest(), {
      params: Promise.resolve({ id: PRODUCT_ID }),
    });
    expect(response.status).toBe(200);
    expect(mocks.purgeMutation).toHaveBeenCalledWith(
      expect.objectContaining({ purgeWholeStorefront: true })
    );
  });
});
