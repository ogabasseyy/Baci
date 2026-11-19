-- Product-search suggestion RPC parity and index-safe threshold regression.
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--   -f supabase/tests/product_search_suggestion_v2_parity.sql

BEGIN;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
DO $contract$
DECLARE
  v_proc pg_catalog.pg_proc%ROWTYPE;
  v_count integer;
  v_default_expression text;
  v_default_value real;
BEGIN
  SELECT proc.* INTO STRICT v_proc
  FROM pg_catalog.pg_proc AS proc
  WHERE proc.oid =
    'public.find_product_search_suggestion_v2(text,uuid,real)'::pg_catalog.regprocedure;

  v_default_expression := pg_catalog.pg_get_expr(v_proc.proargdefaults, 0);
  EXECUTE pg_catalog.format('SELECT (%s)::real', v_default_expression) INTO v_default_value;

  IF v_proc.prosecdef OR v_proc.provolatile <> 's' OR v_proc.prorows <> 1
    OR v_proc.pronargdefaults <> 1
    OR v_default_value IS DISTINCT FROM 0.35::real
    OR v_proc.prolang <> (
      SELECT language.oid FROM pg_catalog.pg_language AS language
      WHERE language.lanname = 'plpgsql'
    )
  THEN
    RAISE EXCEPTION
      'RPC metadata drift: security_definer=%, volatility=%, rows=%, defaults=%, default=%',
      v_proc.prosecdef, v_proc.provolatile, v_proc.prorows,
      v_proc.pronargdefaults, v_default_expression;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_options_to_table(
      COALESCE(v_proc.proconfig, ARRAY[]::text[])
    ) AS config
    WHERE config.option_name = 'search_path'
      AND pg_catalog.btrim(config.option_value, '"') = ''
  ) THEN
    RAISE EXCEPTION 'RPC must use a blank search_path';
  END IF;
  IF NOT pg_catalog.has_function_privilege(
    'anon', 'public.find_product_search_suggestion_v2(text,uuid,real)', 'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.find_product_search_suggestion_v2(text,uuid,real)', 'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'service_role',
    'public.find_product_search_suggestion_v2(text,uuid,real)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'RPC API-role grants are incomplete';
  END IF;

  SELECT pg_catalog.count(*)::integer INTO v_count
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = 'public.products'::pg_catalog.regclass
    AND attribute.attname IN ('search_name_norm', 'search_name_compact')
    AND attribute.attgenerated = 's' AND NOT attribute.attisdropped;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'both STORED product-search name columns are required';
  END IF;

  SELECT pg_catalog.count(*)::integer INTO v_count
  FROM pg_catalog.pg_index AS definition
  JOIN pg_catalog.pg_class AS index_relation
    ON index_relation.oid = definition.indexrelid
  JOIN pg_catalog.pg_class AS table_relation
    ON table_relation.oid = definition.indrelid
  JOIN pg_catalog.pg_am AS access_method
    ON access_method.oid = index_relation.relam
  JOIN pg_catalog.pg_opclass AS operator_class
    ON operator_class.oid = definition.indclass[0]
  JOIN pg_catalog.pg_namespace AS operator_namespace
    ON operator_namespace.oid = operator_class.opcnamespace
  JOIN pg_catalog.pg_attribute AS attribute
    ON attribute.attrelid = table_relation.oid
   AND attribute.attnum = definition.indkey[0]
  WHERE table_relation.oid = 'public.products'::pg_catalog.regclass
    AND index_relation.relname IN (
      'idx_products_search_name_norm_trgm',
      'idx_products_search_name_compact_trgm'
    )
    AND ((index_relation.relname = 'idx_products_search_name_norm_trgm'
        AND attribute.attname = 'search_name_norm')
      OR (index_relation.relname = 'idx_products_search_name_compact_trgm'
        AND attribute.attname = 'search_name_compact'))
    AND access_method.amname = 'gin'
    AND operator_namespace.nspname = 'extensions'
    AND operator_class.opcname = 'gin_trgm_ops'
    AND definition.indisvalid AND definition.indisready;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'both valid ready stored-column trigram GIN indexes are required';
  END IF;
END;
$contract$;
-- First pg_trgm invocation in this fresh backend: the RPC must initialize the
-- extension instead of reading an unregistered custom GUC.
SELECT pg_catalog.count(*) FROM public.find_product_search_suggestion_v2(
  NULL, '7f9d0e12-1000-4000-8000-000000000199', 0.35
);

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
) VALUES
  ('7f9d0e12-1000-4000-8000-000000000001',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'suggestion-owner-a@example.com', 'test', now(), now(), now(), '{}', '{}'),
  ('7f9d0e12-1000-4000-8000-000000000002',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'suggestion-owner-b@example.com', 'test', now(), now(), now(), '{}', '{}');

