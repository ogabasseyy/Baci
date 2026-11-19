-- ================================================================
-- REGRESSION TEST: blog guide metadata v2, subject mappings,
-- verification privilege guard, staleness triggers, and candidate RPC
-- ================================================================

BEGIN;

RESET ROLE;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $setup$
DECLARE
  v_owner uuid := '9b010000-0000-4000-8000-000000000001';
  v_merchant uuid := '9b010000-0000-4000-8000-000000000002';
  v_cat_phones uuid := '9b010000-0000-4000-8000-000000000003';
  v_cat_laptops uuid := '9b010000-0000-4000-8000-000000000004';
  v_prod_primary uuid := '9b010000-0000-4000-8000-000000000005';
  v_prod_peer uuid := '9b010000-0000-4000-8000-000000000006';
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  ) VALUES (
    v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'blog-guide-v2-owner@example.com', 'test', now(), now(), now(), '{}'::jsonb, '{}'::jsonb
  );

  INSERT INTO public.merchants (id, user_id, email, business_name, slug, is_published)
  VALUES (v_merchant, v_owner, 'blog-guide-v2@example.com', 'Blog Guide V2 Store', 'blog-guide-v2-store', true);

  INSERT INTO public.merchant_feature_settings (merchant_id, blog_enabled)
  VALUES (v_merchant, true)
  ON CONFLICT (merchant_id) DO UPDATE SET blog_enabled = EXCLUDED.blog_enabled;

  INSERT INTO public.categories (id, merchant_id, name, slug, is_active) VALUES
    (v_cat_phones, v_merchant, 'Smartphones', 'smartphones', true),
    (v_cat_laptops, v_merchant, 'Laptops', 'laptops', true);

  INSERT INTO public.products (
    id, merchant_id, category_id, name, slug, brand, price, status,
    has_variants, manage_stock, stock, stock_quantity, inventory_tracking_policy, images
  ) VALUES
    (
      v_prod_primary, v_merchant, v_cat_phones, 'iPhone 16 Pro Max', 'iphone-16-pro-max',
      'Apple', 1500000, 'active', false, false, 5, 5, 'off', '["https://example.com/p1.jpg"]'::jsonb
    ),
    (
      v_prod_peer, v_merchant, v_cat_phones, 'Samsung Galaxy S24 Ultra', 'samsung-galaxy-s24-ultra',
      'Samsung', 1400000, 'active', false, false, 5, 5, 'off', '["https://example.com/p2.jpg"]'::jsonb
    );
END;
$setup$;

-- 1. Authenticated INSERT/UPDATE guard on verification fields
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '9b010000-0000-4000-8000-000000000001', true);

DO $auth_write_guard$
DECLARE
  v_merchant uuid := '9b010000-0000-4000-8000-000000000002';
  v_cat_phones uuid := '9b010000-0000-4000-8000-000000000003';
  v_post_1 uuid := '9b010000-0000-4000-8000-000000000011';
  v_rejected boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.blog_posts (
      id, merchant_id, title, slug, content, excerpt, category, author_name, status,
      published_at, cluster_category_id, guide_scope, guide_kind, metadata_status
    ) VALUES (
      v_post_1, v_merchant, 'Spoofed Verified Insert', 'spoofed-verified-insert',
      'Body', 'Excerpt', 'Smartphones', 'Guide Editor', 'published', now(),
      v_cat_phones, 'category_guide', 'buyer-guide', 'verified'
    );
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_rejected := true;
  END;

  IF NOT v_rejected THEN
    RAISE EXCEPTION 'expected authenticated INSERT with metadata_status = verified to fail with 42501';
  END IF;

  -- Unverified authenticated INSERT succeeds
  INSERT INTO public.blog_posts (
    id, merchant_id, title, slug, content, excerpt, category, author_name, status,
    published_at, reading_time_minutes, cluster_category_id, guide_scope, guide_kind, applicable_brands
  ) VALUES (
    v_post_1, v_merchant, 'iPhone 16 Pro Max Buyer Guide', 'iphone-16-pro-max-buyer-guide',
    'Detailed buyer guide.', 'Choose the right iPhone.', 'Smartphones', 'Guide Editor', 'published',
    now() - INTERVAL '2 hours', 6, v_cat_phones, 'product_specific', 'buyer-guide', ARRAY['Apple']
  );

  -- Authenticated UPDATE attempting to self-verify fails with 42501
  v_rejected := false;
  BEGIN
    UPDATE public.blog_posts
       SET metadata_status = 'verified'
     WHERE id = v_post_1;
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_rejected := true;
  END;

  IF NOT v_rejected THEN
    RAISE EXCEPTION 'expected authenticated UPDATE setting metadata_status = verified to fail with 42501';
  END IF;
