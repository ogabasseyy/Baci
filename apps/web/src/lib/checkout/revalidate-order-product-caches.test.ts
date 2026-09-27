import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  revalidateProductSlugs,
  revalidateProducts,
} from '@/lib/cache-revalidation';
import { logger } from '@/lib/logger';
import { revalidateOrderProductCaches } from './revalidate-order-product-caches';

vi.mock('@/lib/cache-revalidation', () => ({
  revalidateProductSlugs: vi.fn(),
  revalidateProducts: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

const revalidateProductsMock = vi.mocked(revalidateProducts);
const revalidateProductSlugsMock = vi.mocked(revalidateProductSlugs);
const loggerErrorMock = vi.mocked(logger.error);

function mockSupabase(
  rows: Array<{ slug: string }> | null,
  error: unknown = null
) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          in: vi.fn(() => ({
            returns: vi.fn(async () => ({ data: rows, error })),
          })),
        })),
      })),
    })),
  };
}

describe('revalidateOrderProductCaches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it('busts merchant and per-slug PDP caches without throwing', async () => {
    const supabase = mockSupabase([{ slug: 'galaxy-s24' }]);
    await expect(
      revalidateOrderProductCaches({
        merchantId: 'merchant-1',
        orderId: 'order-1',
        productIds: ['product-1', null],
        supabase: supabase as any,
      })
    ).resolves.toBeUndefined();
    expect(revalidateProductsMock).toHaveBeenCalledWith('merchant-1');
    expect(revalidateProductSlugsMock).toHaveBeenCalledWith('merchant-1', [
      'galaxy-s24',
    ]);
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it('logs slug lookup failures without throwing', async () => {
    const supabase = mockSupabase(null, new Error('db down'));
    await expect(
      revalidateOrderProductCaches({
        merchantId: 'merchant-1',
        orderId: null,
        productIds: ['product-1'],
        supabase: supabase as any,
      })
    ).resolves.toBeUndefined();
    expect(revalidateProductsMock).toHaveBeenCalledWith('merchant-1');
    expect(revalidateProductSlugsMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledOnce();
  });

  it('skips the slug lookup when no product ids remain', async () => {
    const supabase = mockSupabase([{ slug: 'galaxy-s24' }]);
    await revalidateOrderProductCaches({
      merchantId: 'merchant-1',
      orderId: 'order-1',
      productIds: [null, undefined],
      supabase: supabase as any,
    });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(revalidateProductSlugsMock).not.toHaveBeenCalled();
  });
});