INSERT INTO public.merchants (
  id, user_id, email, business_name, slug, is_published
) VALUES
  ('7f9d0e12-1000-4000-8000-000000000101',
   '7f9d0e12-1000-4000-8000-000000000001', 'suggestion-a@example.com',
   'Suggestion Fixture A', 'suggestion-fixture-a', true),
  ('7f9d0e12-1000-4000-8000-000000000102',
   '7f9d0e12-1000-4000-8000-000000000002', 'suggestion-b@example.com',
   'Suggestion Fixture B', 'suggestion-fixture-b', true);

INSERT INTO public.products (
  id, merchant_id, name, slug, price, status, has_variants, manage_stock
) VALUES
  ('7f9d0e12-1000-4000-8000-000000000201',
   '7f9d0e12-1000-4000-8000-000000000101', 'Samsung Galaxy S24 Ultra',
   'suggestion-samsung-galaxy-s24-ultra', 100, 'active', false, false),
  ('7f9d0e12-1000-4000-8000-000000000202',
   '7f9d0e12-1000-4000-8000-000000000101', 'Café eSIM Pro-Max',
   'suggestion-cafe-esim-pro-max', 100, 'active', false, false),
  ('7f9d0e12-1000-4000-8000-000000000203',
   '7f9d0e12-1000-4000-8000-000000000101', 'Pixel Exact',
   'suggestion-pixel-exact', 100, 'active', false, false),
  ('7f9d0e12-1000-4000-8000-000000000204',
   '7f9d0e12-1000-4000-8000-000000000101', 'Archived Only Match',
   'suggestion-archived-only-match', 100, 'archived', false, false),
  ('7f9d0e12-1000-4000-8000-000000000205',
   '7f9d0e12-1000-4000-8000-000000000102', 'Merchant B Exclusive',
   'suggestion-merchant-b-exclusive', 100, 'active', false, false),
  ('7f9d0e12-1000-4000-8000-000000000206',
   '7f9d0e12-1000-4000-8000-000000000102', 'Samsung Galaxy S24 Ultra',
   'suggestion-b-archived-samsung', 100, 'archived', false, false);

DO $generated_values$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.products AS product
    WHERE product.id::text LIKE '7f9d0e12-1000-4000-8000-%'
      AND (product.search_name_norm IS DISTINCT FROM
             public.normalize_product_search_text(product.name)
        OR product.search_name_compact IS DISTINCT FROM
             public.compact_product_search_text(product.name))
  ) THEN
    RAISE EXCEPTION 'stored product-search column values drifted';
  END IF;
END;
$generated_values$;

