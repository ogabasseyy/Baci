import { describe, expect, it } from 'vitest';
import {
  createSectionCategories,
  createSectionProduct,
  mockSectionMerchant,
} from './ogabassey-home-section-test-fixtures';

describe('ogabassey-home-section-test-fixtures', () => {
  it('provides a published merchant with identity fields', () => {
    expect(mockSectionMerchant.is_published).toBe(true);
    expect(mockSectionMerchant.business_name).not.toBe('');
    expect(mockSectionMerchant.slug).toBe('ogabassey');
  });

  it('builds products with overridable defaults', () => {
    expect(createSectionProduct().slug).toBe('iphone-17-pro-max');
    expect(
      createSectionProduct({ slug: 'tecno-spark-40-pro' }).slug
    ).toBe('tecno-spark-40-pro');
  });

  it('builds categories with slugs', () => {
    const categories = createSectionCategories();
    expect(categories.length).toBeGreaterThan(0);
    for (const category of categories) {
      expect(category.slug).not.toBe('');
    }
  });
});
