import { describe, expect, it } from 'vitest';
import { resolveStorefrontProductPurgeCategorySlug } from './storefront-product-purge-category';

describe('resolveStorefrontProductPurgeCategorySlug', () => {
  it('keeps an active direct category ahead of junction categories', () => {
    const input = {
      categories: { is_active: true, slug: 'direct-category' },
      productCategories: [
        {
          category_id: 'category-a',
          categories: { slug: 'junction-category' },
        },
      ],
    };

    const result = resolveStorefrontProductPurgeCategorySlug(input);

    expect(result).toBe('direct-category');
  });

  it('skips an inactive direct category and chooses the lowest active junction id', () => {
    const input = {
      categories: { is_active: false, slug: 'retired-category' },
      productCategories: [
        {
          category_id: 'category-0',
          categories: {
            is_active: false,
            slug: 'inactive-category',
          },
        },
        {
          category_id: 'category-z',
          categories: { is_active: true, slug: 'z-category' },
        },
        {
          category_id: 'category-a',
          categories: { is_active: true, slug: 'a-category' },
        },
      ],
    };

    const result = resolveStorefrontProductPurgeCategorySlug(input);

    expect(result).toBe('a-category');
  });

  it('preserves input order only when junction rows have no category id', () => {
    const input = {
      productCategories: [
        { categories: { slug: 'first-category' } },
        { categories: { slug: 'second-category' } },
      ],
    };

    const result = resolveStorefrontProductPurgeCategorySlug(input);

    expect(result).toBe('first-category');
  });
});
