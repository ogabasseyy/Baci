-- Regression coverage for anonymous/authenticated feature-setting policy scope.

BEGIN;

DO $contract$
DECLARE
  v_authenticated_roles name[];
  v_public_policy_count integer;
BEGIN
  SELECT pg_catalog.count(*) INTO v_public_policy_count
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'merchant_feature_settings'
    AND policyname = 'Public can read published merchant feature settings';

  SELECT roles INTO v_authenticated_roles
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'merchant_feature_settings'
    AND policyname = 'Unified view access for feature settings'
    AND permissive = 'PERMISSIVE'
    AND cmd = 'SELECT';

  IF v_public_policy_count <> 0 THEN
    RAISE EXCEPTION 'anonymous feature-settings policy still exists';
  END IF;
  IF v_authenticated_roles IS DISTINCT FROM ARRAY['authenticated']::name[] THEN
    RAISE EXCEPTION
      'owner/staff feature policy roles drifted: %', v_authenticated_roles;
  END IF;
  IF pg_catalog.has_table_privilege(
    'anon', 'public.merchant_feature_settings', 'SELECT'
  ) THEN
    RAISE EXCEPTION 'anonymous feature-settings SELECT grant still exists';
  END IF;
END;
$contract$;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
) VALUES
  ('ca0d0e12-0000-4000-8000-000000000001',
   '00000000-0000-0000-0000-000000000000', 'authenticated',
   'authenticated', 'feature-owner-a@example.com', 'test', now(), now(), now(),
   '{}', '{}'),
  ('ca0d0e12-0000-4000-8000-000000000002',
   '00000000-0000-0000-0000-000000000000', 'authenticated',
   'authenticated', 'feature-owner-b@example.com', 'test', now(), now(), now(),
   '{}', '{}'),
  ('ca0d0e12-0000-4000-8000-000000000003',
   '00000000-0000-0000-0000-000000000000', 'authenticated',
   'authenticated', 'feature-staff@example.com', 'test', now(), now(), now(),
   '{}', '{}'),
  ('ca0d0e12-0000-4000-8000-000000000004',
   '00000000-0000-0000-0000-000000000000', 'authenticated',
   'authenticated', 'feature-other@example.com', 'test', now(), now(), now(),
   '{}', '{}');

INSERT INTO public.merchants (
  id, user_id, email, business_name, slug, is_published
) VALUES
  ('ca0d0e12-0000-4000-8000-000000000101',
   'ca0d0e12-0000-4000-8000-000000000001',
   'feature-owner-a@example.com', 'Published Feature Fixture',
   'published-feature-fixture', true),
  ('ca0d0e12-0000-4000-8000-000000000102',
   'ca0d0e12-0000-4000-8000-000000000002',
   'feature-owner-b@example.com', 'Private Feature Fixture',
   'private-feature-fixture', false);

INSERT INTO public.staff_members (
  merchant_id, user_id, email, name, role, permissions, status
) VALUES (
  'ca0d0e12-0000-4000-8000-000000000101',
  'ca0d0e12-0000-4000-8000-000000000003',
  'feature-staff@example.com', 'Feature Staff', 'accountant', '{}', 'active'
);

UPDATE public.merchant_feature_settings
SET facebook_capi_token = 'must-never-be-public'
WHERE merchant_id = 'ca0d0e12-0000-4000-8000-000000000101';

CREATE FUNCTION pg_temp.assert_feature_setting_count(
  p_claim_role text,
  p_user_id uuid,
  p_expected integer
) RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_actual integer;
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claim.role', p_claim_role, true);
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub', COALESCE(p_user_id::text, ''), true
  );
  SELECT pg_catalog.count(*) INTO v_actual
  FROM public.merchant_feature_settings;
  IF v_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'expected % feature rows, got %', p_expected, v_actual;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.assert_feature_setting_count(text, uuid, integer) TO PUBLIC; -- called after SET ROLE

SET LOCAL ROLE anon;
DO $anonymous_access_denied$
DECLARE
  v_rejected boolean := false;
  v_secret text;
BEGIN
  BEGIN
    SELECT settings.facebook_capi_token INTO v_secret
    FROM public.merchant_feature_settings AS settings
    LIMIT 1;
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'anonymous user read private feature setting: %', v_secret;
  END IF;
END;
$anonymous_access_denied$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_feature_setting_count(
  'authenticated', 'ca0d0e12-0000-4000-8000-000000000002', 1
);
SELECT pg_temp.assert_feature_setting_count(
  'authenticated', 'ca0d0e12-0000-4000-8000-000000000003', 1
);
SELECT pg_temp.assert_feature_setting_count(
  'authenticated', 'ca0d0e12-0000-4000-8000-000000000004', 0
);
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT pg_temp.assert_feature_setting_count('service_role', NULL, 2);
RESET ROLE;

ROLLBACK;
