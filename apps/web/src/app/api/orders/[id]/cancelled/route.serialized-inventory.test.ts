import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  csrf: vi.fn(),
  getMerchantId: vi.fn(),
  revalidateDashboard: vi.fn(),
  revalidateProductSlugs: vi.fn(),
  revalidateProducts: vi.fn(),
  schedule: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: mocks.authenticate,
  getMerchantIdForApiUser: mocks.getMerchantId,
}));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('@/lib/product-cache-revalidation', () => ({
  productCacheRevalidation: {
    revalidateDashboard: mocks.revalidateDashboard,
    revalidateProductSlugs: mocks.revalidateProductSlugs,
    revalidateProducts: mocks.revalidateProducts,
  },
}));
vi.mock('@/lib/schedule-order-product-blog-purge-after-response', () => ({
  scheduleOrderProductBlogPurgeAfterResponse: mocks.schedule,
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { POST } from './route';

function request(): NextRequest {
  return {
    json: vi.fn().mockResolvedValue({ confirm_cancellation: true }),
  } as unknown as NextRequest;
}

function createSupabase({
  product,
  orderItem = { product_id: 'product-1' },
  variantRows = [],
}: {
  product: Record<string, unknown>;
  orderItem?: Record<string, unknown>;
  variantRows?: Record<string, unknown>[];
}) {
  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'order_items') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: [orderItem], error: null }),
          })),
        };
      }
      if (table === 'product_variants') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn().mockResolvedValue({ data: variantRows, error: null }),
            })),
          })),
        };
      }
      if (table === 'products') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn().mockResolvedValue({ data: [product], error: null }),
            })),
          })),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }),
    rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
  };
  return supabase;
}

function configure(supabase: unknown) {
  mocks.authenticate.mockResolvedValue({
    error: null,
    supabase,
    user: { id: 'user-1' },
  });
  mocks.getMerchantId.mockResolvedValue('merchant-1');
}

describe('merchant cancellation serialized inventory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.csrf.mockResolvedValue({ valid: true, response: null });
    mocks.getMerchantId.mockResolvedValue('merchant-1');
  });

  it('purges a serialized product when legacy stock management is off', async () => {
    const supabase = createSupabase({
      product: {
        id: 'product-1',
        manage_stock: false,
        inventory_tracking_policy: 'serialized_strict',
        slug: 'serialized-phone',
      },
    });
    configure(supabase);

    const response = await POST(request(), {
      params: Promise.resolve({ id: 'order-1' }),
    });

    expect(response.status).toBe(202);
    expect(mocks.revalidateProductSlugs).toHaveBeenCalledWith('merchant-1', [
      'serialized-phone',
    ]);
    expect(mocks.schedule).toHaveBeenCalledWith(
      expect.objectContaining({ productIds: ['product-1'], supabase })
    );
  });

  it('purges a serialized child variant under an unmanaged parent', async () => {
    const supabase = createSupabase({
      product: {
        id: 'product-1',
        manage_stock: false,
        inventory_tracking_policy: 'off',
        slug: 'serialized-child-phone',
      },
      orderItem: { product_id: 'product-1', variant_id: 'variant-1' },
      variantRows: [
        {
          id: 'variant-1',
          product_id: 'product-1',
          inventory_tracking_policy: 'serialized_strict',
        },
      ],
    });
    configure(supabase);

    const response = await POST(request(), {
      params: Promise.resolve({ id: 'order-1' }),
    });

    expect(response.status).toBe(202);
    expect(mocks.revalidateProductSlugs).toHaveBeenCalledWith('merchant-1', [
      'serialized-child-phone',
    ]);
    expect(mocks.schedule).toHaveBeenCalledWith(
      expect.objectContaining({ productIds: ['product-1'], supabase })
    );
  });
});