END;
$auth_write_guard$;

-- 2. Service role verification, subject mapping, and candidate RPC + news exclusion
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $service_verify_and_candidates$
DECLARE
  v_merchant uuid := '9b010000-0000-4000-8000-000000000002';
  v_cat_phones uuid := '9b010000-0000-4000-8000-000000000003';
  v_cat_laptops uuid := '9b010000-0000-4000-8000-000000000004';
  v_prod_primary uuid := '9b010000-0000-4000-8000-000000000005';
  v_post_subject uuid := '9b010000-0000-4000-8000-000000000011';
  v_post_brand uuid := '9b010000-0000-4000-8000-000000000012';
  v_post_news uuid := '9b010000-0000-4000-8000-000000000013';
  v_post_laptop_brand uuid := '9b010000-0000-4000-8000-000000000014';
BEGIN
  INSERT INTO public.blog_post_guide_subjects (
    blog_post_id, merchant_id, product_id, subject_role, source_revision
  ) VALUES (
    v_post_subject, v_merchant, v_prod_primary, 'primary', 'rev-subj-1'
  );

  UPDATE public.blog_posts
     SET metadata_status = 'verified',
         metadata_verified_at = now(),
         metadata_verified_by = 'backfill_worker',
         metadata_source_revision = 'rev-subj-1',
         metadata_contract_version = 2
   WHERE id = v_post_subject;

  INSERT INTO public.blog_posts (
    id, merchant_id, title, slug, content, excerpt, category, author_name, status,
    published_at, reading_time_minutes, cluster_category_id, guide_scope,
    guide_kind, applicable_brands, metadata_status, metadata_verified_at,
    metadata_verified_by, metadata_source_revision, metadata_contract_version
  ) VALUES
    (
      v_post_brand, v_merchant, 'Best Apple Phones in Nigeria', 'best-apple-phones-nigeria',
      'Apple phone family comparison.', 'Compare Apple phones.', 'Smartphones', 'Guide Editor', 'published',
      now() - INTERVAL '3 hours', 5, v_cat_phones, 'brand_family_guide',
      'best-in-nigeria', ARRAY['Apple'], 'verified', now(),
      'backfill_worker', 'rev-brand-1', 2
    ),
    (
      v_post_news, v_merchant, 'Apple Event News', 'apple-event-news',
      'News coverage.', 'News excerpt.', 'Smartphones', 'Guide Editor', 'published',
      now() - INTERVAL '1 hour', 4, v_cat_phones, 'category_guide',
      'buyer-guide', ARRAY[]::text[], 'verified', now(),
      'backfill_worker', 'rev-news-1', 2
    ),
    (
      v_post_laptop_brand, v_merchant, 'Best Apple Laptops in Nigeria', 'best-apple-laptops-nigeria',
      'MacBook family guide.', 'Compare MacBooks.', 'Laptops', 'Guide Editor', 'published',
      now() - INTERVAL '4 hours', 7, v_cat_laptops, 'brand_family_guide',
      'buyer-guide', ARRAY['Apple'], 'verified', now(),
      'backfill_worker', 'rev-laptop-1', 2
    );
END;
$service_verify_and_candidates$;

RESET ROLE;
INSERT INTO public.merchant_blog_classifications (
  post_id, merchant_id, intent, source, classifier_version, input_fingerprint, evidence_sha256
) VALUES (
  '9b010000-0000-4000-8000-000000000013'::uuid,
  '9b010000-0000-4000-8000-000000000002'::uuid,
  'news',
  'merchant_declared',
  'v1',
  pg_catalog.repeat('a', 64),
  NULL
);

-- 3. Public anon RPC call verifies ordering, subjects JSONB, and news exclusion
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.role', 'anon', true);
SELECT set_config('request.jwt.claim.sub', '', true);

DO $anon_rpc_assertions$
DECLARE
  v_merchant uuid := '9b010000-0000-4000-8000-000000000002';
  v_cat_phones uuid := '9b010000-0000-4000-8000-000000000003';
  v_prod_primary uuid := '9b010000-0000-4000-8000-000000000005';
  v_slugs text[];
  v_first_subjects jsonb;
