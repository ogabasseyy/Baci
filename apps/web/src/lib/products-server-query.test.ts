import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRODUCT_WITH_VARIANTS_QUERY } from '@/lib/product-queries';
import { buildMerchantProductsQuery } from '@/lib/products-server-query';

function createQueryBuilderMock() {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    or: vi.fn(),
    range: vi.fn(),
  };

  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.or.mockReturnValue(builder);
  builder.range.mockReturnValue(builder);

  const supabase = {
    from: vi.fn().mockReturnValue(builder),
  };

  return { builder, supabase };
}

describe('buildMerchantProductsQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('targets merchant_products scoped to merchantId with exact count and database pagination', () => {
    const { builder, supabase } = createQueryBuilderMock();

    const result = buildMerchantProductsQuery(supabase as never, {
      merchantId: 'merchant-1',
      status: 'All',
      migration: 'All',
      search: '',
      paginateInDatabase: true,
      offset: 10,
      limit: 10,
    });

    expect(result).toBe(builder);
    expect(supabase.from).toHaveBeenCalledWith('merchant_products');
    expect(builder.select).toHaveBeenCalledWith(PRODUCT_WITH_VARIANTS_QUERY, {
      count: 'exact',
    });
    expect(builder.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(builder.order).toHaveBeenCalledWith('created_at', {
      ascending: false,
    });
    expect(builder.or).not.toHaveBeenCalled();
    expect(builder.range).toHaveBeenCalledWith(10, 19);
  });

  it('applies status, pending migration fallback, escaped search filters, and skips DB range when in-memory pagination is needed', () => {
    const { builder, supabase } = createQueryBuilderMock();

    buildMerchantProductsQuery(supabase as never, {
      merchantId: 'merchant-2',
      status: 'active',
      migration: 'pending',
      search: '100%_cotton',
      paginateInDatabase: false,
      offset: 0,
      limit: 20,
    });

    expect(builder.eq).toHaveBeenCalledWith('merchant_id', 'merchant-2');
    expect(builder.eq).toHaveBeenCalledWith('status', 'active');
    expect(builder.or).toHaveBeenNthCalledWith(
      1,
      'migration_status.eq.pending,migration_status.is.null'
    );
    expect(builder.or).toHaveBeenNthCalledWith(
      2,
      'name.ilike.%100\\%\\_cotton%,sku.ilike.%100\\%\\_cotton%,description.ilike.%100\\%\\_cotton%'
    );
    expect(builder.range).not.toHaveBeenCalled();
  });

  it('applies explicit non-pending migration filter when migration is migrated', () => {
    const { builder, supabase } = createQueryBuilderMock();

    buildMerchantProductsQuery(supabase as never, {
      merchantId: 'merchant-3',
      status: 'All',
      migration: 'migrated',
      search: '   ',
      paginateInDatabase: false,
      offset: 0,
      limit: 10,
    });

    expect(builder.eq).toHaveBeenCalledWith('migration_status', 'migrated');
    expect(builder.or).not.toHaveBeenCalled();
  });
});
