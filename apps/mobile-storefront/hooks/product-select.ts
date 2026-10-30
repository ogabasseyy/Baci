/**
 * Storefront reads intentionally exclude the protected product_variants relationship.
 * All roles hydrate variant-bearing rows through the bounded storefront RPC so an
 * authenticated session cannot trigger per-row staff/owner RLS checks here.
 */
const PRODUCT_SELECT_COLUMNS = `
  id, name, slug, description, price, compare_at_price, created_at,
  images, brand, condition, has_condition_offers, variant_model, available_conditions, average_rating, review_count, status, specifications,
  has_variants, variant_attributes, manage_stock, stock, stock_quantity,
`;

export const PRODUCT_SELECT = `
  ${PRODUCT_SELECT_COLUMNS}
  categories (id, name, slug)
`;

export const SANDBOX_PRODUCT_SELECT = `
  ${PRODUCT_SELECT_COLUMNS} view_count, inventory_tracking_policy,
  categories (id, name, slug)
`;

export const PRODUCT_DETAIL_SELECT = `
  id, name, slug, description, price, compare_at_price,
  images, brand, color, condition, average_rating, review_count, status, specifications,
  has_variants, variant_attributes, manage_stock, stock, stock_quantity,
  color_images, has_condition_offers, variant_model, available_conditions,
  offers:product_offers (
    id,
    condition,
    price,
    compare_at_price,
    stock_quantity,
    images,
    condition_notes,
    grade
  ),
  categories (id, name, slug)
`;
