import { beforeEach, describe, expect, it, vi } from 'vitest';

type InfiniteQueryConfig = {
  queryFn: (args: { pageParam?: unknown }) => Promise<unknown>;
  queryKey: readonly unknown[];
  initialPageParam?: unknown;
  getNextPageParam?: (lastPage: { nextCursor?: unknown }) => unknown;
};

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  infiniteQueryConfigs: [] as InfiniteQueryConfig[],
  queryPromises: [] as Promise<unknown>[],
}));

vi.mock('@tanstack/react-query', () => ({
  useInfiniteQuery: (config: InfiniteQueryConfig) => {
    mocks.infiniteQueryConfigs.push(config);
    mocks.queryPromises.push(config.queryFn({ pageParam: null }));
    return { data: null, isLoading: false };
  },
}));

vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({ merchant: { id: 'merchant-1' } }),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: mocks.rpc,
  },
}));

import { useVariantInventory } from './useVariantInventory';
import type { VariantInventoryFilters } from './useVariantInventory.types';

describe('useVariantInventory hooks', () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.infiniteQueryConfigs.length = 0;
    mocks.queryPromises.length = 0;
  });

  describe('useVariantInventory query', () => {
    it('accepts the database listing response and its camel-case cursor', async () => {
      mocks.rpc.mockResolvedValueOnce({
        data: {
          rows: [{ id: 'unit-from-database', status: 'available' }],
          nextCursor: {
            createdAt: '2026-06-15T00:00:00Z',
            id: 'unit-from-database',
          },
          hasMore: true,
        },
        error: null,
      });
      useVariantInventory({ productId: 'product-1' });
      await expect(mocks.queryPromises[0]).resolves.toEqual({
        units: [{ id: 'unit-from-database', status: 'available' }],
        nextCursor: {
          created_at: '2026-06-15T00:00:00Z',
          id: 'unit-from-database',
        },
        hasMore: true,
      });
    });
    it('calls list_variant_inventory_units with filters and handles page data', async () => {
      const mockResult = {
        rows: [
          {
            id: 'unit-1',
            identifier_value: '123456789012345',
            identifier_type: 'imei',
            status: 'available',
          },
        ],
        nextCursor: { createdAt: '2026-06-15T00:00:00Z', id: 'unit-1' },
        hasMore: true,
      };

      mocks.rpc.mockResolvedValueOnce({ data: mockResult, error: null });

      const filters = {
        productId: 'product-1',
        variantId: 'variant-1',
        status: 'available',
        branchScope: 'all',
        branchId: 'branch-1',
        limit: 10,
      } satisfies VariantInventoryFilters;

      useVariantInventory(filters);

      expect(mocks.infiniteQueryConfigs.length).toBe(1);
      expect(mocks.infiniteQueryConfigs[0].queryKey).toEqual([
        'variant-inventory',
        'merchant-1',
        filters,
      ]);

      const page = await mocks.queryPromises[0];
      expect(mocks.rpc).toHaveBeenCalledWith('list_variant_inventory_units', {
        p_merchant_id: 'merchant-1',
        p_product_id: 'product-1',
        p_variant_id: 'variant-1',
        p_status: 'available',
        p_branch_scope: 'all',
        p_branch_id: 'branch-1',
        p_limit: 10,
        p_cursor_created_at: null,
        p_cursor_id: null,
      });

      expect(page).toEqual({
        units: mockResult.rows,
        nextCursor: {
          created_at: mockResult.nextCursor.createdAt,
          id: 'unit-1',
        },
        hasMore: true,
      });

      // Test getNextPageParam
      const getNext = mocks.infiniteQueryConfigs[0].getNextPageParam;
      const cursor = {
        created_at: mockResult.nextCursor.createdAt,
        id: 'unit-1',
      };
      expect(getNext?.({ nextCursor: cursor })).toEqual(cursor);
    });

    it('throws when supabase rpc returns an invalid response shape', async () => {
      mocks.rpc.mockResolvedValueOnce({
        data: { hasMore: 'yes', nextCursor: null, rows: null },
        error: null,
      });

      useVariantInventory({ productId: 'product-1' });

      await expect(mocks.queryPromises[0]).rejects.toThrow(
        'Invalid variant inventory response'
      );
    });

    it('rejects pagination responses with missing cursor fields while more data exists', async () => {
      mocks.rpc.mockResolvedValueOnce({
        data: { hasMore: true, nextCursor: {}, rows: [] },
        error: null,
      });

      useVariantInventory({ productId: 'product-1' });

      await expect(mocks.queryPromises[0]).rejects.toThrow(
        'Invalid variant inventory response'
      );
    });

    it('rejects pagination responses with a cursor when no more data exists', async () => {
      mocks.rpc.mockResolvedValueOnce({
        data: {
          hasMore: false,
          nextCursor: { createdAt: '2026-06-15T00:00:00Z', id: 'unit-1' },
          rows: [],
        },
        error: null,
      });

      useVariantInventory({ productId: 'product-1' });

      await expect(mocks.queryPromises[0]).rejects.toThrow(
        'Invalid variant inventory response'
      );
    });

    it('throws error if supabase rpc returns error', async () => {
      mocks.rpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'Database failure' },
      });

      useVariantInventory({ productId: 'product-1' });

      await expect(mocks.queryPromises[0]).rejects.toThrow('Database failure');
    });
  });
});
