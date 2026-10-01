import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
  getEffectiveInventoryTrackingPolicy,
  getPublicSerializedVariantSummariesByProductId,
} from './public-serialized-variant-summary';

describe('getEffectiveInventoryTrackingPolicy', () => {
  it('returns variant policy directly if variant policy is not inherit/null', () => {
    expect(
      getEffectiveInventoryTrackingPolicy('off', 'serialized_strict')
    ).toBe('serialized_strict');
    expect(
      getEffectiveInventoryTrackingPolicy('serialized_strict', 'off')
    ).toBe('off');
    expect(
      getEffectiveInventoryTrackingPolicy(
        'serialized_strict',
        'serialized_then_unlimited'
      )
    ).toBe('serialized_then_unlimited');
  });
  it('inherits product policy if variant policy is inherit or null', () => {
    expect(
      getEffectiveInventoryTrackingPolicy('serialized_strict', 'inherit')
    ).toBe('serialized_strict');
    expect(
      getEffectiveInventoryTrackingPolicy('serialized_then_unlimited', null)
    ).toBe('serialized_then_unlimited');
  });

  it('defaults to off if neither product nor variant policy is serialized', () => {
    expect(getEffectiveInventoryTrackingPolicy('off', 'inherit')).toBe('off');
    expect(getEffectiveInventoryTrackingPolicy('off', null)).toBe('off');
    expect(getEffectiveInventoryTrackingPolicy('unexpected-policy')).toBe(
      'off'
    );
  });
});

