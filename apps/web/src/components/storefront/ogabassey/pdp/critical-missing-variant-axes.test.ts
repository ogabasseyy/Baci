import { describe, expect, it } from 'vitest';
import type { Product } from '@/lib/products';
import type { CriticalCartVariant } from './critical-cart-product';
import { resolveMissingCriticalVariantAxes } from './critical-missing-variant-axes';

type Variants = NonNullable<Product['variants']>;

function variants(rows: Array<Record<string, string>>): Variants {
  return rows.map((attributes, index) => ({
    id: `v-${index}`,
    product_id: 'product',
    merchant_id: 'merchant',
    condition: 'new' as const,
    inventory_tracking_policy: 'off',
    stock_quantity: 0,
    price_override: 1000,
    attributes,
  }));
}

describe('resolveMissingCriticalVariantAxes', () => {
  const consoles = variants([
    { storage: '825GB' },
    { storage: '1TB', region: 'Europe' },
    { storage: '1TB', region: 'Japan' },
  ]);

  it('asks for nothing when the selected version has no value on the group', () => {
    expect(
      resolveMissingCriticalVariantAxes({
        explicitSelectedAxes: [],
        hiddenRequiredVariantAxes: [],
        renderableVariantAxes: ['storage', 'region'],
        resolvedVariant: consoles[0],
        selectedAttributes: { storage: '825GB' },
        variants: consoles,
      })
    ).toEqual({
      missingHiddenRequiredVariantAxes: [],
      missingRenderableVariantAxes: [],
    });
  });

  it('asks for the visible group the selection can still vary on', () => {
    expect(
      resolveMissingCriticalVariantAxes({
        explicitSelectedAxes: [],
        hiddenRequiredVariantAxes: [],
        renderableVariantAxes: ['storage', 'region'],
        selectedAttributes: { storage: '1TB' },
        variants: consoles,
      }).missingRenderableVariantAxes
    ).toEqual(['region']);
  });

  it('keeps a hidden group missing until the shopper confirms it', () => {
    const input = {
      hiddenRequiredVariantAxes: ['region'],
      renderableVariantAxes: ['storage'],
      selectedAttributes: { storage: '1TB', region: 'Europe' },
      variants: consoles,
    };

    expect(
      resolveMissingCriticalVariantAxes({ ...input, explicitSelectedAxes: [] })
        .missingHiddenRequiredVariantAxes
    ).toEqual(['region']);
    expect(
      resolveMissingCriticalVariantAxes({
        ...input,
        explicitSelectedAxes: ['region'],
      }).missingHiddenRequiredVariantAxes
    ).toEqual([]);
  });

  it('accepts narrowed CriticalCartVariant entries without merchant or product ids', () => {
    const narrowedVariants: CriticalCartVariant[] = [
      {
        id: 'v-1',
        attributes: { storage: '128GB', color: 'Black' },
        condition: 'new',
        stock_quantity: 4,
      },
      {
        id: 'v-2',
        attributes: { storage: '256GB', color: 'Silver' },
        condition: 'used',
        stock_quantity: 2,
      },
    ];

    expect(
      resolveMissingCriticalVariantAxes({
        explicitSelectedAxes: [],
        hiddenRequiredVariantAxes: [],
        renderableVariantAxes: ['storage', 'color'],
        resolvedVariant: narrowedVariants[0],
        selectedAttributes: { storage: '128GB' },
        variants: narrowedVariants,
      })
    ).toEqual({
      missingHiddenRequiredVariantAxes: [],
      missingRenderableVariantAxes: ['color'],
    });
  });
});
