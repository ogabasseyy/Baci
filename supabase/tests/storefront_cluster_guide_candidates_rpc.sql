-- ================================================================
-- REGRESSION TEST: bounded public storefront cluster-guide candidates
--
-- USAGE:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/storefront_cluster_guide_candidates_rpc.sql
-- ================================================================

BEGIN;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $setup$
DECLARE
  v_enabled_merchant_id uuid := '7f9d0e11-0000-4000-8000-000000000001';
  v_disabled_merchant_id uuid := '7f9d0e11-0000-4000-8000-000000000002';
  v_missing_settings_merchant_id uuid := '7f9d0e11-0000-4000-8000-000000000003';
  v_classifier_oid oid;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid = (
      'public.get_storefront_cluster_guide_candidates_v1(uuid,text,jsonb,text,integer)'
    )::pg_catalog.regprocedure
      AND proc.prosecdef
      AND proc.provolatile = 's'
      AND proc.proowner = 'postgres'::pg_catalog.regrole
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_options_to_table(
          coalesce(proc.proconfig, ARRAY[]::text[])
        ) AS config
        WHERE config.option_name = 'search_path'
          AND pg_catalog.btrim(config.option_value, '"') = ''
      )
  ) THEN
    RAISE EXCEPTION
      'guide-candidate RPC must be STABLE SECURITY DEFINER with blank search_path';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS proc
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      coalesce(
        proc.proacl,
        pg_catalog.acldefault('f', proc.proowner)
      )
    ) AS acl
    WHERE proc.oid = (
      'public.get_storefront_cluster_guide_candidates_v1(uuid,text,jsonb,text,integer)'
    )::pg_catalog.regprocedure
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'PUBLIC unexpectedly has EXECUTE on guide-candidate RPC';
  END IF;

  SELECT proc.oid
  INTO v_classifier_oid
  FROM pg_catalog.pg_proc AS proc
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = proc.pronamespace
  WHERE namespace.nspname = 'private'
    AND proc.proname = 'classify_storefront_cluster_guide_candidates_v2'
    AND proc.pronargs = 5
    AND proc.proargtypes[0] = 'uuid'::pg_catalog.regtype
    AND proc.proargtypes[1] = 'jsonb'::pg_catalog.regtype
    AND proc.proargtypes[2] = 'pg_catalog.tsquery'::pg_catalog.regtype
    AND proc.proargtypes[3] = 'text'::pg_catalog.regtype
    AND proc.proargtypes[4] = 'integer'::pg_catalog.regtype;

  IF v_classifier_oid IS NULL THEN
    RAISE EXCEPTION 'private guide classifier is missing';
  END IF;

  IF pg_catalog.has_function_privilege(
    'anon', v_classifier_oid, 'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'authenticated', v_classifier_oid, 'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'private guide classifier unexpectedly has application-role EXECUTE';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
    'anon',
    'public.get_storefront_cluster_guide_candidates_v1(uuid,text,jsonb,text,integer)',
    'EXECUTE'
  )
    OR NOT pg_catalog.has_function_privilege(
      'authenticated',
      'public.get_storefront_cluster_guide_candidates_v1(uuid,text,jsonb,text,integer)',
      'EXECUTE'
    )
    OR NOT pg_catalog.has_function_privilege(
      'service_role',
      'public.get_storefront_cluster_guide_candidates_v1(uuid,text,jsonb,text,integer)',
      'EXECUTE'
    )
  THEN
    RAISE EXCEPTION
      'guide-candidate RPC must grant EXECUTE to anon, authenticated, and service_role';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger
    WHERE trigger.tgrelid = 'public.blog_posts'::pg_catalog.regclass
      AND trigger.tgname = 'blog_posts_search_vector_update'
      AND NOT trigger.tgisinternal
      AND pg_catalog.pg_get_triggerdef(trigger.oid) ILIKE '%category%'
      AND pg_catalog.pg_get_triggerdef(trigger.oid) ILIKE '%tags%'
      AND pg_catalog.pg_get_triggerdef(trigger.oid) ILIKE '%keywords%'
  ) THEN
    RAISE EXCEPTION
      'blog search-vector trigger must refresh category, tags, and keywords';
  END IF;

  INSERT INTO public.merchants (id, email, business_name)
  VALUES
    (
      v_enabled_merchant_id,
      'cluster-guide-enabled@example.com',
      'Cluster Guide Enabled Fixture'
    ),
    (
      v_disabled_merchant_id,
      'cluster-guide-disabled@example.com',
      'Cluster Guide Disabled Fixture'
    ),
    (
      v_missing_settings_merchant_id,
      'cluster-guide-no-settings@example.com',
      'Cluster Guide No Settings Fixture'
    );

  -- Merchant creation installs default feature rows. Make the three gate
  -- states explicit: enabled, existing-but-disabled, and no settings row.
  UPDATE public.merchant_feature_settings
  SET blog_enabled = (merchant_id = v_enabled_merchant_id)
  WHERE merchant_id IN (v_enabled_merchant_id, v_disabled_merchant_id);

  DELETE FROM public.merchant_feature_settings
  WHERE merchant_id = v_missing_settings_merchant_id;

  INSERT INTO public.blog_posts (
    merchant_id,
    title,
    slug,
    content,
    excerpt,
    featured_image_url,
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
      'valid-old-zephyrbattery-guide',
      'A durable zephyrbattery buying guide for public shoppers.',
      'Public guide excerpt',
      'https://example.com/public-guide.jpg',
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
      'Draft Zephyrbattery Guide',
      'hidden-draft-zephyrbattery-guide',
      'Hidden zephyrbattery draft content.',
      'Must remain hidden',
      NULL,
      'Smartphones',
      ARRAY[]::text[],
      ARRAY[]::text[],
      'Baci Test Author',
      'draft',
      '2026-01-01 00:00:00+00'::timestamp with time zone,
      2
    ),
    (
      v_enabled_merchant_id,
      'Archived Zephyrbattery Guide',
      'hidden-archived-zephyrbattery-guide',
      'Hidden zephyrbattery archived content.',
      'Must remain hidden',
      NULL,
      'Smartphones',
      ARRAY[]::text[],
      ARRAY[]::text[],
      'Baci Test Author',
      'archived',
      '2026-01-02 00:00:00+00'::timestamp with time zone,
      2
    ),
    (
      v_enabled_merchant_id,
      'Scheduled Zephyrbattery Guide',
      'hidden-scheduled-zephyrbattery-guide',
      'Hidden scheduled zephyrbattery content without a publication timestamp.',
      'Must remain hidden',
      NULL,
      'Smartphones',
      ARRAY[]::text[],
      ARRAY[]::text[],
      'Baci Test Author',
      'scheduled',
      NULL,
      2
    ),
    (
      v_enabled_merchant_id,
      '   ',
      'hidden-blank-title-zephyrbattery-guide',
      'Hidden zephyrbattery content with a blank title.',
      'Must remain hidden',
      NULL,
      'Smartphones',
      ARRAY[]::text[],
      ARRAY[]::text[],
      'Baci Test Author',
      'published',
      '2026-01-03 00:00:00+00'::timestamp with time zone,
      2
    ),
    (
      v_enabled_merchant_id,
      'Zephyrbattery Guide With Blank Slug',
      '   ',
      'Hidden zephyrbattery content with a blank slug.',
      'Must remain hidden',
      NULL,
      'Smartphones',
      ARRAY[]::text[],
      ARRAY[]::text[],
      'Baci Test Author',
      'published',
      '2026-01-04 00:00:00+00'::timestamp with time zone,
      2
    ),
    (
      v_enabled_merchant_id,
      'Metadata Classified Public Guide',
      'metadata-classified-public-guide',
      'A generic public buying article whose cluster is supplied by metadata.',
      'Metadata-backed guide excerpt',
      NULL,
      'Smartphones',
      ARRAY['metadataonlyterm-tag']::text[],
      ARRAY['metadataonlyterm-keyword']::text[],
      'Baci Test Author',
      'published',
      '2026-01-06 12:00:00+00'::timestamp with time zone,
      3
    ),
    (
      v_disabled_merchant_id,
      'Disabled Zephyrbattery Guide',
      'hidden-disabled-merchant-zephyrbattery-guide',
      'Published zephyrbattery content behind a disabled blog.',
      'Must remain hidden',
      NULL,
      'Smartphones',
      ARRAY[]::text[],
      ARRAY[]::text[],
      'Baci Test Author',
      'published',
      '2026-01-07 00:00:00+00'::timestamp with time zone,
      2
    ),
    (
      v_missing_settings_merchant_id,
      'No Settings Zephyrbattery Guide',
      'hidden-no-settings-zephyrbattery-guide',
      'Published zephyrbattery content without a settings row.',
      'Must remain hidden',
      NULL,
      'Smartphones',
      ARRAY[]::text[],
      ARRAY[]::text[],
      'Baci Test Author',
      'published',
      '2026-01-08 00:00:00+00'::timestamp with time zone,
      2
    );

