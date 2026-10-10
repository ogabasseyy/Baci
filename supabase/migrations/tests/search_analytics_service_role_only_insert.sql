-- Regression contract for 20261009120000_search_analytics_service_role_only_insert.sql.
-- Proves the submissions endpoint is the only ingestion path: direct writes
-- are denied for anon/authenticated while the owning merchant can still read.
-- Usage: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f \
--   supabase/migrations/tests/search_analytics_service_role_only_insert.sql

BEGIN;

CREATE FUNCTION pg_temp.assert_true(p_condition boolean, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_condition IS DISTINCT FROM true THEN RAISE EXCEPTION '%', p_message; END IF;
END;
$$;

-- The open INSERT policy is gone; the merchant SELECT policy remains.
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'search_analytics'
      AND policyname = 'Anyone can insert search analytics'
  ),
  'open search_analytics INSERT policy still exists'
);

SELECT pg_temp.assert_true(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'search_analytics'
      AND policyname = 'Merchants can view their own search analytics'
  ),
  'merchant search_analytics SELECT policy is missing'
);

-- Grants: no writes for the PostgREST roles, SELECT-only for authenticated,
-- full access retained for service_role.
SELECT pg_temp.assert_true(
  NOT has_table_privilege('anon', 'public.search_analytics', 'INSERT')
  AND NOT has_table_privilege('anon', 'public.search_analytics', 'UPDATE')
  AND NOT has_table_privilege('anon', 'public.search_analytics', 'DELETE')
  AND NOT has_table_privilege('anon', 'public.search_analytics', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.search_analytics', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.search_analytics', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.search_analytics', 'DELETE')
  AND has_table_privilege('authenticated', 'public.search_analytics', 'SELECT')
  AND has_table_privilege('service_role', 'public.search_analytics', 'INSERT')
  AND has_table_privilege('service_role', 'public.search_analytics', 'UPDATE')
  AND has_table_privilege('service_role', 'public.search_analytics', 'DELETE')
  AND has_table_privilege('service_role', 'public.search_analytics', 'SELECT'),
  'search_analytics grants are incorrect'
);

-- Fixtures.
INSERT INTO public.merchants (id, email, business_name, slug, user_id)
VALUES (
  '03aa0000-0000-4000-8000-000000000001',
  'search-analytics-merchant@example.com',
  'Search Analytics Merchant',
  'search-analytics-merchant',
  '03aa0000-0000-4000-8000-000000000101'
);

INSERT INTO public.search_analytics (
  merchant_id, search_query, results_count, search_method
) VALUES (
  '03aa0000-0000-4000-8000-000000000001', 'phone', 27, 'client'
);

-- Live proof: direct INSERT fails on privileges for both PostgREST roles.
DO $$
DECLARE
  v_prior_role text := current_user;
BEGIN
  PERFORM set_config('role', 'anon', true);
  BEGIN
    INSERT INTO public.search_analytics (merchant_id, search_query)
    VALUES ('03aa0000-0000-4000-8000-000000000001', 'sneaky');
    RAISE EXCEPTION 'anon direct INSERT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    -- Expected: writes stay revoked.
    NULL;
  END;
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    INSERT INTO public.search_analytics (merchant_id, search_query)
    VALUES ('03aa0000-0000-4000-8000-000000000001', 'sneaky');
    RAISE EXCEPTION 'authenticated direct INSERT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    -- Expected: writes stay revoked.
    NULL;
  END;
  PERFORM set_config('role', v_prior_role, true);
END;
$$;

-- Live proof: the owning merchant still reads through the SELECT policy.
-- RLS applies to non-owners, so drop to authenticated for this check.
SELECT set_config('role', 'authenticated', true);
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated',
  'sub', '03aa0000-0000-4000-8000-000000000101')::text, true);

SELECT pg_temp.assert_true(
  (SELECT count(*) = 1
   FROM public.search_analytics
   WHERE merchant_id = '03aa0000-0000-4000-8000-000000000001'),
  'owning merchant cannot read search_analytics'
);

ROLLBACK;
