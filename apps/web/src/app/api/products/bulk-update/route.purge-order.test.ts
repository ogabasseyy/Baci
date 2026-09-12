import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  expire: vi.fn(),
  merchant: vi.fn(),
  process: vi.fn(),
  revalidateProducts: vi.fn(),
  revalidateSlugs: vi.fn(),
  schedule: vi.fn(),
  scheduleAfter: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({
  hasPermission: vi.fn(() => true),
}));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('@/lib/currency', () => ({
  getCurrencyConfig: vi.fn(() => ({ code: 'NGN' })),
}));
vi.mock('@/lib/expire-product-blog-cache', () => ({
  expireProductBlogCache: mocks.expire,
}));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: mocks.merchant,
  toUserAccess: vi.fn(() => ({
    isOwner: true,
    isStaff: false,
    permissions: { full_access: { all: true } },
    role: 'owner',
  })),
}));
vi.mock('@/lib/cache-revalidation', () => ({
  revalidateProducts: mocks.revalidateProducts,
  revalidateProductSlugs: mocks.revalidateSlugs,
}));
vi.mock('@/lib/schedule-product-blog-purge-after-response', () => ({
  scheduleProductBlogPurgeAfterResponse: mocks.scheduleAfter,
}));
vi.mock('@/lib/storefront-product-purge', () => ({
  scheduleStorefrontProductPurge: mocks.schedule,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => mocks.auth()),
}));
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: vi.fn(), set: vi.fn() }),
}));
vi.mock('./bulk-update-change-processing', () => ({
  processBulkUpdateChanges: (...args: unknown[]) => mocks.process(...args),
}));

import { POST } from './route';

const MERCHANT_ID = 'merchant-123';
const MERCHANT_SLUG = 'ogabassey';

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost:3000/api/products/bulk-update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeSupabase() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      }),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              business_name: 'Test Store',
              country: 'NG',
              payout_currency: 'NGN',
            },
            error: null,
          }),
        })),
      })),
    })),
  };
}

describe('bulk-update purge ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.csrf.mockResolvedValue({ valid: true, response: null });
    mocks.merchant.mockResolvedValue({
      merchantId: MERCHANT_ID,
      merchantSlug: MERCHANT_SLUG,
      businessName: 'Test Store',
      staffAccess: {
        isOwner: true,
        isStaff: false,
        role: null,
        permissions: {},
      },
    });
    mocks.auth.mockReturnValue(makeSupabase());
    mocks.process.mockImplementation(
      async ({
        onPurgeEntries,
        onResolvedProductIds,
      }: {
        onPurgeEntries?: (entries: Record<string, string | null>[]) => void;
        onResolvedProductIds?: (ids: string[]) => void;
      }) => {
        onResolvedProductIds?.(['123e4567-e89b-42d3-a456-426614174000']);
        onPurgeEntries?.([
          { slug: 'updated-product', categorySegment: 'electronics' },
        ]);
        return { updated: 1, created: 0, removed: 0, errors: [] };
      }
    );
  });

  it('expires related-blog data before scheduling the public purge', async () => {
    // Arrange
    const request = makeRequest({
      changes: [
        {
          type: 'update',
          productId: 'product-1',
          newPrice: 150,
          details: {
            name: 'Updated Product',
            price: 150,
            category: 'Electronics',
          },
        },
      ],
    });

    // Act
    const response = await POST(request);

    // Assert
    expect(response.status).toBe(200);
    expect(mocks.expire).toHaveBeenCalledWith(MERCHANT_ID);
    expect(mocks.schedule).toHaveBeenCalledWith(MERCHANT_SLUG, [
      { slug: 'updated-product', categorySegment: 'electronics' },
    ]);
    expect(mocks.expire.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.schedule.mock.invocationCallOrder[0]
    );
    expect(mocks.scheduleAfter).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: MERCHANT_ID,
        productIds: ['123e4567-e89b-42d3-a456-426614174000'],
        skipProductPurge: true,
      })
    );
  });

  it('passes a SKU-resolved UUID to linked-article purge enrichment', async () => {
    // Arrange
    const request = makeRequest({
      changes: [
        {
          type: 'update',
          details: {
            sku: 'SKU-PHONE',
            name: 'SKU phone',
            price: 150,
            category: 'Smartphones',
          },
          newPrice: 150,
        },
      ],
    });

    // Act
    const response = await POST(request);

    // Assert
    expect(response.status).toBe(200);
    expect(mocks.scheduleAfter).toHaveBeenCalledWith(
      expect.objectContaining({
        productIds: ['123e4567-e89b-42d3-a456-426614174000'],
      })
    );
  });
});
