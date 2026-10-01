-- Regression test: the PDP preflight must use the same active relation-backed
-- category as the streamed PDP when products.category_id is inactive.
--
-- Run after the ordered migration replay:
--   psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/storefront_pdp_preflight_relation_category.sql

BEGIN;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $fixtures$
DECLARE
  v_merchant_id constant uuid := '4d19ab10-0000-4000-8000-000000000021';
  v_product_id constant uuid := '4d19ab10-0000-4000-8000-000000000024';
  v_inactive_direct_id constant uuid := '4d19ab10-0000-4000-8000-000000000022';
  v_active_low_id constant uuid := '4d19ab10-0000-4000-8000-000000000023';
  v_active_high_id constant uuid := '4d19ab10-0000-4000-8000-000000000025';
BEGIN
  INSERT INTO public.merchants (
    id,
    email,
    business_name,
    slug,
    is_published
  ) VALUES (
    v_merchant_id,
    'pdp-preflight-relation-category@example.test',
    'PDP Preflight Relation Category Fixture',
    'pdp-preflight-relation-category-fixture',
    true
  );

  INSERT INTO public.categories (id, merchant_id, name, slug, is_active)
  VALUES
    (
      v_inactive_direct_id,
      v_merchant_id,
      'Retired Direct Category',
      'retired-direct-category',
      false
    ),
    (
      v_active_low_id,
      v_merchant_id,
      'Active Lowest Junction Category',
      'active-lowest-junction-category',
      true
    ),
    (
      v_active_high_id,
      v_merchant_id,
      'Active Higher Junction Category',
      'active-higher-junction-category',
      true
    );

  INSERT INTO public.products (
    id,
    merchant_id,
    category_id,
    name,
    price,
    slug,
    status
  ) VALUES (
    v_product_id,
    v_merchant_id,
    v_inactive_direct_id,
    'PDP Preflight Relation Category Fixture Product',
    100,
    'pdp-preflight-relation-category-fixture-product',
    'active'
  );

  INSERT INTO public.product_categories (product_id, category_id)
  VALUES
    (v_product_id, v_active_high_id),
    (v_product_id, v_active_low_id);
END;
$fixtures$;

SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'anon', true);

DO $assertions$
DECLARE
  v_result record;
BEGIN
  SELECT
    storefront_status,
    catalog_nonempty,
    present,
    match_kind,
    product_id,
    category_id,
    category_name,
    category_slug
  INTO v_result
  FROM public.get_storefront_pdp_preflight(
    'pdp-preflight-relation-category-fixture',
    'pdp-preflight-relation-category-fixture-product'
  );

  IF v_result.storefront_status IS DISTINCT FROM 'published'
    OR v_result.catalog_nonempty IS DISTINCT FROM true
    OR v_result.present IS DISTINCT FROM true
    OR v_result.match_kind IS DISTINCT FROM 'active'
    OR v_result.product_id IS DISTINCT FROM
      '4d19ab10-0000-4000-8000-000000000024'::uuid
    OR v_result.category_id IS DISTINCT FROM
      '4d19ab10-0000-4000-8000-000000000023'::uuid
    OR v_result.category_name IS DISTINCT FROM
      'Active Lowest Junction Category'
    OR v_result.category_slug IS DISTINCT FROM
      'active-lowest-junction-category'
  THEN
    RAISE EXCEPTION
      'preflight relation-category fallback mismatch: status=%, catalog_nonempty=%, present=%, match_kind=%, product_id=%, category_id=%, category_name=%, category_slug=%',
      v_result.storefront_status,
      v_result.catalog_nonempty,
      v_result.present,
      v_result.match_kind,
      v_result.product_id,
      v_result.category_id,
      v_result.category_name,
      v_result.category_slug;
  END IF;
END;
$assertions$;

ROLLBACK;
