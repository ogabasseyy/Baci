import { describe, expect, it } from 'vitest';
import type { NormalizedProductDetails } from '@/components/storefront/ogabassey/pages/product-details-page/product-normalization';
import { recoverHiddenSelectionsFromUniqueVariant } from './recover-hidden-variant-selections';

const variants = [
  {
    id: 'v-black-128',
    attributes: { color: 'Black', storage: '128GB' },
    condition: 'new' as const,
    price_modifier: 0,
    stock_quantity: 4,
  },
  {
    id: 'v-blue-256',
    attributes: { color: 'Blue', storage: '256GB' },
    condition: 'new' as const,
    price_modifier: 0,
    stock_quantity: 6,
  },
] as NonNullable<NormalizedProductDetails['variants']>;

describe('recoverHiddenSelectionsFromUniqueVariant', () => {
  it('fills a pruned hidden axis from the uniquely matching SKU', () => {
    expect(
      recoverHiddenSelectionsFromUniqueVariant(
        { storage: '256GB' },
        ['color'],
        variants
      )
    ).toEqual({ color: 'Blue', storage: '256GB' });
  });

  it('leaves selections unchanged when more than one SKU still matches', () => {
    const ambiguous = [
      ...variants,
      {
        id: 'v-red-256',
        attributes: { color: 'Red', storage: '256GB' },
        condition: 'new' as const,
        price_modifier: 0,
        stock_quantity: 2,
      },
    ] as NonNullable<NormalizedProductDetails['variants']>;

    expect(
      recoverHiddenSelectionsFromUniqueVariant(
        { storage: '256GB' },
        ['color'],
        ambiguous
      )
    ).toEqual({ storage: '256GB' });
  });

  it('returns selections unchanged when hidden axes are already present', () => {
    expect(
      recoverHiddenSelectionsFromUniqueVariant(
        { color: 'Black', storage: '128GB' },
        ['color'],
        variants
      )
    ).toEqual({ color: 'Black', storage: '128GB' });
  });
});
