import { PRODUCT_KEY_SPECS_RELATION_SELECT } from '@/lib/product-key-specs-select';

const CATEGORY_PAGE_PRODUCT_BASE_SELECT = `
          id,
          name,
          slug,
          description,
          price,
          compare_at_price,
          created_at,
          images,
          category,
          brand,
          condition,
          stock,
          stock_quantity,
          manage_stock,
          ${PRODUCT_KEY_SPECS_RELATION_SELECT}
        `;

/**
 * Builds the explicit column projection for category-page product rows.
 * `created_at` feeds the category launch carousel's newest-arrival pin;
 * category-scoped pages inner-join `product_categories` so only products in
 * the category are returned.
 */
export function getCategoryPageProductSelect(isCategoryScoped: boolean) {
  const productCategoriesSelect = isCategoryScoped
    ? 'product_categories!inner(categories(name, slug))'
    : 'product_categories(categories(name, slug))';

  return `${CATEGORY_PAGE_PRODUCT_BASE_SELECT}, ${productCategoriesSelect}`;
}
