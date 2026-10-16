import { describe, expect, it, vi } from 'vitest';
import {
  resolveCanonicalVariantLines,
  toCanonicalLaneLine,
  toCheckoutLaneItem,
} from './ucp-cart-lane-items';

describe('UCP lane item mapping', () => {
  it('carries the full lane identity into the checkout calculator item', () => {
    expect(
      toCheckoutLaneItem({
        item: {
          condition: 'used',
          id: 'product-1',
          variant_attributes: { size: 'L' },
          variant_id: 'variant-1',
        },
        quantity: 2,
      })
    ).toEqual({
      condition: 'used',
      id: 'product-1',
      quantity: 2,
      variant_attributes: { size: 'L' },
      variant_id: 'variant-1',
    });
  });

  it('omits absent lane fields', () => {
    expect(
      toCheckoutLaneItem({ item: { id: 'product-1' }, quantity: 1 })
    ).toEqual({ id: 'product-1', quantity: 1 });
  });

  it('maps stored items back to canonical replacement lines', () => {
    expect(
      toCanonicalLaneLine({
        condition: 'used',
        id: 'product-1',
        quantity: 1,
        variant_attributes: { size: 'L' },
        variant_id: 'variant-1',
      })
    ).toEqual({
      item: {
        condition: 'used',
        options: { size: 'L' },
        productId: 'product-1',
        variantId: 'variant-1',
      },
      quantity: 1,
    });
  });
});

describe('resolveCanonicalVariantLines', () => {
  it('rewrites a variant UUID id into the resolved product pair', async () => {
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          in: vi.fn(() => ({
            eq: vi.fn(async () => ({
              data: [{ id: 'variant-1', product_id: 'product-1' }],
              error: null,
            })),
          })),
        })),
      })),
    };
    const lines = await resolveCanonicalVariantLines(client as never, 'm-1', [
      { item: { productId: 'variant-1' }, quantity: 1 },
    ]);
    expect(lines).toEqual([
      { item: { productId: 'product-1', variantId: 'variant-1' }, quantity: 1 },
    ]);
  });

  it('leaves lines untouched when the lookup fails', async () => {
    const client = {
      from: vi.fn(() => {
        throw new Error('no table');
      }),
    };
    const lines = [{ item: { productId: 'variant-1' }, quantity: 1 }];
    await expect(
      resolveCanonicalVariantLines(client as never, 'm-1', lines)
    ).resolves.toEqual(lines);
  });
});