END;
$setup$;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.role', 'anon', true);

DO $assertions$
DECLARE
  v_enabled_merchant_id uuid := '7f9d0e11-0000-4000-8000-000000000001';
  v_disabled_merchant_id uuid := '7f9d0e11-0000-4000-8000-000000000002';
  v_missing_settings_merchant_id uuid := '7f9d0e11-0000-4000-8000-000000000003';
  v_cluster_rules jsonb := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'rule_order', 0,
      'category_slug', 'smartphones',
      'category_names', pg_catalog.jsonb_build_array(
        'smartphones',
        'phones',
        'mobile phones'
      ),
      'article_tokens', pg_catalog.jsonb_build_array(
        'smartphone',
        'phone',
        'iphone',
        'android',
        'samsung',
        'galaxy',
        'battery',
        'inferredtoken',
        'camera',
        '5g',
        'sim'
      )
    ),
    pg_catalog.jsonb_build_object(
      'rule_order', 1,
      'category_slug', 'laptops',
      'category_names', pg_catalog.jsonb_build_array(
        'laptops',
        'computers',
        'notebooks'
      ),
      'article_tokens', pg_catalog.jsonb_build_array(
        'laptop',
        'notebook',
        'macbook',
        'windows',
        'ssd',
        'ram',
        'gaming',
        'battery',
        'intel',
        'amd',
        'ryzen'
      )
    )
  );
  v_count integer;
  v_result record;
