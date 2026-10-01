-- ================================================================
-- REGRESSION TEST: storefront cluster-guide classifier behavior
--
-- This fixture keeps classifier branch cases and category-aware capping
-- isolated from the public RPC privilege/input contract checks.
-- ================================================================

BEGIN;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $setup$
DECLARE
  v_enabled_merchant_id uuid := '7f9d0e11-0000-4000-8000-000000000011';
BEGIN
  INSERT INTO public.merchants (id, email, business_name)
  VALUES (
    v_enabled_merchant_id,
    'cluster-guide-behavior@example.com',
    'Cluster Guide Behavior Fixture'
  );

  UPDATE public.merchant_feature_settings
  SET blog_enabled = true
  WHERE merchant_id = v_enabled_merchant_id;

  INSERT INTO public.blog_posts (
    merchant_id,
    title,
    slug,
    content,
    excerpt,
    category,
    tags,
    keywords,
    author_name,
    status,
    published_at,
    reading_time_minutes
  )
  VALUES
    (
      v_enabled_merchant_id,
      'Zephyrbattery Buyer Guide',
      'behavior-valid-old-zephyrbattery-guide',
      'A durable zephyrbattery buying guide for public shoppers.',
      'Public guide excerpt',
      'Smartphones',
      ARRAY['battery', 'phones']::text[],
      ARRAY['zephyrbattery', 'buyer guide']::text[],
      'Baci Test Author',
      'published',
      '2024-01-01 00:00:00+00'::timestamp with time zone,
      7
    ),
    (
      v_enabled_merchant_id,
      'Substring fallbackterm guide',
      'behavior-substring-fallback-guide',
      'A guide whose category contains the cluster name as a suffix.',
      'Substring fallback guide',
      'Smartphones Accessories',
      ARRAY[]::text[],
      ARRAY[]::text[],
      'Baci Test Author',
      'published',
      '2026-01-09 00:00:00+00'::timestamp with time zone,
      4
    ),
    (
      v_enabled_merchant_id,
      'Inferredtoken guide',
      'behavior-inferred-token-guide',
      'A neutral-category article containing the inferred token.',
      'Inferred token guide',
      'Accessories',
      ARRAY[]::text[],
      ARRAY[]::text[],
      'Baci Test Author',
      'published',
      '2026-01-10 00:00:00+00'::timestamp with time zone,
      4
    ),
    (
      v_enabled_merchant_id,
      'Tiebreakterm phone guide',
      'behavior-tie-breaking-guide',
      'Two rules match this exact category; the earlier rule must win.',
      'Tie-breaking guide',
      'Phone',
      ARRAY[]::text[],
      ARRAY[]::text[],
      'Baci Test Author',
      'published',
      '2026-01-11 00:00:00+00'::timestamp with time zone,
      4
    );

  -- These newer posts match the broad battery query but belong to laptops.
  INSERT INTO public.blog_posts (
    merchant_id, title, slug, content, category, author_name, status, published_at
  )
  SELECT
    v_enabled_merchant_id,
    pg_catalog.format('Newer laptop battery article %s', series_number),
    pg_catalog.format('behavior-newer-unrelated-article-%s', series_number),
    pg_catalog.format(
      'Laptop battery battery battery buying notes number %s.',
      series_number
    ),
    'Laptops',
    'Baci Test Author',
    'published',
    '2026-02-01 00:00:00+00'::timestamp with time zone
      + series_number * interval '1 minute'
  FROM pg_catalog.generate_series(1, 70) AS series_number;

  -- More than 64 matching posts prove that the helper, not its caller, caps.
  INSERT INTO public.blog_posts (
    merchant_id, title, slug, content, category, author_name, status, published_at
  )
  SELECT
    v_enabled_merchant_id,
    pg_catalog.format('Capterm guide %s', series_number),
    pg_catalog.format('behavior-capterm-guide-%s', series_number),
    pg_catalog.format('A public capterm guide number %s.', series_number),
    'Smartphones',
    'Baci Test Author',
    'published',
    '2026-03-01 00:00:00+00'::timestamp with time zone
      + series_number * interval '1 minute'
  FROM pg_catalog.generate_series(1, 70) AS series_number;
END;
$setup$;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.role', 'anon', true);

