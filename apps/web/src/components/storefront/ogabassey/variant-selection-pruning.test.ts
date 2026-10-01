import { describe, expect, it } from 'vitest';
import type { NormalizedProductDetails } from '@/components/storefront/ogabassey/pages/product-details-page/product-normalization';
import { pruneSelectionsByVariantAvailability } from './variant-selection-pruning';

const variants = [
  {
    id: 'v1',
    attributes: { storage: '256GB', color: 'Black' },
    condition: 'new' as const,
    price_modifier: 0,
    stock_quantity: 5,
  },
  {
    id: 'v2',
    attributes: { storage: '512GB', color: 'Black' },
    condition: 'new' as const,
    price_modifier: 0,
    stock_quantity: 3,
  },
  {
    id: 'v3',
    attributes: { storage: '256GB', color: 'Silver' },
    condition: 'new' as const,
    price_modifier: 0,
    stock_quantity: 2,
  },
] as NonNullable<NormalizedProductDetails['variants']>;

describe('pruneSelectionsByVariantAvailability', () => {
  it('keeps the changed axis and drops unreachable sibling selections', () => {
    const next = { storage: '512GB', color: 'Silver' };
    const result = pruneSelectionsByVariantAvailability(
      next,
      'storage',
      variants
    );

    expect(result).toEqual({ storage: '512GB' });
  });

  it('returns selections unchanged when no variants exist', () => {
    const next = { storage: '256GB', color: 'Silver' };
    expect(
      pruneSelectionsByVariantAvailability(next, 'storage', undefined)
    ).toEqual(next);
  });

  it('preserves fallback-only axes when a variant-backed axis changes', () => {
    const fallbackOnlyVariants = [
      {
        id: 'v1',
        attributes: { storage: '1TB' },
        condition: 'new' as const,
        price_modifier: 0,
        stock_quantity: 5,
      },
    ] as NonNullable<NormalizedProductDetails['variants']>;

    const next = { storage: '1TB', platform: 'PS5' };
    const result = pruneSelectionsByVariantAvailability(
      next,
      'storage',
      fallbackOnlyVariants
    );

    expect(result).toEqual({ storage: '1TB', platform: 'PS5' });
  });

  it('ignores non-variant metadata when evaluating sibling reachability', () => {
    const next = {
      storage: '512GB',
      color: 'Silver',
      warranty: '12 months',
    };
    const result = pruneSelectionsByVariantAvailability(
      next,
      'storage',
      variants
    );

    expect(result).toEqual({ storage: '512GB', warranty: '12 months' });
  });

  it('drops incompatible storage when condition changes and condition lives on variant.condition', () => {
    const conditionVariants = [
      {
        id: 'v-new-128',
        attributes: { storage: '128GB' },
        condition: 'new' as const,
        price_modifier: 0,
        stock_quantity: 5,
      },
      {
        id: 'v-used-256',
        attributes: { storage: '256GB' },
        condition: 'used' as const,
        price_modifier: 0,
        stock_quantity: 3,
      },
    ] as NonNullable<NormalizedProductDetails['variants']>;

    const result = pruneSelectionsByVariantAvailability(
      { condition: 'used', storage: '128GB' },
      'condition',
      conditionVariants
    );

    expect(result).toEqual({ condition: 'used' });
  });
});