-- Exact legacy body, kept in pg_temp for complete ordered-output comparison.
CREATE OR REPLACE FUNCTION pg_temp.find_product_search_suggestion_v2_legacy(
  search_term text, merchant_id_param uuid,
  similarity_threshold real DEFAULT 0.35
) RETURNS TABLE(suggested_term text, similarity_score real)
LANGUAGE sql STABLE SET search_path TO 'public', 'extensions' AS $$
  WITH query_terms AS (
    SELECT
      public.normalize_product_search_text(search_term) AS normalized_query,
      public.compact_product_search_text(search_term) AS compact_query
  )
  SELECT
    p.name AS suggested_term,
    GREATEST(
      similarity(
        public.normalize_product_search_text(p.name),
        query_terms.normalized_query
      ),
      similarity(
        public.compact_product_search_text(p.name),
        query_terms.compact_query
      )
    )::REAL AS similarity_score
  FROM public.products p
  CROSS JOIN query_terms
  WHERE p.merchant_id = merchant_id_param
    AND p.status = 'active'
    AND GREATEST(
      similarity(
        public.normalize_product_search_text(p.name),
        query_terms.normalized_query
      ),
      similarity(
        public.compact_product_search_text(p.name),
        query_terms.compact_query
      )
    ) >= similarity_threshold
  ORDER BY similarity_score DESC, p.name
  LIMIT 1;
$$; GRANT EXECUTE ON FUNCTION pg_temp.find_product_search_suggestion_v2_legacy(text, uuid, real) TO PUBLIC;

