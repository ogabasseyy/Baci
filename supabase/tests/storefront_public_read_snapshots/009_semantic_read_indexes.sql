-- The PDP semantic inventory and product-guide queries must have the
-- merchant/category and merchant/product access paths used by the split read
-- model. This is a contract test, not a planner promise: EXPLAIN remains the
-- production verification step after the indexes are built.

DO $assertions$
BEGIN
  IF pg_catalog.to_regclass(
    'public.idx_products_storefront_semantic_category'
  ) IS NULL THEN
    RAISE EXCEPTION
      'bounded PDP semantic inventory lost its active merchant/category index';
  END IF;

  IF pg_catalog.to_regclass(
    'public.idx_product_categories_category_product'
  ) IS NULL THEN
    RAISE EXCEPTION
      'bounded PDP semantic inventory lost its category membership join index';
  END IF;

  IF pg_catalog.to_regclass(
    'public.idx_categories_merchant_active_parent'
  ) IS NULL
  THEN
    RAISE EXCEPTION
      'PDP category shell lost its merchant/direct-child index';
  END IF;

  IF pg_catalog.to_regclass(
    'public.idx_blog_post_products_merchant_product_created'
  ) IS NULL THEN
    RAISE EXCEPTION
      'product guide lookup lost its bounded merchant/product index';
  END IF;

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
    RAISE EXCEPTION 'semantic inventory indexes must be valid and ready';
  END IF;
END;
$assertions$;
