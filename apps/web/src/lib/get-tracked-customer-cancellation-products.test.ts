import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { getTrackedCustomerCancellationProducts } from './get-tracked-customer-cancellation-products';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

function createSupabase({
  productResult,
  variantResult = { data: [], error: null },
}: {
  productResult: { data: unknown[] | null; error: unknown };
  variantResult?: { data: unknown[] | null; error: unknown };
}) {
  const supabase = {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          in: vi
            .fn()
            .mockResolvedValue(
              table === 'products' ? productResult : variantResult
            ),
        })),
      })),
    })),
  };
  return supabase as unknown as SupabaseClient;
}

describe('getTrackedCustomerCancellationProducts', () => {
  it('keeps managed products and serialized child variants but excludes unlimited products', async () => {
    // Arrange
    const supabase = createSupabase({
      productResult: {
        data: [
          { id: 'managed', slug: 'managed-phone', manage_stock: true },
          { id: 'unlimited', slug: 'unlimited-phone', manage_stock: false },
          { id: 'serialized', slug: 'serialized-phone', manage_stock: false },
        ],
        error: null,
      },
      variantResult: {
        data: [
          {
            product_id: 'serialized',
            inventory_tracking_policy: 'serialized_strict',
          },
        ],
        error: null,
      },
    });

    // Act
    const result = await getTrackedCustomerCancellationProducts({
      merchantId: 'merchant-1',
      productIds: ['managed', 'unlimited', 'serialized'],
      supabase,
    });

    // Assert
    expect(result).toEqual([
      { id: 'managed', slug: 'managed-phone' },
      { id: 'serialized', slug: 'serialized-phone' },
    ]);
  });

  it('fails open on a variant policy read and still returns managed parents', async () => {
    // Arrange
    const supabase = createSupabase({
      productResult: {
        data: [{ id: 'managed', slug: 'managed-phone', manage_stock: true }],
        error: null,
      },
      variantResult: {
        data: null,
        error: { message: 'variant query unavailable' },
      },
    });

    // Act
    const result = await getTrackedCustomerCancellationProducts({
      merchantId: 'merchant-1',
      productIds: ['managed'],
      supabase,
    });

    // Assert
    expect(result).toEqual([{ id: 'managed', slug: 'managed-phone' }]);
  });

  it('preserves every candidate when the product policy read fails after restocking', async () => {
    // Arrange
    const supabase = createSupabase({
      productResult: {
        data: null,
        error: { message: 'product query unavailable' },
      },
    });

    // Act
    const result = await getTrackedCustomerCancellationProducts({
      merchantId: 'merchant-1',
      productIds: ['managed', 'serialized', 'managed'],
      supabase,
    });

    // Assert
    expect(result).toEqual([
      { id: 'managed', slug: null },
      { id: 'serialized', slug: null },
    ]);
  });

  it('tracks simple serialized products whose order rows store no variant id', async () => {
    // Arrange: policies resolve by product_id (including the internal
    // anchor), never from stored variant ids.
    const inCalls: Array<{ column: string; values: unknown }> = [];
    const productResult = {
      data: [
        {
          id: 'simple-serialized',
          slug: 'simple-serialized-phone',
          manage_stock: false,
        },
      ],
      error: null,
    };
    const variantResult = {
      data: [
        {
          product_id: 'simple-serialized',
          inventory_tracking_policy: 'serialized_strict',
        },
      ],
      error: null,
    };
    const supabase = {
      from: vi.fn((table: string) => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            in: vi.fn((column: string, values: unknown) => {
              inCalls.push({ column, values });
              return Promise.resolve(
                table === 'products' ? productResult : variantResult
              );
            }),
          })),
        })),
      })),
    } as unknown as SupabaseClient;

    // Act
    const result = await getTrackedCustomerCancellationProducts({
      merchantId: 'merchant-1',
      productIds: ['simple-serialized'],
      supabase,
    });

    // Assert
    expect(inCalls).toContainEqual({
      column: 'product_id',
      values: ['simple-serialized'],
    });
    expect(result).toEqual([
      { id: 'simple-serialized', slug: 'simple-serialized-phone' },
    ]);
  });
});