BEGIN
  SELECT array_agg(c.slug ORDER BY c.ordinality)
    INTO v_slugs
    FROM public.get_storefront_cluster_guide_candidates_v2(
      v_merchant, 'product', v_cat_phones, v_prod_primary, 4
    ) WITH ORDINALITY AS c;

  IF v_slugs IS DISTINCT FROM ARRAY['iphone-16-pro-max-buyer-guide', 'best-apple-phones-nigeria'] THEN
    RAISE EXCEPTION 'expected verified subject + brand candidates without news post, got %', v_slugs;
  END IF;

  SELECT c.subjects INTO v_first_subjects
    FROM public.get_storefront_cluster_guide_candidates_v2(
      v_merchant, 'product', v_cat_phones, v_prod_primary, 4
    ) AS c
   WHERE c.slug = 'iphone-16-pro-max-buyer-guide';

  IF pg_catalog.jsonb_array_length(v_first_subjects) <> 1
     OR (v_first_subjects->0->>'subjectRole') IS DISTINCT FROM 'primary' THEN
    RAISE EXCEPTION 'expected primary subject JSONB on subject match, got %', v_first_subjects;
  END IF;
END;
$anon_rpc_assertions$;

-- 4. Staleness invalidation triggers on blog_posts, subjects, and products
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '9b010000-0000-4000-8000-000000000001', true);

DO $authenticated_staleness$
DECLARE
  v_post_brand uuid := '9b010000-0000-4000-8000-000000000012';
  v_status text;
BEGIN
  UPDATE public.blog_posts
     SET applicable_brands = ARRAY['Apple', 'Samsung']
   WHERE id = v_post_brand;

  SELECT metadata_status INTO v_status FROM public.blog_posts WHERE id = v_post_brand;
  IF v_status IS DISTINCT FROM 'stale' THEN
    RAISE EXCEPTION 'expected applicable_brands edit to mark verified post stale, got %', v_status;
  END IF;
END;
$authenticated_staleness$;

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $product_brand_and_subject_staleness$
DECLARE
  v_prod_primary uuid := '9b010000-0000-4000-8000-000000000005';
  v_post_subject uuid := '9b010000-0000-4000-8000-000000000011';
  v_post_brand uuid := '9b010000-0000-4000-8000-000000000012';
  v_post_laptop_brand uuid := '9b010000-0000-4000-8000-000000000014';
  v_status_phones text;
  v_status_laptops text;
  v_status_subject text;
BEGIN
  -- Re-verify both smartphone brand guide and subject-linked guide before product update
  UPDATE public.blog_posts SET metadata_status = 'verified' WHERE id = v_post_brand;
  UPDATE public.blog_posts SET metadata_status = 'verified' WHERE id = v_post_subject;

  UPDATE public.products
     SET brand = 'Apple Inc'
   WHERE id = v_prod_primary;

  SELECT metadata_status INTO v_status_subject FROM public.blog_posts WHERE id = v_post_subject;
  SELECT metadata_status INTO v_status_phones FROM public.blog_posts WHERE id = v_post_brand;
  SELECT metadata_status INTO v_status_laptops FROM public.blog_posts WHERE id = v_post_laptop_brand;

  IF v_status_subject IS DISTINCT FROM 'stale' THEN
    RAISE EXCEPTION 'expected subject-linked post to become stale when subject product brand changes, got %', v_status_subject;
  END IF;

  IF v_status_phones IS DISTINCT FROM 'verified' THEN
    RAISE EXCEPTION 'expected unlinked smartphone brand guide to remain verified when product brand changes, got %', v_status_phones;
  END IF;

  IF v_status_laptops IS DISTINCT FROM 'verified' THEN
    RAISE EXCEPTION 'expected cross-category laptop brand guide to remain verified, got %', v_status_laptops;
  END IF;

  -- Re-verify subject-linked post, confirm it starts verified, then delete subject row
  UPDATE public.blog_posts SET metadata_status = 'verified' WHERE id = v_post_subject;
  SELECT metadata_status INTO v_status_subject FROM public.blog_posts WHERE id = v_post_subject;
  IF v_status_subject IS DISTINCT FROM 'verified' THEN
    RAISE EXCEPTION 'expected subject-linked post to start verified before delete, got %', v_status_subject;
  END IF;

  DELETE FROM public.blog_post_guide_subjects WHERE blog_post_id = v_post_subject;
  SELECT metadata_status INTO v_status_subject FROM public.blog_posts WHERE id = v_post_subject;

  IF v_status_subject IS DISTINCT FROM 'stale' THEN
    RAISE EXCEPTION 'expected subject delete to mark verified post stale, got %', v_status_subject;
  END IF;
END;
$product_brand_and_subject_staleness$;

ROLLBACK;