CREATE FUNCTION pg_temp.assert_suggestion_case(
  p_case text, p_search_term text, p_merchant_id uuid, p_threshold real,
  p_use_default boolean DEFAULT false, p_expected_term text DEFAULT NULL,
  p_expected_rows integer DEFAULT NULL, p_expected_score real DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_before text; v_after text; v_expected jsonb; v_actual jsonb;
  v_actual_rows integer; v_actual_term text; v_actual_score real;
BEGIN
  IF p_use_default THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_array(r.suggested_term,
      r.similarity_score) ORDER BY r.ordinality), '[]') INTO v_expected
    FROM pg_temp.find_product_search_suggestion_v2_legacy(
      p_search_term, p_merchant_id
    ) WITH ORDINALITY AS r;
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_array(r.suggested_term,
      r.similarity_score) ORDER BY r.ordinality), '[]') INTO v_expected
    FROM pg_temp.find_product_search_suggestion_v2_legacy(
      p_search_term, p_merchant_id, p_threshold
    ) WITH ORDINALITY AS r;
  END IF;
  v_before := pg_catalog.current_setting('pg_trgm.similarity_threshold');
  IF p_use_default THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_array(r.suggested_term,
      r.similarity_score) ORDER BY r.ordinality), '[]') INTO v_actual
    FROM public.find_product_search_suggestion_v2(
      p_search_term, p_merchant_id
    ) WITH ORDINALITY AS r;
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_array(r.suggested_term,
      r.similarity_score) ORDER BY r.ordinality), '[]') INTO v_actual
    FROM public.find_product_search_suggestion_v2(
      p_search_term, p_merchant_id, p_threshold
    ) WITH ORDINALITY AS r;
  END IF;
  v_after := pg_catalog.current_setting('pg_trgm.similarity_threshold');
  IF v_actual IS DISTINCT FROM v_expected OR v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'case %: expected %, actual %, GUC before %, after %',
      p_case, v_expected, v_actual, v_before, v_after;
  END IF;
  IF p_expected_rows IS NOT NULL THEN
    v_actual_rows := pg_catalog.jsonb_array_length(v_actual);
    v_actual_term := v_actual #>> '{0,0}';
    v_actual_score := (v_actual #>> '{0,1}')::real;
    IF v_actual_rows <> p_expected_rows
      OR v_actual_term IS DISTINCT FROM p_expected_term
      OR (p_expected_score IS NOT NULL
        AND pg_catalog.abs(v_actual_score - p_expected_score) > 0.000001)
    THEN
      RAISE EXCEPTION 'case %: unexpected contract result %', p_case, v_actual;
    END IF;
  END IF;
END;
$$; GRANT EXECUTE ON FUNCTION pg_temp.assert_suggestion_case(text, text, uuid, real, boolean, text, integer, real) TO PUBLIC;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.role', 'anon', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SET LOCAL pg_trgm.similarity_threshold = 0.30;
SELECT pg_temp.assert_suggestion_case('anon default', 'Samsng Galxy', '7f9d0e12-1000-4000-8000-000000000101', NULL, true);
SELECT pg_temp.assert_suggestion_case('anon -1', 'no shared trigrams', '7f9d0e12-1000-4000-8000-000000000101', -1);
SELECT pg_temp.assert_suggestion_case('anon empty 0', '', '7f9d0e12-1000-4000-8000-000000000101', 0);
SELECT pg_temp.assert_suggestion_case('anon 0.285714 edge visible', 'Samsng Ult', '7f9d0e12-1000-4000-8000-000000000101', .28, false, 'Samsung Galaxy S24 Ultra', 1, .285714);
SET LOCAL pg_trgm.similarity_threshold = 0.28571432;
SELECT pg_temp.assert_suggestion_case('anon rounded GUC fallback', 'Samsng Ult', '7f9d0e12-1000-4000-8000-000000000101', .285714298, false, 'Samsung Galaxy S24 Ultra', 1, .285714298);
SET LOCAL pg_trgm.similarity_threshold = 0.30;
SELECT pg_temp.assert_suggestion_case('anon edge excluded', 'Samsng Ult', '7f9d0e12-1000-4000-8000-000000000101', .30, false, NULL, 0);
SELECT pg_temp.assert_suggestion_case('anon locale accent compact', 'Cafe e-sim promax', '7f9d0e12-1000-4000-8000-000000000101', 1, false, 'Café eSIM Pro-Max', 1, 1);
SELECT pg_temp.assert_suggestion_case('anon >1', 'Pixel Exact', '7f9d0e12-1000-4000-8000-000000000101', 1.1, false, NULL, 0);
SELECT pg_temp.assert_suggestion_case('anon NULL threshold', 'Pixel Exact', '7f9d0e12-1000-4000-8000-000000000101', NULL, false, NULL, 0);
SELECT pg_temp.assert_suggestion_case('anon archived status', 'Archived Only Match', '7f9d0e12-1000-4000-8000-000000000101', .35, false, NULL, 0);
SELECT pg_temp.assert_suggestion_case('anon no match', 'zzzzzzzz', '7f9d0e12-1000-4000-8000-000000000101', .35, false, NULL, 0);
SELECT pg_temp.assert_suggestion_case('anon merchant B', 'Merchant B Exclusive', '7f9d0e12-1000-4000-8000-000000000102', 1, false, 'Merchant B Exclusive', 1, 1);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '7f9d0e12-1000-4000-8000-000000000001', true);
SET LOCAL pg_trgm.similarity_threshold = 0.25;
SELECT pg_temp.assert_suggestion_case('auth .28 parity', 'Samsng Ult', '7f9d0e12-1000-4000-8000-000000000101', .28);
SELECT pg_temp.assert_suggestion_case('auth .30 parity', 'Samsng Ult', '7f9d0e12-1000-4000-8000-000000000101', .30);
SELECT pg_temp.assert_suggestion_case('auth .35 typo', 'Samsng Galxy', '7f9d0e12-1000-4000-8000-000000000101', .35);
SELECT pg_temp.assert_suggestion_case('auth exact 1', 'Pixel Exact', '7f9d0e12-1000-4000-8000-000000000101', 1, false, 'Pixel Exact', 1, 1);
SELECT pg_temp.assert_suggestion_case('auth merchant isolation', 'Merchant B Exclusive', '7f9d0e12-1000-4000-8000-000000000101', .35, false, NULL, 0);
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SET LOCAL pg_trgm.similarity_threshold = 0.40;
SELECT pg_temp.assert_suggestion_case('service .35 fallback', 'Samsng Galxy', '7f9d0e12-1000-4000-8000-000000000101', .35);
SELECT pg_temp.assert_suggestion_case('service NULL search 0', NULL, '7f9d0e12-1000-4000-8000-000000000101', 0);
SELECT pg_temp.assert_suggestion_case('service archived in B', 'Samsung Galaxy S24 Ultra', '7f9d0e12-1000-4000-8000-000000000102', .35, false, NULL, 0);
RESET ROLE;

ROLLBACK;