BEGIN
  -- The feature row remains private to anon; the definer RPC may use it only as
  -- a boolean gate.
  IF pg_catalog.has_table_privilege(
    'anon',
    'public.merchant_feature_settings',
    'SELECT'
  ) THEN
    RAISE EXCEPTION 'anon unexpectedly has direct feature-settings SELECT';
  END IF;

  SELECT count(*)::integer
  INTO v_count
  FROM public.get_storefront_cluster_guide_candidates_v1(
    v_disabled_merchant_id,
    'smartphones',
    v_cluster_rules,
    'zephyrbattery'
  );

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'disabled blog leaked % guide candidates', v_count;
  END IF;

  SELECT count(*)::integer
  INTO v_count
  FROM public.get_storefront_cluster_guide_candidates_v1(
    v_missing_settings_merchant_id,
    'smartphones',
    v_cluster_rules,
    'zephyrbattery'
  );

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'merchant without settings leaked % guide candidates', v_count;
  END IF;

  -- This one-row result simultaneously proves the enabled gate, published-only
  -- filtering, and nonblank title/slug filtering.
  SELECT *
  INTO v_result
  FROM public.get_storefront_cluster_guide_candidates_v1(
    v_enabled_merchant_id,
    'smartphones',
    v_cluster_rules,
    'zephyrbattery'
  );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'enabled blog returned no relevant public guide';
  END IF;

  SELECT count(*)::integer
  INTO v_count
  FROM public.get_storefront_cluster_guide_candidates_v1(
    v_enabled_merchant_id,
    'smartphones',
    v_cluster_rules,
    'zephyrbattery'
  );

  IF v_count <> 1
    OR v_result.slug IS DISTINCT FROM 'valid-old-zephyrbattery-guide'
    OR v_result.title IS DISTINCT FROM 'Zephyrbattery Buyer Guide'
    OR v_result.excerpt IS DISTINCT FROM 'Public guide excerpt'
    OR v_result.category IS DISTINCT FROM 'Smartphones'
    OR v_result.tags IS DISTINCT FROM ARRAY['battery', 'phones']::text[]
    OR v_result.keywords IS DISTINCT FROM ARRAY['zephyrbattery', 'buyer guide']::text[]
    OR v_result.featured_image_url IS DISTINCT FROM 'https://example.com/public-guide.jpg'
    OR v_result.published_at IS DISTINCT FROM '2024-01-01 00:00:00+00'::timestamp with time zone
    OR v_result.reading_time_minutes IS DISTINCT FROM 7
  THEN
    RAISE EXCEPTION 'public projection/filter contract was unexpected: %, count=%',
      pg_catalog.row_to_json(v_result),
      v_count;
  END IF;

  -- Category/tags/keywords are part of the same indexed document used by the
  -- JS semantic classifier. The term is intentionally absent from title,
  -- excerpt, and content so this fails if the database prefilter drifts.
  SELECT *
  INTO v_result
  FROM public.get_storefront_cluster_guide_candidates_v1(
    v_enabled_merchant_id,
    'smartphones',
    v_cluster_rules,
    'metadataonlyterm'
  );

  IF NOT FOUND
    OR v_result.slug IS DISTINCT FROM 'metadata-classified-public-guide'
  THEN
    RAISE EXCEPTION 'metadata-only guide classification was lost: %',
      pg_catalog.row_to_json(v_result);
  END IF;

  SELECT count(*)::integer
  INTO v_count
  FROM public.get_storefront_cluster_guide_candidates_v1(
    v_enabled_merchant_id,
    'smartphones',
    v_cluster_rules,
    '   '
  );

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'blank query returned % rows', v_count;
  END IF;

  SELECT count(*)::integer
  INTO v_count
  FROM public.get_storefront_cluster_guide_candidates_v1(
    v_enabled_merchant_id,
    'smartphones',
    v_cluster_rules,
    'the and or'
  );

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'lexeme-free query returned % rows', v_count;
  END IF;

  SELECT count(*)::integer
  INTO v_count
  FROM public.get_storefront_cluster_guide_candidates_v1(
    v_enabled_merchant_id,
    'smartphones',
    v_cluster_rules,
    '-iphone'
  );

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'negative-only query returned % rows', v_count;
  END IF;

  SELECT count(*)::integer
  INTO v_count
  FROM public.get_storefront_cluster_guide_candidates_v1(
    v_enabled_merchant_id,
    'smartphones',
    '[]'::jsonb,
    'zephyrbattery'
  );

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'empty cluster rules returned % rows', v_count;
  END IF;

  SELECT count(*)::integer
  INTO v_count
  FROM public.get_storefront_cluster_guide_candidates_v1(
    v_enabled_merchant_id,
    'smartphones',
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'rule_order', 0,
        'category_slug', 'smartphones'
      )
    ),
    'zephyrbattery'
  );

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'malformed cluster rules returned % rows', v_count;
  END IF;

  SELECT count(*)::integer
  INTO v_count
  FROM public.get_storefront_cluster_guide_candidates_v1(
    v_enabled_merchant_id,
    'smartphones',
    v_cluster_rules,
    pg_catalog.repeat('x', 513)
  );

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'overlong query returned % rows', v_count;
  END IF;
END;
$assertions$;

RESET ROLE;
ROLLBACK;