DO $assertions$
DECLARE
  v_enabled_merchant_id uuid := '7f9d0e11-0000-4000-8000-000000000011';
  v_cluster_rules jsonb := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'rule_order', 0,
      'category_slug', 'smartphones',
      'category_names', pg_catalog.jsonb_build_array(
        'smartphones', 'phones', 'mobile phones'
      ),
      'article_tokens', pg_catalog.jsonb_build_array(
        'smartphone', 'phone', 'iphone', 'android', 'samsung', 'galaxy',
        'battery', 'inferredtoken', 'camera', '5g', 'sim'
      )
    ),
    pg_catalog.jsonb_build_object(
      'rule_order', 1,
      'category_slug', 'laptops',
      'category_names', pg_catalog.jsonb_build_array(
        'laptops', 'computers', 'notebooks'
      ),
      'article_tokens', pg_catalog.jsonb_build_array(
        'laptop', 'notebook', 'macbook', 'windows', 'ssd', 'ram',
        'gaming', 'battery', 'intel', 'amd', 'ryzen'
      )
    )
  );
  v_tie_rules jsonb := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'rule_order', 0,
      'category_slug', 'smartphones',
      'category_names', pg_catalog.jsonb_build_array('phone'),
      'article_tokens', pg_catalog.jsonb_build_array('phone')
    ),
    pg_catalog.jsonb_build_object(
      'rule_order', 1,
      'category_slug', 'laptops',
      'category_names', pg_catalog.jsonb_build_array('phone'),
      'article_tokens', pg_catalog.jsonb_build_array('laptop')
    )
  );
  v_count integer;
  v_result record;
BEGIN
  SELECT count(*)::integer
  INTO v_count
  FROM public.get_storefront_cluster_guide_candidates_v1(
    v_enabled_merchant_id, 'smartphones', v_cluster_rules, 'fallbackterm'
  );

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'substring fallback returned %, expected 1', v_count;
  END IF;

  SELECT slug
  INTO v_result
  FROM public.get_storefront_cluster_guide_candidates_v1(
    v_enabled_merchant_id, 'smartphones', v_cluster_rules, 'fallbackterm'
  );

  IF v_result.slug IS DISTINCT FROM 'behavior-substring-fallback-guide' THEN
    RAISE EXCEPTION 'substring fallback returned unexpected guide: %',
      pg_catalog.row_to_json(v_result);
  END IF;

  SELECT slug
  INTO v_result
  FROM public.get_storefront_cluster_guide_candidates_v1(
    v_enabled_merchant_id, 'smartphones', v_cluster_rules, 'inferredtoken'
  );

  IF v_result.slug IS DISTINCT FROM 'behavior-inferred-token-guide' THEN
    RAISE EXCEPTION 'inferred-token classification returned unexpected guide: %',
      pg_catalog.row_to_json(v_result);
  END IF;

  SELECT slug
  INTO v_result
  FROM public.get_storefront_cluster_guide_candidates_v1(
    v_enabled_merchant_id, 'smartphones', v_tie_rules, 'tiebreakterm'
  );

  IF v_result.slug IS DISTINCT FROM 'behavior-tie-breaking-guide' THEN
    RAISE EXCEPTION 'rule-order tie-breaking returned unexpected guide: %',
      pg_catalog.row_to_json(v_result);
  END IF;

  -- Ranking and category filtering occur before the helper applies its cap.
  SELECT *
  INTO v_result
  FROM public.get_storefront_cluster_guide_candidates_v1(
    v_enabled_merchant_id, 'smartphones', v_cluster_rules, 'zephyrbattery', 1
  );

  IF v_result.slug IS DISTINCT FROM 'behavior-valid-old-zephyrbattery-guide' THEN
    RAISE EXCEPTION 'relevance-before-limit returned unexpected guide: %',
      pg_catalog.row_to_json(v_result);
  END IF;

  SELECT *
  INTO v_result
  FROM public.get_storefront_cluster_guide_candidates_v1(
    v_enabled_merchant_id, 'smartphones', v_cluster_rules, 'battery', 1
  );

  IF v_result.slug IS DISTINCT FROM 'behavior-valid-old-zephyrbattery-guide' THEN
    RAISE EXCEPTION 'category filtering before cap returned unexpected guide: %',
      pg_catalog.row_to_json(v_result);
  END IF;

  SELECT count(*)::integer
  INTO v_count
  FROM public.get_storefront_cluster_guide_candidates_v1(
    v_enabled_merchant_id, 'smartphones', v_cluster_rules, 'capterm', 999
  );

  IF v_count <> 64 THEN
    RAISE EXCEPTION 'upper result cap returned %, expected 64', v_count;
  END IF;

  SELECT count(*)::integer
  INTO v_count
  FROM public.get_storefront_cluster_guide_candidates_v1(
    v_enabled_merchant_id, 'smartphones', v_cluster_rules, 'capterm', 0
  );

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'lower result cap returned %, expected 1', v_count;
  END IF;
END;
$assertions$;

RESET ROLE;
ROLLBACK;
