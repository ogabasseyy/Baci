-- disable-transaction
DO $repair$
DECLARE
  invalid_index record;
BEGIN
  FOR invalid_index IN
    SELECT namespace.nspname AS schema_name, index_class.relname AS index_name
    FROM pg_catalog.pg_index AS index_state
    JOIN pg_catalog.pg_class AS index_class
      ON index_class.oid = index_state.indexrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = index_class.relnamespace
    WHERE namespace.nspname = 'public'
      AND NOT index_state.indisvalid
      AND index_class.relname = ANY (ARRAY[
        'idx_products_storefront_semantic_category',
        'idx_product_categories_category_product',
        'idx_categories_merchant_active_parent',
        'idx_blog_post_products_merchant_product_created'
      ])
  LOOP
    EXECUTE pg_catalog.format(
      'DROP INDEX IF EXISTS %I.%I',
      invalid_index.schema_name,
      invalid_index.index_name
    );
  END LOOP;
END $repair$;

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

DO $assert$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index
    WHERE indexrelid IN (
      'public.idx_products_storefront_semantic_category'::regclass,
      'public.idx_product_categories_category_product'::regclass,
      'public.idx_categories_merchant_active_parent'::regclass,
      'public.idx_blog_post_products_merchant_product_created'::regclass
    )
      AND (NOT indisvalid OR NOT indisready)
  ) THEN
    RAISE EXCEPTION 'semantic inventory index is invalid or not ready';
  END IF;
END $assert$;
