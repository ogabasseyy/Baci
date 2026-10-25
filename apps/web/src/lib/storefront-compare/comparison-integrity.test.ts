import { describe, expect, it } from 'vitest';
import { buildProductCompareCandidate } from './compare-eligibility';

const specs = { chipset: 'A', ram_gb: 8, storage_gb: 128 };
function pair(
  leftName: string,
  rightName: string,
  leftSpecs: Record<string, unknown> = specs,
  rightSpecs: Record<string, unknown> = {
    chipset: 'B',
    ram_gb: 12,
    storage_gb: 256,
  }
) {
  return buildProductCompareCandidate({
    categorySlug: 'accessories',
    leftProduct: {
      slug: 'left',
      name: leftName,
      category_slug: 'accessories',
      product_key_specs: leftSpecs,
    },
    rightProduct: {
      slug: 'right',
      name: rightName,
      category_slug: 'accessories',
      product_key_specs: rightSpecs,
    },
  });
}
describe('comparison integrity', () => {
  it('rejects complementary product types in a broad category', () => {
    expect(pair('Apple AirTag 4 Pack', 'Apple Pencil Pro').isIndexable).toBe(
      false
    );
    expect(
      pair('PlayStation VR 2 Sense Charger', 'PlayStation VR 2 VR').isIndexable
    ).toBe(false);
    expect(pair('JBL Go 4', 'Apple AirPods Max').isIndexable).toBe(false);
  });
  it('rejects matching part number aliases despite other differing data', () => {
    expect(
      pair(
        'HP Omen Transcend 14',
        'Omen Transcend Laptop 14',
        { ...specs, part_number: 'D0DE0EA' },
        { chipset: 'B', ram_gb: 12, storage_gb: 256, part_number: 'd0de0ea' }
      ).isIndexable
    ).toBe(false);
  });
  it('does not count identity metadata or missing facts as differentiators', () => {
    expect(
      pair(
        'Phone A',
        'Phone B',
        { canonical_model: 'A', ram_gb: null, source: 'one' },
        { canonical_model: 'B', ram_gb: 8, source: 'two' }
      ).differentiatingSpecCount
    ).toBe(0);
  });
});
