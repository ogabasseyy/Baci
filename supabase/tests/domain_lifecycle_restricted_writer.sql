-- Contract test for the Cloudflare for SaaS multi-tenant domain lifecycle
-- and restricted writer boundary.
-- Run after chronological migration replay:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/domain_lifecycle_restricted_writer.sql

BEGIN;

DO $privileges$
DECLARE
  v_fn text;
  v_fns constant text[] := ARRAY[
    'domain_lifecycle_private.claim_due_domain_bindings(integer,integer)',
    'domain_lifecycle_private.record_domain_provider_result(uuid,uuid,text,text,text,text,jsonb,integer)',
    'domain_lifecycle_private.advance_domain_to_verifying_routing(uuid,uuid)',
    'domain_lifecycle_private.commit_domain_active(uuid,uuid)',
    'domain_lifecycle_private.withdraw_domain_verifying_routing(uuid,uuid)',
    'domain_lifecycle_private.finalize_domain_deletion(uuid,uuid,boolean)',
    'domain_lifecycle_private.list_active_saas_purge_targets(uuid)'
  ];
BEGIN
  FOREACH v_fn IN ARRAY v_fns LOOP
    IF NOT pg_catalog.has_function_privilege('baci_domain_lifecycle_writer', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'baci_domain_lifecycle_writer missing EXECUTE on %', v_fn;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
      OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
      OR pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE')
    THEN
      RAISE EXCEPTION 'unauthorized role has EXECUTE on %', v_fn;
    END IF;
  END LOOP;

  IF pg_catalog.has_table_privilege('baci_domain_lifecycle_writer', 'public.domain_provider_bindings', 'SELECT')
    OR pg_catalog.has_table_privilege('baci_domain_lifecycle_writer', 'public.domain_provider_bindings', 'INSERT')
    OR pg_catalog.has_table_privilege('baci_domain_lifecycle_writer', 'public.domain_provider_bindings', 'UPDATE')
    OR pg_catalog.has_table_privilege('baci_domain_lifecycle_writer', 'public.domain_provider_bindings', 'DELETE')
    OR pg_catalog.has_table_privilege('baci_domain_lifecycle_writer', 'public.domains', 'UPDATE')
    OR pg_catalog.has_table_privilege('baci_domain_lifecycle_writer', 'public.domains', 'DELETE')
  THEN
    RAISE EXCEPTION 'baci_domain_lifecycle_writer must not hold direct table privileges';
  END IF;

  IF pg_catalog.has_table_privilege('authenticated', 'public.domain_provider_bindings', 'INSERT')
    OR pg_catalog.has_table_privilege('authenticated', 'public.domain_provider_bindings', 'UPDATE')
    OR pg_catalog.has_table_privilege('authenticated', 'public.domain_provider_bindings', 'DELETE')
  THEN
    RAISE EXCEPTION 'authenticated must not hold write privileges on domain_provider_bindings';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'baci_domain_lifecycle_writer'
      AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)
  ) THEN
    RAISE EXCEPTION 'baci_domain_lifecycle_writer must remain a non-login least-privilege role';
  END IF;
