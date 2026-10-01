import { describe, expect, it } from 'vitest';
import { shouldIncludeProductSchemaSpec } from './product-schema-specs';

describe('shouldIncludeProductSchemaSpec measurements', () => {
  it('rejects zero and placeholder measurements for mobile and computer families', () => {
    for (const category of ['Smartphones', 'Laptops']) {
      for (const candidate of [
        { key: 'storage_gb', value: 0 },
        { key: 'screen_size_inches', value: 'N/A' },
        { key: 'battery_mah', value: '0mAh' },
        { key: 'display_resolution', value: 'Unknown' },
      ]) {
        expect(
          shouldIncludeProductSchemaSpec(
            { category, categories: null },
            candidate
          )
        ).toBe(false);
      }
    }
  });

  it('retains explicit negative mobile capabilities after placeholder filtering', () => {
    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'Smartphones', categories: null },
        { key: 'has_5g', value: false }
      )
    ).toBe(true);
  });

  it('rejects malformed string measurements before they reach PDP or schema copy', () => {
    for (const value of ['NaN', 'Infinity', '- 1GB']) {
      expect(
        shouldIncludeProductSchemaSpec(
          { category: 'Smartphones', categories: null },
          { key: 'ram_gb', value }
        )
      ).toBe(false);
    }
  });
});
