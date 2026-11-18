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
    revalidateProductSlugsMock.mockReturnValue(true);
  });
  it('busts scoped listings and per-slug PDP caches without throwing when all slugs resolve', async () => {
    const supabase = mockSupabase([{ slug: 'galaxy-s24' }]);
    await expect(
      revalidateOrderProductCaches({
        merchantId: 'merchant-1',
        orderId: 'order-1',
        productIds: ['product-1', null],
        supabase: supabase as never,
      })
    ).resolves.toBeUndefined();
    expect(revalidateProductSlugsMock).toHaveBeenCalledWith('merchant-1', [
      'galaxy-s24',
    ]);
    expect(revalidateProductsMock).toHaveBeenCalledWith(
      'merchant-1',
      undefined,
      { omitMerchantWidePdpDetails: true }
    );
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it('falls back to full merchant-wide PDP invalidation when slug resolution is incomplete', async () => {
    const supabase = mockSupabase([{ slug: 'galaxy-s24' }]);
    await expect(
      revalidateOrderProductCaches({
        merchantId: 'merchant-1',
        orderId: 'order-1',
        productIds: ['product-1', 'product-2'],
        supabase: supabase as never,
      })
    ).resolves.toBeUndefined();
    expect(revalidateProductSlugsMock).toHaveBeenCalledWith('merchant-1', [
      'galaxy-s24',
    ]);
    expect(revalidateProductsMock).toHaveBeenCalledWith('merchant-1');
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it('falls back to full merchant-wide PDP invalidation when revalidateProductSlugs returns false', async () => {
    const supabase = mockSupabase([{ slug: 'galaxy-s24' }]);
    revalidateProductSlugsMock.mockReturnValueOnce(false);
    await expect(
      revalidateOrderProductCaches({
        merchantId: 'merchant-1',
        orderId: 'order-1',
        productIds: ['product-1'],
        supabase: supabase as never,
      })
    ).resolves.toBeUndefined();
    expect(revalidateProductSlugsMock).toHaveBeenCalledWith('merchant-1', [
      'galaxy-s24',
    ]);
    expect(revalidateProductsMock).toHaveBeenCalledWith('merchant-1');
  });

  it('logs slug lookup failures and falls back to full merchant-wide invalidation', async () => {
    const supabase = mockSupabase(null, new Error('db down'));
    await expect(
      revalidateOrderProductCaches({
        merchantId: 'merchant-1',
        orderId: null,
        productIds: ['product-1'],
        supabase: supabase as never,
      })
    ).resolves.toBeUndefined();
    expect(revalidateProductsMock).toHaveBeenCalledWith('merchant-1');
    expect(revalidateProductSlugsMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledOnce();
  });

  it('falls back to full invalidation when slug lookup throws', async () => {
    const supabase = {
      from: vi.fn(() => {
        throw new Error('network error');
      }),
    };
    await expect(
      revalidateOrderProductCaches({
        merchantId: 'merchant-1',
        orderId: 'order-1',
        productIds: ['product-1'],
        supabase: supabase as never,
      })
    ).resolves.toBeUndefined();
    expect(revalidateProductsMock).toHaveBeenCalledWith('merchant-1');
    expect(loggerErrorMock).toHaveBeenCalledOnce();
  });

  it('never throws even when fallback revalidateProducts throws in catch', async () => {
    const supabase = {
      from: vi.fn(() => {
        throw new Error('network error');
      }),
    };
    revalidateProductsMock.mockImplementationOnce(() => {
      throw new Error('cache unavailable');
    });
    await expect(
      revalidateOrderProductCaches({
        merchantId: 'merchant-1',
        orderId: 'order-1',
        productIds: ['product-1'],
        supabase: supabase as never,
      })
    ).resolves.toBeUndefined();
    expect(loggerErrorMock).toHaveBeenCalledOnce();
  });

  it('skips the slug lookup and falls back to full invalidation when no product ids remain', async () => {
    const supabase = mockSupabase([{ slug: 'galaxy-s24' }]);
    await revalidateOrderProductCaches({
      merchantId: 'merchant-1',
      orderId: 'order-1',
      productIds: [null, undefined, '  '],
      supabase: supabase as never,
    });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(revalidateProductSlugsMock).not.toHaveBeenCalled();
    expect(revalidateProductsMock).toHaveBeenCalledWith('merchant-1');
  });
});
