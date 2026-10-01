import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { getPublicSerializedVariantSummariesByProductId } from './public-serialized-variant-summary';

function queryResult(data: unknown, error: unknown) {
  const retry = vi.fn().mockResolvedValue({ data, error });
  const query = {
    overrideTypes: vi.fn(),
    retry,
  };
  query.overrideTypes.mockReturnValue(query);
  return query;
}

describe('getPublicSerializedVariantSummariesByProductId timeout retry', () => {
  it('disables SDK retries before making its one explicit timeout retry', async () => {
    const timeoutError = {
      message: 'TimeoutError: The operation was aborted due to timeout',
    };
    const firstRpcQuery = queryResult(null, timeoutError);
    const secondRpcQuery = queryResult(
      [
        {
          product_id: 'product-1',
          variant_id: null,
          public_available_units: 3,
        },
      ],
      null
    );
    const queryFor = (data: unknown) => {
      const query = {
        eq: vi.fn(),
        in: vi.fn(),
        returns: vi.fn().mockResolvedValue({ data, error: null }),
        select: vi.fn(),
      };
      query.select.mockReturnValue(query);
      query.eq.mockReturnValue(query);
      query.in.mockReturnValue(query);
      return query;
    };
    const mockSupabase = {
      from: vi.fn((table: string) =>
        queryFor(
          table === 'products'
            ? [
                {
                  id: 'product-1',
                  inventory_tracking_policy: 'serialized_strict',
                  has_variants: false,
                  status: 'active',
                },
              ]
            : [
                {
                  id: 'anchor-1',
                  product_id: 'product-1',
                  inventory_tracking_policy: 'inherit',
                  is_inventory_anchor: true,
                },
              ]
        )
      ),
      rpc: vi
        .fn()
        .mockReturnValueOnce(firstRpcQuery)
        .mockReturnValueOnce(secondRpcQuery),
    } as unknown as SupabaseClient;

    await expect(
      getPublicSerializedVariantSummariesByProductId(
        mockSupabase,
        'merchant-1',
        ['product-1']
      )
    ).resolves.toEqual([
      {
        productId: 'product-1',
        variantId: null,
        publicAvailableUnits: 3,
        inventoryTrackingPolicy: 'serialized_strict',
      },
    ]);

    expect(firstRpcQuery.retry).toHaveBeenCalledWith(false);
    expect(secondRpcQuery.retry).toHaveBeenCalledWith(false);
    expect(mockSupabase.rpc).toHaveBeenCalledTimes(2);
  });
});
