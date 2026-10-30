-- REGRESSION TEST: dashboard-safe merchant identity verification capability.
--
-- Run against a local Supabase database after the ordered migration replay:
--   psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/merchant_identity_verified_rpc.sql
--
-- Fixtures are transactional: this script never leaves merchant or identity data behind.

BEGIN;

DO $fixtures$
DECLARE
  v_owner_id uuid := '11111111-1111-4111-8111-111111111112';
  v_active_staff_id uuid := '11111111-1111-4111-8111-111111111113';
  v_inactive_staff_id uuid := '11111111-1111-4111-8111-111111111114';
  v_stranger_id uuid := '11111111-1111-4111-8111-111111111115';
  v_merchant_id uuid := '11111111-1111-4111-8111-111111111111';
BEGIN
  INSERT INTO auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    created_at,
    updated_at,
    raw_app_meta_data,
    raw_user_meta_data
  )
  VALUES
    (v_owner_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
      'authenticated', 'identity-owner@example.test', 'test', now(), now(), now(), '{}', '{}'),
    (v_active_staff_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
      'authenticated', 'identity-active-staff@example.test', 'test', now(), now(), now(), '{}', '{}'),
    (v_inactive_staff_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
      'authenticated', 'identity-inactive-staff@example.test', 'test', now(), now(), now(), '{}', '{}'),
    (v_stranger_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
      'authenticated', 'identity-stranger@example.test', 'test', now(), now(), now(), '{}', '{}');

  INSERT INTO public.merchants (id, user_id, email, business_name, slug)
  VALUES (
    v_merchant_id,
    v_owner_id,
    'identity-readiness@example.test',
    'Identity Readiness Fixture',
    'identity-readiness-fixture'
  );

  INSERT INTO public.staff_members (
    merchant_id,
    user_id,
    email,
    name,
    role,
    permissions,
    status
  )
  VALUES
    (v_merchant_id, v_active_staff_id, 'identity-active-staff@example.test',
      'Active staff without settings.edit', 'accountant',
      '{"settings":{"edit":false}}'::jsonb, 'active'),
    (v_merchant_id, v_inactive_staff_id, 'identity-inactive-staff@example.test',
      'Inactive staff', 'accountant', '{"settings":{"edit":true}}'::jsonb,
      'suspended');

  INSERT INTO public.merchant_verifications (
    merchant_id,
    nin_verified,
    bvn_verified,
    cac_verified
  )
  VALUES (v_merchant_id, true, false, false);
END;
$fixtures$;

CREATE OR REPLACE FUNCTION pg_temp.assert_identity_verified(
  p_label text,
  p_claim_role text,
  p_user_id uuid,
  p_expected boolean
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_actual boolean;
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claim.role', p_claim_role, true);
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub', coalesce(p_user_id::text, ''), true
  );

  SELECT public.get_merchant_identity_verified(
    '11111111-1111-4111-8111-111111111111'::uuid
  )
  INTO v_actual;

  IF v_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION '% expected %, got %', p_label, p_expected, v_actual;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.assert_identity_verified(text, text, uuid, boolean) TO PUBLIC; -- called after SET ROLE

SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_identity_verified(
  'owner sees aggregate verified state',
  'authenticated',
  '11111111-1111-4111-8111-111111111112',
  true
);
SELECT pg_temp.assert_identity_verified(
  'active staff without settings.edit sees aggregate verified state',
  'authenticated',
  '11111111-1111-4111-8111-111111111113',
  true
);
RESET ROLE;

UPDATE public.merchant_verifications
SET nin_verified = false,
    bvn_verified = false,
    cac_verified = false
WHERE merchant_id = '11111111-1111-4111-8111-111111111111'::uuid;

SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_identity_verified(
  'owner receives false when every verification flag is false',
  'authenticated',
  '11111111-1111-4111-8111-111111111112',
  false
);
RESET ROLE;

UPDATE public.merchant_verifications
SET nin_verified = true
WHERE merchant_id = '11111111-1111-4111-8111-111111111111'::uuid;

SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_identity_verified(
  'inactive staff receives no privileged identity truth',
  'authenticated',
  '11111111-1111-4111-8111-111111111114',
  false
);
SELECT pg_temp.assert_identity_verified(
  'stranger receives no privileged identity truth',
  'authenticated',
  '11111111-1111-4111-8111-111111111115',
  false
);
RESET ROLE;

DO $assert_contract$
DECLARE
  v_authenticated_execute boolean;
  v_public_execute boolean;
  v_anon_execute boolean;
  v_anon_has_execute boolean;
  v_has_lookup_index boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.routine_privileges
    WHERE routine_schema = 'public'
      AND routine_name = 'get_merchant_identity_verified'
      AND grantee = 'authenticated'
      AND privilege_type = 'EXECUTE'
  ) INTO v_authenticated_execute;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.routine_privileges
    WHERE routine_schema = 'public'
      AND routine_name = 'get_merchant_identity_verified'
      AND grantee = 'PUBLIC'
      AND privilege_type = 'EXECUTE'
  ) INTO v_public_execute;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.routine_privileges
    WHERE routine_schema = 'public'
      AND routine_name = 'get_merchant_identity_verified'
      AND grantee = 'anon'
      AND privilege_type = 'EXECUTE'
  ) INTO v_anon_execute;

  -- EXECUTE is the sole privilege applicable to function calls. A false
  -- result proves anon has no callable capability without making this
  -- successful replay script emit an intentional permission error.
  SELECT pg_catalog.has_function_privilege(
    'anon',
    'public.get_merchant_identity_verified(uuid)',
    'EXECUTE'
  ) INTO v_anon_has_execute;

  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS c
    WHERE c.conrelid = 'public.merchant_verifications'::regclass
      AND c.conname = 'merchant_verifications_merchant_id_key'
      AND c.contype = 'u'
      AND c.conindid <> 0
  ) INTO v_has_lookup_index;

  IF NOT v_authenticated_execute
    OR v_public_execute
    OR v_anon_execute
    OR v_anon_has_execute THEN
    RAISE EXCEPTION
      'get_merchant_identity_verified execute grants invalid: authenticated=%, public=%, anon=%, anon_callable=%',
      v_authenticated_execute, v_public_execute, v_anon_execute,
      v_anon_has_execute;
  END IF;

  IF NOT v_has_lookup_index THEN
    RAISE EXCEPTION
      'merchant_verifications_merchant_id_key must remain the indexed merchant lookup constraint';
  END IF;
END;
$assert_contract$;

ROLLBACK;