describe('getPublicSerializedVariantSummariesByProductId', () => {
  const merchantId = 'merchant-123';

  function mockTypedQueryResult<TData>(result: {
    data: TData;
    error: unknown;
  }) {
    const query = {
      overrideTypes: vi.fn().mockResolvedValue(result),
      returns: vi.fn().mockResolvedValue(result),
      select: vi.fn(),
    };
    query.select.mockReturnValue(query);
    return query;
  }

  it('returns empty array if productIds is empty', async () => {
    const mockSupabase = {} as unknown as SupabaseClient;
    const result = await getPublicSerializedVariantSummariesByProductId(
      mockSupabase,
      merchantId,
      []
    );
    expect(result).toEqual([]);
  });

  it('correctly fetches and resolves simple product summaries, including nullable has_variants rows', async () => {
    const productIds = ['prod-1'];

    // Mock products query
    const productsData = [
      {
        id: 'prod-1',
        inventory_tracking_policy: 'serialized_strict',
        has_variants: null,
        status: 'active',
      },
    ];

    // Mock variants query (should have the hidden anchor variant)
    const variantsData = [
      {
        id: 'variant-anchor-1',
        product_id: 'prod-1',
        inventory_tracking_policy: 'inherit',
        is_inventory_anchor: true,
      },
    ];

    // Mock RPC counts response
    const countsData = [
      {
        product_id: 'prod-1',
        variant_id: null,
        public_available_units: 5,
      },
    ];

    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        return {
          select: vi.fn().mockImplementation((_columns: string) => {
            return {
              eq: vi.fn().mockImplementation(() => {
                return {
                  in: vi.fn().mockReturnValue(
                    mockTypedQueryResult({
                      data: table === 'products' ? productsData : variantsData,
                      error: null,
                    })
                  ),
                };
              }),
            };
          }),
        };
      }),
      rpc: vi.fn().mockReturnValue(
        mockTypedQueryResult({
          data: countsData,
          error: null,
        })
      ),
    } as unknown as SupabaseClient;

    const result = await getPublicSerializedVariantSummariesByProductId(
      mockSupabase,
      merchantId,
      productIds
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      productId: 'prod-1',
      variantId: null,
      publicAvailableUnits: 5,
      inventoryTrackingPolicy: 'serialized_strict',
    });
  });

  it('correctly fetches and resolves variant product summaries, excluding anchor variants', async () => {
    const productIds = ['prod-2'];

    // Mock products query
    const productsData = [
      {
        id: 'prod-2',
        inventory_tracking_policy: 'off',
        has_variants: true,
        status: 'active',
      },
    ];

    // Mock variants query (anchor + two visible variants)
    const variantsData = [
      {
        id: 'variant-anchor-2',
        product_id: 'prod-2',
        inventory_tracking_policy: 'inherit',
        is_inventory_anchor: true,
      },
      {
        id: 'variant-visible-2a',
        product_id: 'prod-2',
        inventory_tracking_policy: 'serialized_strict',
        is_inventory_anchor: false,
      },
      {
        id: 'variant-visible-2b',
        product_id: 'prod-2',
        inventory_tracking_policy: 'serialized_then_unlimited',
        is_inventory_anchor: false,
      },
    ];

    // Mock RPC counts response (only one variant has stock in DB)
    const countsData = [
      {
        product_id: 'prod-2',
        variant_id: 'variant-visible-2a',
        public_available_units: 3,
      },
    ];

    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        return {
          select: vi.fn().mockImplementation(() => {
            return {
              eq: vi.fn().mockImplementation(() => {
                return {
                  in: vi.fn().mockReturnValue(
                    mockTypedQueryResult({
                      data: table === 'products' ? productsData : variantsData,
                      error: null,
                    })
                  ),
                };
              }),
            };
          }),
        };
      }),
      rpc: vi.fn().mockReturnValue(
        mockTypedQueryResult({
          data: countsData,
          error: null,
        })
      ),
    } as unknown as SupabaseClient;

    const result = await getPublicSerializedVariantSummariesByProductId(
      mockSupabase,
      merchantId,
      productIds
    );

    expect(result).toHaveLength(2);
    // Sort results by variantId for deterministic checks
    const sortedResult = [...result].sort((a, b) =>
      (a.variantId || '').localeCompare(b.variantId || '')
    );

    expect(sortedResult[0]).toEqual({
      productId: 'prod-2',
      variantId: 'variant-visible-2a',
      publicAvailableUnits: 3,
      inventoryTrackingPolicy: 'serialized_strict',
    });

    expect(sortedResult[1]).toEqual({
      productId: 'prod-2',
      variantId: 'variant-visible-2b',
      publicAvailableUnits: 0,
      inventoryTrackingPolicy: 'serialized_then_unlimited',
    });
  });

  it('skips availability counts when active products have no serialized effective policy', async () => {
    const productIds = ['simple-off', 'variant-off'];
    const productsData = [
      {
        id: 'simple-off',
        inventory_tracking_policy: 'off',
        has_variants: false,
        status: 'active',
      },
      {
        id: 'variant-off',
        inventory_tracking_policy: 'off',
        has_variants: true,
        status: 'active',
      },
    ];
    const variantsData = [
      {
        id: 'anchor-simple-off',
        product_id: 'simple-off',
        inventory_tracking_policy: 'inherit',
        is_inventory_anchor: true,
      },
      {
        id: 'variant-visible-off',
        product_id: 'variant-off',
        inventory_tracking_policy: 'inherit',
        is_inventory_anchor: false,
      },
    ];
    const mockRpc = vi.fn();
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        return {
          select: vi.fn().mockImplementation(() => {
            return {
              eq: vi.fn().mockImplementation(() => {
                return {
                  in: vi.fn().mockReturnValue(
                    mockTypedQueryResult({
                      data: table === 'products' ? productsData : variantsData,
                      error: null,
                    })
                  ),
                };
              }),
            };
          }),
        };
      }),
      rpc: mockRpc,
    } as unknown as SupabaseClient;

    const result = await getPublicSerializedVariantSummariesByProductId(
      mockSupabase,
      merchantId,
      productIds
    );

    expect(result).toEqual([]);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('passes only products with serialized effective policies to the counts RPC', async () => {
    const productIds = ['simple-off', 'simple-serialized', 'variant-override'];
    const productsData = [
      {
        id: 'simple-off',
        inventory_tracking_policy: 'off',
        has_variants: false,
        status: 'active',
      },
      {
        id: 'simple-serialized',
        inventory_tracking_policy: 'serialized_strict',
        has_variants: false,
        status: 'active',
      },
      {
        id: 'variant-override',
        inventory_tracking_policy: 'off',
        has_variants: true,
        status: 'active',
      },
    ];
    const variantsData = [
      {
        id: 'anchor-simple-off',
        product_id: 'simple-off',
        inventory_tracking_policy: 'inherit',
        is_inventory_anchor: true,
      },
      {
        id: 'anchor-simple-serialized',
        product_id: 'simple-serialized',
        inventory_tracking_policy: 'inherit',
        is_inventory_anchor: true,
      },
      {
        id: 'variant-visible-override',
        product_id: 'variant-override',
        inventory_tracking_policy: 'serialized_then_unlimited',
        is_inventory_anchor: false,
      },
    ];
    const countsData = [
      {
        product_id: 'simple-serialized',
        variant_id: null,
        public_available_units: 7,
      },
      {
        product_id: 'variant-override',
        variant_id: 'variant-visible-override',
        public_available_units: 4,
      },
    ];
    const mockRpc = vi.fn().mockReturnValue(
      mockTypedQueryResult({
        data: countsData,
        error: null,
      })
    );
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        return {
          select: vi.fn().mockImplementation(() => {
            return {
              eq: vi.fn().mockImplementation(() => {
                return {
                  in: vi.fn().mockReturnValue(
                    mockTypedQueryResult({
                      data: table === 'products' ? productsData : variantsData,
                      error: null,
                    })
                  ),
                };
              }),
            };
          }),
        };
      }),
      rpc: mockRpc,
    } as unknown as SupabaseClient;

    const result = await getPublicSerializedVariantSummariesByProductId(
      mockSupabase,
      merchantId,
      productIds
    );

    expect(result).toEqual([
      {
        productId: 'simple-serialized',
        variantId: null,
        publicAvailableUnits: 7,
        inventoryTrackingPolicy: 'serialized_strict',
      },
      {
        productId: 'variant-override',
        variantId: 'variant-visible-override',
        publicAvailableUnits: 4,
        inventoryTrackingPolicy: 'serialized_then_unlimited',
      },
    ]);
    expect(mockRpc).toHaveBeenCalledWith(
      'get_public_serialized_variant_availability_counts',
      {
        p_merchant_id: merchantId,
        p_product_ids: ['simple-serialized', 'variant-override'],
        p_branch_id: null,
      }
    );
  });

  it('forwards branchId to the availability counts RPC', async () => {
    const productIds = ['branch-product'];
    const branchId = 'branch-123';
    const productsData = [
      {
        id: 'branch-product',
        inventory_tracking_policy: 'serialized_strict',
        has_variants: false,
        status: 'active',
      },
    ];
    const variantsData = [
      {
        id: 'branch-product-anchor',
        product_id: 'branch-product',
        inventory_tracking_policy: 'inherit',
        is_inventory_anchor: true,
      },
    ];
    const mockRpc = vi.fn().mockReturnValue(
      mockTypedQueryResult({
        data: [
          {
            product_id: 'branch-product',
            variant_id: null,
            public_available_units: 2,
          },
        ],
        error: null,
      })
    );
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        return {
          select: vi.fn().mockImplementation(() => {
            return {
              eq: vi.fn().mockImplementation(() => {
                return {
                  in: vi.fn().mockReturnValue(
                    mockTypedQueryResult({
                      data: table === 'products' ? productsData : variantsData,
                      error: null,
                    })
                  ),
                };
              }),
            };
          }),
        };
      }),
      rpc: mockRpc,
    } as unknown as SupabaseClient;

    const result = await getPublicSerializedVariantSummariesByProductId(
      mockSupabase,
      merchantId,
      productIds,
      branchId
    );

    expect(result).toEqual([
      {
        productId: 'branch-product',
        variantId: null,
        publicAvailableUnits: 2,
        inventoryTrackingPolicy: 'serialized_strict',
      },
    ]);
    expect(mockRpc).toHaveBeenCalledWith(
      'get_public_serialized_variant_availability_counts',
      {
        p_merchant_id: merchantId,
        p_product_ids: ['branch-product'],
        p_branch_id: branchId,
      }
    );
  });

  it('ignores malformed serialized availability count rows from the RPC while accepting omitted null variant IDs', async () => {
    const productIds = [
      'prod-valid',
      'prod-malformed',
      'prod-missing-variant-key',
    ];
    const productsData = [
      {
        id: 'prod-valid',
        inventory_tracking_policy: 'serialized_strict',
        has_variants: false,
        status: 'active',
      },
      {
        id: 'prod-malformed',
        inventory_tracking_policy: 'serialized_strict',
        has_variants: false,
        status: 'active',
      },
      {
        id: 'prod-missing-variant-key',
        inventory_tracking_policy: 'serialized_strict',
        has_variants: false,
        status: 'active',
      },
    ];
    const variantsData = [
      {
        id: 'anchor-valid',
        product_id: 'prod-valid',
        inventory_tracking_policy: 'inherit',
        is_inventory_anchor: true,
      },
      {
        id: 'anchor-malformed',
        product_id: 'prod-malformed',
        inventory_tracking_policy: 'inherit',
        is_inventory_anchor: true,
      },
      {
        id: 'anchor-missing-variant-key',
        product_id: 'prod-missing-variant-key',
        inventory_tracking_policy: 'inherit',
        is_inventory_anchor: true,
      },
    ];
    const malformedCountsData = [
      null,
      'not-an-object',
      {
        product_id: 123,
        variant_id: null,
        public_available_units: 4,
      },
      {
        product_id: 'prod-malformed',
        variant_id: 456,
        public_available_units: 4,
      },
      {
        product_id: 'prod-malformed',
        variant_id: null,
        public_available_units: '4',
      },
      {
        product_id: 'prod-missing-variant-key',
        public_available_units: 2,
      },
      {
        product_id: 'prod-valid',
        variant_id: null,
        public_available_units: 8,
      },
    ];
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        return {
          select: vi.fn().mockImplementation(() => {
            return {
              eq: vi.fn().mockImplementation(() => {
                return {
                  in: vi.fn().mockReturnValue(
                    mockTypedQueryResult({
                      data: table === 'products' ? productsData : variantsData,
                      error: null,
                    })
                  ),
                };
              }),
            };
          }),
        };
      }),
      rpc: vi.fn().mockReturnValue(
        mockTypedQueryResult({
          data: malformedCountsData,
          error: null,
        })
      ),
    } as unknown as SupabaseClient;

    const result = await getPublicSerializedVariantSummariesByProductId(
      mockSupabase,
      merchantId,
      productIds
    );

    expect(result).toEqual([
      {
        productId: 'prod-valid',
        variantId: null,
        publicAvailableUnits: 8,
        inventoryTrackingPolicy: 'serialized_strict',
      },
      {
        productId: 'prod-malformed',
        variantId: null,
        publicAvailableUnits: 0,
        inventoryTrackingPolicy: 'serialized_strict',
      },
      {
        productId: 'prod-missing-variant-key',
        variantId: null,
        publicAvailableUnits: 2,
        inventoryTrackingPolicy: 'serialized_strict',
      },
    ]);
  });

  it('filters inactive products within a mixed chunk before variant and count lookups', async () => {
    const productIds = ['active-serialized', 'inactive-serialized'];
    const productsData = [
      {
        id: 'active-serialized',
        inventory_tracking_policy: 'serialized_strict',
        has_variants: false,
        status: 'active',
      },
      {
        id: 'inactive-serialized',
        inventory_tracking_policy: 'serialized_strict',
        has_variants: false,
        status: 'inactive',
      },
    ];
    const variantsData = [
      {
        id: 'active-anchor',
        product_id: 'active-serialized',
        inventory_tracking_policy: 'inherit',
        is_inventory_anchor: true,
      },
    ];
    const mockProductsIn = vi.fn().mockReturnValue(
      mockTypedQueryResult({
        data: productsData,
        error: null,
      })
    );
    const mockVariantsIn = vi.fn().mockReturnValue(
      mockTypedQueryResult({
        data: variantsData,
        error: null,
      })
    );
    const mockRpc = vi.fn().mockReturnValue(
      mockTypedQueryResult({
        data: [
          {
            product_id: 'active-serialized',
            variant_id: null,
            public_available_units: 6,
          },
        ],
        error: null,
      })
    );
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        return {
          select: vi.fn().mockImplementation(() => {
            return {
              eq: vi.fn().mockImplementation(() => {
                return {
                  in: table === 'products' ? mockProductsIn : mockVariantsIn,
                };
              }),
            };
          }),
        };
      }),
      rpc: mockRpc,
    } as unknown as SupabaseClient;

    const result = await getPublicSerializedVariantSummariesByProductId(
      mockSupabase,
      merchantId,
      productIds
    );

    expect(mockProductsIn).toHaveBeenCalledWith('id', productIds);
    expect(mockVariantsIn).toHaveBeenCalledWith('product_id', [
      'active-serialized',
    ]);
    expect(mockRpc).toHaveBeenCalledWith(
      'get_public_serialized_variant_availability_counts',
      {
        p_merchant_id: merchantId,
        p_product_ids: ['active-serialized'],
        p_branch_id: null,
      }
    );
    expect(result).toEqual([
      {
        productId: 'active-serialized',
        variantId: null,
        publicAvailableUnits: 6,
        inventoryTrackingPolicy: 'serialized_strict',
      },
    ]);
  });

  it('chunks queries in batches of 200 items', async () => {
    // Generate 250 product IDs
    const productIds = Array.from({ length: 250 }, (_, i) => `prod-${i}`);

    const mockProductsSelect = vi.fn().mockImplementation(() => ({
      eq: vi.fn().mockImplementation(() => ({
        in: vi.fn().mockImplementation((_field: string, ids: string[]) => {
          return mockTypedQueryResult({
            data: ids.map((id) => ({
              id,
              inventory_tracking_policy: 'serialized_strict',
              has_variants: false,
              status: 'active',
            })),
            error: null,
          });
        }),
      })),
    }));

    const mockVariantsSelect = vi.fn().mockImplementation(() => ({
      eq: vi.fn().mockImplementation(() => ({
        in: vi.fn().mockImplementation((_field: string, ids: string[]) => {
          return mockTypedQueryResult({
            data: ids.map((id) => ({
              id: `anchor-${id}`,
              product_id: id,
              inventory_tracking_policy: 'inherit',
              is_inventory_anchor: true,
            })),
            error: null,
          });
        }),
      })),
    }));

    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        return {
          select:
            table === 'products' ? mockProductsSelect : mockVariantsSelect,
        };
      }),
      rpc: vi.fn().mockReturnValue(
        mockTypedQueryResult({
          data: [],
          error: null,
        })
      ),
    } as unknown as SupabaseClient;

    const result = await getPublicSerializedVariantSummariesByProductId(
      mockSupabase,
      merchantId,
      productIds
    );

    expect(result).toHaveLength(250);
    // Verify chunk calls
    expect(mockSupabase.from).toHaveBeenCalledTimes(4); // 2 chunk products + 2 chunk variants
    expect(mockSupabase.rpc).toHaveBeenCalledTimes(2); // 2 chunk rpcs
  });

  it('throws when the products query fails', async () => {
    const productsError = new Error('products query failed');
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi
              .fn()
              .mockReturnValue(
                mockTypedQueryResult({ data: null, error: productsError })
              ),
          }),
        }),
      }),
      rpc: vi.fn(),
    } as unknown as SupabaseClient;

    await expect(
      getPublicSerializedVariantSummariesByProductId(mockSupabase, merchantId, [
        'prod-1',
      ])
    ).rejects.toThrow(productsError);
  });

  it('throws when the variants query fails', async () => {
    const variantsError = new Error('variants query failed');
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue(
              mockTypedQueryResult({
                data:
                  table === 'products'
                    ? [
                        {
                          id: 'prod-1',
                          inventory_tracking_policy: 'serialized_strict',
                          has_variants: false,
                          status: 'active',
                        },
                      ]
                    : null,
                error: table === 'products' ? null : variantsError,
              })
            ),
          }),
        }),
      })),
      rpc: vi.fn(),
    } as unknown as SupabaseClient;

    await expect(
      getPublicSerializedVariantSummariesByProductId(mockSupabase, merchantId, [
        'prod-1',
      ])
    ).rejects.toThrow(variantsError);
  });

  it('throws when the availability counts RPC fails', async () => {
    const countsError = new Error('counts rpc failed');
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue(
              mockTypedQueryResult({
                data:
                  table === 'products'
                    ? [
                        {
                          id: 'prod-1',
                          inventory_tracking_policy: 'serialized_strict',
                          has_variants: false,
                          status: 'active',
                        },
                      ]
                    : [
                        {
                          id: 'variant-anchor-1',
                          product_id: 'prod-1',
                          inventory_tracking_policy: 'inherit',
                          is_inventory_anchor: true,
                        },
                      ],
                error: null,
              })
            ),
          }),
        }),
      })),
      rpc: vi
        .fn()
        .mockReturnValue(
          mockTypedQueryResult({ data: null, error: countsError })
        ),
    } as unknown as SupabaseClient;

    await expect(
      getPublicSerializedVariantSummariesByProductId(mockSupabase, merchantId, [
        'prod-1',
      ])
    ).rejects.toThrow(countsError);
  });
});
