import { describe, expect, it } from 'vitest';
import { classifyProductSchemaCategories } from './product-schema-spec-classification';

describe('classifyProductSchemaCategories', () => {
  it('prefers relation-backed category metadata over stale legacy category text', () => {
    expect(
      classifyProductSchemaCategories({
        categories: { slug: 'action-cameras' },
        category: 'Smartphones',
      })
    ).toMatchObject({
      categoryNames: ['action cameras'],
      hasCameraCategory: true,
      isMobileCategory: false,
      productFamily: 'camera',
    });
  });

  it('recognizes Google Pixel category slugs as mobile while excluding accessories', () => {
    expect(
      classifyProductSchemaCategories({ category: 'google-pixel' })
        .isMobileCategory
    ).toBe(true);
    expect(
      classifyProductSchemaCategories({ category: 'phone accessories' })
        .isMobileCategory
    ).toBe(false);
  });

  it('uses a stable relation slug with a localized category name', () => {
    expect(
      classifyProductSchemaCategories({
        categories: { name: '相机', slug: 'action-cameras' },
      })
    ).toMatchObject({ hasCameraCategory: true, productFamily: 'camera' });
  });

  it('includes top-level category_slug when relation name lacks slug', () => {
    expect(
      classifyProductSchemaCategories({
        categories: { name: '相机' },
        category_slug: 'action-cameras',
      })
    ).toMatchObject({
      categoryNames: expect.arrayContaining(['相机', 'action cameras']),
      hasCameraCategory: true,
      productFamily: 'camera',
    });
  });

  it('ignores stale top-level category_slug when joined relation metadata exists', () => {
    expect(
      classifyProductSchemaCategories({
        categories: { slug: 'phone-accessories' },
        category_slug: 'smartphones',
      })
    ).toMatchObject({
      categoryNames: ['phone accessories'],
      hasAccessoryCategory: true,
      isMobileCategory: false,
      productFamily: 'general',
    });
  });
});
