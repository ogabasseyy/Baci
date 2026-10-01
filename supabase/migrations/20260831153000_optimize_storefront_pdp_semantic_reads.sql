-- disable-transaction
-- Keep PDP semantic reads bounded and index-backed. The request path now
-- reads category inventory and guide links independently, so a slow optional
-- guide lookup cannot force a second category-wide inventory scan.
--
-- These are concurrent because products and guide links are live storefront
-- tables. The migration runner must execute this file outside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_storefront_semantic_category
  ON public.products (merchant_id, category_id, created_at DESC, id)
  WHERE status = 'active';

COMMENT ON INDEX public.idx_products_storefront_semantic_category IS
  'Supports bounded active storefront PDP semantic inventory by merchant/category and stable recency order.';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_categories_category_product
  ON public.product_categories (category_id, product_id);

COMMENT ON INDEX public.idx_product_categories_category_product IS
  'Supports category-scoped storefront semantic inventory joins without scanning all product memberships.';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_categories_merchant_active_parent
  ON public.categories (merchant_id, parent_id, id)
  WHERE is_active = true;

COMMENT ON INDEX public.idx_categories_merchant_active_parent IS
  'Supports storefront category plus direct-child scope resolution for semantic inventory.';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blog_post_products_merchant_product_created
  ON public.blog_post_products (merchant_id, product_id, created_at DESC, blog_post_id);

COMMENT ON INDEX public.idx_blog_post_products_merchant_product_created IS
  'Supports bounded newest-first published guide links for one storefront product.';
