import { describe, expect, it } from 'vitest';
import type { Product } from '@/lib/products';
import { getInapplicableCriticalVariantAxes } from './critical-applicable-variant-axes';

type Variants = NonNullable<Product['variants']>;

function variants(rows: Array<Record<string, string>>): Variants {
  return rows.map((attributes, index) => ({
    id: `v-${index}`,
    product_id: 'product',
    merchant_id: 'merchant',
    condition: 'new' as const,
    attributes,
  }));
}

describe('getInapplicableCriticalVariantAxes', () => {
  it('drops an option group no version matching the selection carries', () => {
    expect(
      getInapplicableCriticalVariantAxes(
        variants([
          { storage: '825GB' },
          { storage: '1TB', region: 'Europe' },
        ]),
        { storage: '825GB' },
        ['region']
      )
    ).toEqual(['region']);
  });

  it('keeps an option group a matching version does carry', () => {
    expect(
      getInapplicableCriticalVariantAxes(
        variants([
          { storage: '256GB', color: 'Black' },
          { storage: '256GB', color: 'Silver' },
        ]),
        { storage: '256GB' },
        ['color']
      )
    ).toEqual([]);
  });

  it('treats a blank on a constraining option as no value, not a wildcard', () => {
    // The colour-only version has no storage, so it is not a 256GB
    // version and must not keep colour required for the 256GB one.
    expect(
      getInapplicableCriticalVariantAxes(
        variants([{ storage: '256GB' }, { color: 'Black' }]),
        { storage: '256GB' },
        ['color']
      )
    ).toEqual(['color']);
  });

  it('counts blanks as compatible only when nothing matches exactly', () => {
    // The selection carries a platform no version records.
    expect(
      getInapplicableCriticalVariantAxes(
        variants([{ color: 'Black' }, { color: 'White' }]),
        { platform: 'PS5' },
        ['color']
      )
    ).toEqual([]);
  });

  it('never requires an option the resolved version leaves blank', () => {
    const rows = variants([
      { storage: '256GB', ram: '8GB' },
      { storage: '256GB' },
    ]);
    expect(
      getInapplicableCriticalVariantAxes(
        rows,
        { storage: '256GB' },
        ['ram'],
        rows[1]
      )
    ).toEqual(['ram']);
  });
});