END;
$privileges$;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
VALUES
  ('97110000-0000-4000-8000-000000000101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'saas-owner-pro@example.test', 'test', now(), now(), now(), '{}', '{}'),
  ('97110000-0000-4000-8000-000000000102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'saas-owner-free@example.test', 'test', now(), now(), now(), '{}', '{}'),
  ('97110000-0000-4000-8000-000000000103', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'saas-staff-allowed@example.test', 'test', now(), now(), now(), '{}', '{}'),
  ('97110000-0000-4000-8000-000000000104', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'saas-staff-denied@example.test', 'test', now(), now(), now(), '{}', '{}');

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO public.merchants (id, user_id, email, business_name, slug, plan_tier)
VALUES
  ('97110000-0000-4000-8000-000000000001', '97110000-0000-4000-8000-000000000101', 'saas-owner-pro@example.test', 'SaaS Pro Shop', 'saas-pro-shop', 'pro'),
  ('97110000-0000-4000-8000-000000000002', '97110000-0000-4000-8000-000000000102', 'saas-owner-free@example.test', 'SaaS Free Shop', 'saas-free-shop', 'free');

INSERT INTO public.staff_members (merchant_id, user_id, email, role, status, permissions)
VALUES
  ('97110000-0000-4000-8000-000000000001', '97110000-0000-4000-8000-000000000103', 'saas-staff-allowed@example.test', 'manager', 'active', '{"settings":{"edit":true,"view":true}}'::jsonb),
  ('97110000-0000-4000-8000-000000000001', '97110000-0000-4000-8000-000000000104', 'saas-staff-denied@example.test', 'customer_service', 'active', '{"settings":{"edit":false,"view":false}}'::jsonb);

-- Existing primary domain on Pro merchant to exercise unique primary index
INSERT INTO public.domains (
  id, merchant_id, domain, tld, domain_type, status, ssl_status, is_primary, verified_at
)
VALUES (
  '97110000-0000-4000-8000-000000000301',
  '97110000-0000-4000-8000-000000000001',
  'existing-primary.example.com',
  '.com',
  'custom',
  'active',
  'active',
  true,
  now()
);

RESET ROLE;

-- 1. Ineligible free merchant must be rejected
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub', '97110000-0000-4000-8000-000000000102', true);
DO $test_free$
DECLARE v_rejected boolean := false;
BEGIN
  BEGIN
    PERFORM public.reserve_merchant_domain_onboarding('free-shop.example.com', false);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'free merchant should not reserve a custom domain';
  END IF;
END;
$test_free$;

-- 2. Staff without settings.edit must be rejected
SELECT pg_catalog.set_config('request.jwt.claim.sub', '97110000-0000-4000-8000-000000000104', true);
DO $test_staff_denied$
DECLARE v_rejected boolean := false;
BEGIN
  BEGIN
    PERFORM public.reserve_merchant_domain_onboarding('denied-staff.example.com', false);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'staff without settings.edit should be rejected';
  END IF;
END;
$test_staff_denied$;

-- 3. Staff with settings.edit can reserve a new primary candidate alongside existing primary
SELECT pg_catalog.set_config('request.jwt.claim.sub', '97110000-0000-4000-8000-000000000103', true);
DO $test_reserve_and_guard$
DECLARE
  v_res jsonb;
  v_domain_id uuid;
  v_parent_blocked boolean := false;
BEGIN
  v_res := public.reserve_merchant_domain_onboarding('pilot-saas.example.com', true);
  IF v_res->>'status' <> 'reserved' THEN
    RAISE EXCEPTION 'expected reserved status, got %', v_res;
  END IF;
  v_domain_id := (v_res->>'domain_id')::uuid;

  -- Direct client UPDATE to SaaS-bound parent domain must be rejected by trigger
  BEGIN
    UPDATE public.domains SET status = 'active' WHERE id = v_domain_id;
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_parent_blocked := true;
  END;
  IF NOT v_parent_blocked THEN
    RAISE EXCEPTION 'direct UPDATE to SaaS-bound domains.status was not blocked';
  END IF;
END;
$test_reserve_and_guard$;

-- 4. Exercise restricted writer role: claim exclusivity, activation swap, deletion fence
RESET ROLE;
DO $create_writer_login$
BEGIN
  CREATE ROLE baci_domain_lifecycle_provisioner
    LOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
  GRANT baci_domain_lifecycle_writer TO baci_domain_lifecycle_provisioner;
  EXECUTE format('GRANT baci_domain_lifecycle_provisioner TO %I', current_user);
END;
$create_writer_login$;

-- Expire the initial reservation lease so the reconciler claim can take over
UPDATE public.domain_provider_bindings
SET in_flight_lease_until = now() - interval '5 seconds',
    next_reconcile_at = now() - interval '5 seconds'
WHERE hostname = 'pilot-saas.example.com';

SET LOCAL ROLE baci_domain_lifecycle_provisioner;
DO $test_writer_flow$
DECLARE
  v_claim1 public.domain_provider_bindings%ROWTYPE;
  v_claim2_count int;
  v_binding public.domain_provider_bindings%ROWTYPE;
  v_verify_op uuid := gen_random_uuid();
  v_deleted boolean;
BEGIN
  SELECT * INTO v_claim1 FROM domain_lifecycle_private.claim_due_domain_bindings(10, 30) LIMIT 1;
  IF v_claim1.id IS NULL THEN
    RAISE EXCEPTION 'expected Worker A to claim the due binding';
  END IF;

  -- Worker B calling immediately after Worker A must receive 0 rows (lease + next_reconcile_at advanced)
  SELECT count(*) INTO v_claim2_count FROM domain_lifecycle_private.claim_due_domain_bindings(10, 30);
  IF v_claim2_count <> 0 THEN
    RAISE EXCEPTION 'Worker B claimed % rows while Worker A lease is active', v_claim2_count;
  END IF;

  -- Confirm both providers
  v_binding := domain_lifecycle_private.record_domain_provider_result(
    v_claim1.domain_id, v_claim1.current_operation_id, 'cloudflare', 'confirmed',
    'zone_test_1', 'cf_host_1', '[]'::jsonb, NULL
  );
  v_binding := domain_lifecycle_private.record_domain_provider_result(
    v_claim1.domain_id, v_claim1.current_operation_id, 'vercel', 'confirmed',
    NULL, NULL, NULL, NULL
  );
  IF v_binding.lifecycle_state <> 'pending_verification' THEN
    RAISE EXCEPTION 'expected pending_verification, got %', v_binding.lifecycle_state;
  END IF;

  -- Advance to verifying_routing then commit_domain_active
  v_binding := domain_lifecycle_private.advance_domain_to_verifying_routing(v_claim1.domain_id, v_verify_op);
  v_binding := domain_lifecycle_private.commit_domain_active(v_claim1.domain_id, v_verify_op);
  IF v_binding.lifecycle_state <> 'active' THEN
    RAISE EXCEPTION 'expected active lifecycle_state, got %', v_binding.lifecycle_state;
  END IF;
END;
$test_writer_flow$;

RESET ROLE;

-- Verify atomic primary swap + status/ssl_status/verified_at on public.domains
DO $verify_primary_swap$
DECLARE
  v_old_primary boolean;
  v_new_row record;
BEGIN
  SELECT is_primary INTO v_old_primary
  FROM public.domains WHERE id = '97110000-0000-4000-8000-000000000301';
  SELECT status, ssl_status, verified_at, is_primary INTO v_new_row
  FROM public.domains WHERE domain = 'pilot-saas.example.com';

  IF v_old_primary IS NOT FALSE THEN
    RAISE EXCEPTION 'previous primary domain was not demoted during atomic swap';
  END IF;
  IF v_new_row.status <> 'active' OR v_new_row.ssl_status <> 'active'
    OR v_new_row.verified_at IS NULL OR v_new_row.is_primary IS NOT TRUE
  THEN
    RAISE EXCEPTION 'new primary domain missing active/ssl/verified_at/is_primary fields';
  END IF;
END;
$verify_primary_swap$;

-- 5. Deletion fence: refuse release while a provider is indeterminate, release once terminal
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub', '97110000-0000-4000-8000-000000000101', true);
DO $request_delete$
DECLARE v_del jsonb;
BEGIN
  v_del := public.request_merchant_domain_deletion('pilot-saas.example.com');
  IF v_del->>'status' <> 'deleting' THEN
    RAISE EXCEPTION 'expected deleting status, got %', v_del;
  END IF;
END;
$request_delete$;

RESET ROLE;
SET LOCAL ROLE baci_domain_lifecycle_provisioner;
DO $test_delete_fence$
DECLARE
  v_binding public.domain_provider_bindings%ROWTYPE;
  v_released boolean;
BEGIN
  -- Expire lease is not needed if we fetch current_operation_id via claim after expiry;
  -- first force expiry outside this block? We can just test after resetting role.
  NULL;
END;
$test_delete_fence$;

RESET ROLE;
UPDATE public.domain_provider_bindings
SET in_flight_lease_until = now() - interval '5 seconds',
    next_reconcile_at = now() - interval '5 seconds'
WHERE hostname = 'pilot-saas.example.com';

SET LOCAL ROLE baci_domain_lifecycle_provisioner;
DO $test_delete_indeterminate$
DECLARE
  v_claim public.domain_provider_bindings%ROWTYPE;
  v_released boolean;
BEGIN
  SELECT * INTO v_claim FROM domain_lifecycle_private.claim_due_domain_bindings(10, 30) LIMIT 1;
  PERFORM domain_lifecycle_private.record_domain_provider_result(
    v_claim.domain_id, v_claim.current_operation_id, 'vercel', 'deleted', NULL, NULL, NULL, NULL
  );
  PERFORM domain_lifecycle_private.record_domain_provider_result(
    v_claim.domain_id, v_claim.current_operation_id, 'cloudflare', 'indeterminate', NULL, NULL, NULL, 120
  );

  v_released := domain_lifecycle_private.finalize_domain_deletion(
    v_claim.domain_id, v_claim.current_operation_id, false
  );
  IF v_released IS NOT FALSE THEN
    RAISE EXCEPTION 'finalize_domain_deletion must refuse release while cloudflare is indeterminate';
  END IF;

  -- Once Cloudflare settles as deleted, release succeeds
  PERFORM domain_lifecycle_private.record_domain_provider_result(
    v_claim.domain_id, v_claim.current_operation_id, 'cloudflare', 'deleted', NULL, NULL, NULL, NULL
  );
  v_released := domain_lifecycle_private.finalize_domain_deletion(
    v_claim.domain_id, v_claim.current_operation_id, false
  );
  IF v_released IS NOT TRUE THEN
    RAISE EXCEPTION 'finalize_domain_deletion must release hostname once both providers are deleted';
  END IF;
END;
$test_delete_indeterminate$;

ROLLBACK;
