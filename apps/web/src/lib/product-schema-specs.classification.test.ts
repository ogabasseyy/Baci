import { describe, expect, it } from 'vitest';
import { shouldIncludeProductSchemaSpec } from './product-schema-specs';

describe('shouldIncludeProductSchemaSpec category classification', () => {
  it('fails closed for unsupported values without a category', () => {
    for (const candidate of [
      { key: 'battery_mah', value: 0 },
      { key: 'storage_gb', value: 0 },
      { key: 'has_5g', value: false },
    ]) {
      expect(
        shouldIncludeProductSchemaSpec(
          { category: undefined, categories: null },
          candidate
        )
      ).toBe(false);
    }
  });

  it('uses a joined category slug for camera-safe schema fields', () => {
    const product = {
      category: 'Smartphones',
      categories: { slug: 'action-cameras' },
    };

    expect(
      shouldIncludeProductSchemaSpec(product, { key: 'has_5g', value: false })
    ).toBe(false);
    expect(
      shouldIncludeProductSchemaSpec(product, {
        key: 'main_camera_mp',
        value: 24,
      })
    ).toBe(true);
  });

  it('uses a slug-only google-pixel category for mobile schema fields', () => {
    expect(
      shouldIncludeProductSchemaSpec(
        { category: 'google-pixel', categories: null },
        { key: 'has_5g', value: true }
      )
    ).toBe(true);
  });

  it('filters unsupported general values while retaining valid values', () => {
    const product = { category: 'Gaming', categories: null };

    expect(
      shouldIncludeProductSchemaSpec(product, { key: 'battery_mah', value: 0 })
    ).toBe(false);
    expect(
      shouldIncludeProductSchemaSpec(product, { key: 'storage_gb', value: 0 })
    ).toBe(false);
    expect(
      shouldIncludeProductSchemaSpec(product, { key: 'has_5g', value: false })
    ).toBe(false);
    expect(
      shouldIncludeProductSchemaSpec(product, {
        key: 'battery_mah',
        value: 5000,
      })
    ).toBe(true);
  });
});
