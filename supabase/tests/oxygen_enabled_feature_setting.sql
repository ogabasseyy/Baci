-- Run against a disposable database after all migrations; rolls back fixtures.
BEGIN;

INSERT INTO auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES
 ('f2ab0000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','oxygen-toggle-merchant@example.test','test',now(),now(),now(),'{}','{}'),
 ('f2ab0000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','oxygen-toggle-customer@example.test','test',now(),now(),now(),'{}','{}');

SELECT pg_catalog.set_config('request.jwt.claim.sub', 'f2ab0000-0000-4000-8000-000000000001', true);
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO public.merchants(id, user_id, email, business_name, slug)
VALUES ('f2ab0000-0000-4000-8000-000000000011','f2ab0000-0000-4000-8000-000000000001','oxygen-toggle-merchant@example.test','Oxygen Toggle Store','oxygen-toggle-store');

INSERT INTO public.customers(id, merchant_id, user_id, first_name, last_name, email)
VALUES ('f2ab0000-0000-4000-8000-000000000021','f2ab0000-0000-4000-8000-000000000011','f2ab0000-0000-4000-8000-000000000002','Oxygen','Customer','oxygen-toggle-customer@example.test');

INSERT INTO public.orders(id, merchant_id, customer_id, order_number, total, currency, payment_status, payment_method)
VALUES ('f2ab0000-0000-4000-8000-000000000031','f2ab0000-0000-4000-8000-000000000011','f2ab0000-0000-4000-8000-000000000021','OXYGEN-TOGGLE-1',400000,'NGN','unpaid','oxygen');

INSERT INTO oxygen_private.partner_workers(partner_reference, worker_user_id)
VALUES ('oxygen-toggle-fixture', 'f2ab0000-0000-4000-8000-000000000001');

INSERT INTO oxygen_private.runtime_bindings(merchant_id, worker_user_id, partner_reference, environment, enabled)
VALUES ('f2ab0000-0000-4000-8000-000000000011','f2ab0000-0000-4000-8000-000000000001','oxygen-toggle-fixture','production',true);

INSERT INTO oxygen_private.production_admission_policy(merchant_id, mode)
VALUES ('f2ab0000-0000-4000-8000-000000000011','open');

-- New merchant defaults oxygen_enabled = false, hides Oxygen despite open runtime
-- binding, and blocks new workflow creation in oxygen_start_workflow.
DO $$
DECLARE v_settings record;
BEGIN
  SELECT * INTO STRICT v_settings
  FROM public.get_storefront_payment_settings('f2ab0000-0000-4000-8000-000000000011');
  IF v_settings.oxygen_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Default oxygen_enabled must be false, got %', v_settings.oxygen_enabled;
  END IF;
  IF public.oxygen_storefront_pilot_available('f2ab0000-0000-4000-8000-000000000011') THEN
    RAISE EXCEPTION 'oxygen_storefront_pilot_available must fail closed when oxygen_enabled is false';
  END IF;
END $$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_catalog.set_config('request.jwt.claim.sub', 'f2ab0000-0000-4000-8000-000000000002', true);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"f2ab0000-0000-4000-8000-000000000002"}',
  true
);

DO $$ BEGIN
  BEGIN
    PERFORM public.oxygen_start_workflow('f2ab0000-0000-4000-8000-000000000031', 'web');
    RAISE EXCEPTION 'oxygen_start_workflow allowed new workflow while oxygen_enabled is false';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
END $$;

-- Authenticated merchant owner can SELECT and UPDATE oxygen_enabled (audited cleanly),
-- and public cache projection includes oxygen_enabled.
SELECT pg_catalog.set_config('request.jwt.claim.sub', 'f2ab0000-0000-4000-8000-000000000001', true);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"f2ab0000-0000-4000-8000-000000000001"}',
  true
);

UPDATE public.merchant_feature_settings
SET oxygen_enabled = true
WHERE merchant_id = 'f2ab0000-0000-4000-8000-000000000011';

DO $$
DECLARE v_enabled boolean; v_settings record;
BEGIN
  SELECT oxygen_enabled INTO STRICT v_enabled
  FROM public.merchant_feature_settings
  WHERE merchant_id = 'f2ab0000-0000-4000-8000-000000000011';
  IF v_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Authenticated owner update to oxygen_enabled=true failed';
  END IF;

  SELECT * INTO STRICT v_settings
  FROM public.get_storefront_payment_settings('f2ab0000-0000-4000-8000-000000000011');
  IF v_settings.oxygen_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'get_storefront_payment_settings did not reflect oxygen_enabled=true';
  END IF;

  IF NOT public.oxygen_storefront_pilot_available('f2ab0000-0000-4000-8000-000000000011') THEN
    RAISE EXCEPTION 'oxygen_storefront_pilot_available must allow when oxygen_enabled=true and admission=open';
  END IF;
END $$;

RESET ROLE;
DO $$
DECLARE v_row public.merchant_feature_settings%ROWTYPE; v_proj jsonb;
BEGIN
  SELECT * INTO STRICT v_row
  FROM public.merchant_feature_settings
  WHERE merchant_id = 'f2ab0000-0000-4000-8000-000000000011';
  v_proj := public.merchant_feature_settings_public_cache_projection(v_row);
  IF NOT (v_proj ? 'oxygen_enabled') OR (v_proj ->> 'oxygen_enabled')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'merchant_feature_settings_public_cache_projection omitted oxygen_enabled: %', v_proj;
  END IF;
END $$;
SET LOCAL ROLE authenticated;

-- Customer can start a workflow when oxygen_enabled = true.
SELECT pg_catalog.set_config('request.jwt.claim.sub', 'f2ab0000-0000-4000-8000-000000000002', true);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"f2ab0000-0000-4000-8000-000000000002"}',
  true
);

DO $$
DECLARE v_created jsonb;
BEGIN
  v_created := public.oxygen_start_workflow('f2ab0000-0000-4000-8000-000000000031', 'web');
  IF v_created ->> 'id' IS NULL OR v_created ->> 'order_id' IS DISTINCT FROM 'f2ab0000-0000-4000-8000-000000000031' THEN
    RAISE EXCEPTION 'oxygen_start_workflow failed to create workflow when oxygen_enabled=true';
  END IF;
  PERFORM pg_catalog.set_config('oxygen_test.workflow_id', v_created ->> 'id', true);
END $$;

-- Merchant disables oxygen_enabled: availability hides immediately, but the
-- existing owned workflow remains resumable.
SELECT pg_catalog.set_config('request.jwt.claim.sub', 'f2ab0000-0000-4000-8000-000000000001', true);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"f2ab0000-0000-4000-8000-000000000001"}',
  true
);

UPDATE public.merchant_feature_settings
SET oxygen_enabled = false
WHERE merchant_id = 'f2ab0000-0000-4000-8000-000000000011';

DO $$ BEGIN
  IF public.oxygen_storefront_pilot_available('f2ab0000-0000-4000-8000-000000000011') THEN
    RAISE EXCEPTION 'Disabling oxygen_enabled must immediately hide Oxygen';
  END IF;
END $$;

SELECT pg_catalog.set_config('request.jwt.claim.sub', 'f2ab0000-0000-4000-8000-000000000002', true);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"f2ab0000-0000-4000-8000-000000000002"}',
  true
);

DO $$
DECLARE v_resumed jsonb;
BEGIN
  v_resumed := public.oxygen_start_workflow('f2ab0000-0000-4000-8000-000000000031', 'web');
  IF v_resumed ->> 'id' IS DISTINCT FROM pg_catalog.current_setting('oxygen_test.workflow_id') THEN
    RAISE EXCEPTION 'Existing workflow did not remain resumable after oxygen_enabled=false';
  END IF;
END $$;

-- Resuming an existing workflow still delegates to oxygen_private.start_workflow,
-- preserving its 22023 payment_method guard when an order payment_method changes.
RESET ROLE;
ALTER TABLE public.orders DISABLE TRIGGER oxygen_order_payment_method_fence;
UPDATE public.orders
SET payment_method = 'paystack'
WHERE id = 'f2ab0000-0000-4000-8000-000000000031';
ALTER TABLE public.orders ENABLE TRIGGER oxygen_order_payment_method_fence;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub', 'f2ab0000-0000-4000-8000-000000000002', true);
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"f2ab0000-0000-4000-8000-000000000002"}',
  true
);

DO $$ BEGIN
  BEGIN
    PERFORM public.oxygen_start_workflow('f2ab0000-0000-4000-8000-000000000031', 'web');
    RAISE EXCEPTION 'oxygen_start_workflow bypassed payment_method guard on resume';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
END $$;

-- Behavioral backfill verification: confirm the one-time helper was dropped
-- (cannot override future merchant opt-outs) and execute the exact backfill SQL
-- with the service_role JWT shim against enabled-production (with and without an
-- existing feature-settings row), staging-only, and disabled-production bindings.
RESET ROLE;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);

DO $$ BEGIN
  IF to_regprocedure('private.backfill_oxygen_enabled_v1()') IS NOT NULL THEN
    RAISE EXCEPTION 'One-time backfill helper private.backfill_oxygen_enabled_v1() must be dropped after migration backfill';
  END IF;
END $$;

INSERT INTO auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES
 ('f2ab0000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000000','authenticated','authenticated','backfill-prod-norow@example.test','test',now(),now(),now(),'{}','{}'),
 ('f2ab0000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000000','authenticated','authenticated','backfill-prod-existing@example.test','test',now(),now(),now(),'{}','{}'),
 ('f2ab0000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000000','authenticated','authenticated','backfill-staging@example.test','test',now(),now(),now(),'{}','{}'),
 ('f2ab0000-0000-4000-8000-000000000104','00000000-0000-4000-8000-000000000000','authenticated','authenticated','backfill-disabled@example.test','test',now(),now(),now(),'{}','{}');

INSERT INTO public.merchants(id, user_id, email, business_name, slug)
VALUES
 ('f2ab0000-0000-4000-8000-000000000201','f2ab0000-0000-4000-8000-000000000101','backfill-prod-norow@example.test','Prod No Row','backfill-prod-norow'),
 ('f2ab0000-0000-4000-8000-000000000202','f2ab0000-0000-4000-8000-000000000102','backfill-prod-existing@example.test','Prod Existing','backfill-prod-existing'),
 ('f2ab0000-0000-4000-8000-000000000203','f2ab0000-0000-4000-8000-000000000103','backfill-staging@example.test','Staging Only','backfill-staging'),
 ('f2ab0000-0000-4000-8000-000000000204','f2ab0000-0000-4000-8000-000000000104','backfill-disabled@example.test','Disabled Prod','backfill-disabled');

-- Remove the auto-seeded row for merchant 201 to exercise the INSERT backfill path
-- through the closed-world audit trigger.
DELETE FROM public.merchant_feature_settings
WHERE merchant_id = 'f2ab0000-0000-4000-8000-000000000201';

UPDATE public.merchant_feature_settings
SET oxygen_enabled = false
WHERE merchant_id IN (
  'f2ab0000-0000-4000-8000-000000000202',
  'f2ab0000-0000-4000-8000-000000000203',
  'f2ab0000-0000-4000-8000-000000000204'
);

INSERT INTO oxygen_private.partner_workers(partner_reference, worker_user_id)
VALUES
 ('backfill-worker-1', 'f2ab0000-0000-4000-8000-000000000101'),
 ('backfill-worker-2', 'f2ab0000-0000-4000-8000-000000000102'),
 ('backfill-worker-3', 'f2ab0000-0000-4000-8000-000000000103'),
 ('backfill-worker-4', 'f2ab0000-0000-4000-8000-000000000104');

INSERT INTO oxygen_private.runtime_bindings(merchant_id, worker_user_id, partner_reference, environment, enabled)
VALUES
 ('f2ab0000-0000-4000-8000-000000000201','f2ab0000-0000-4000-8000-000000000101','backfill-worker-1','production',true),
 ('f2ab0000-0000-4000-8000-000000000202','f2ab0000-0000-4000-8000-000000000102','backfill-worker-2','production',true),
 ('f2ab0000-0000-4000-8000-000000000203','f2ab0000-0000-4000-8000-000000000103','backfill-worker-3','staging',true),
 ('f2ab0000-0000-4000-8000-000000000204','f2ab0000-0000-4000-8000-000000000104','backfill-worker-4','production',false);

INSERT INTO public.merchant_feature_settings (merchant_id, oxygen_enabled)
SELECT b.merchant_id, true
FROM oxygen_private.runtime_bindings AS b
WHERE b.enabled IS TRUE
  AND b.environment = 'production'
ON CONFLICT (merchant_id) DO UPDATE
  SET oxygen_enabled = true
  WHERE public.merchant_feature_settings.oxygen_enabled IS DISTINCT FROM true;

DO $$
DECLARE
  v_201 boolean;
  v_202 boolean;
  v_203 boolean;
  v_204 boolean;
BEGIN
  SELECT oxygen_enabled INTO STRICT v_201 FROM public.merchant_feature_settings WHERE merchant_id = 'f2ab0000-0000-4000-8000-000000000201';
  SELECT oxygen_enabled INTO STRICT v_202 FROM public.merchant_feature_settings WHERE merchant_id = 'f2ab0000-0000-4000-8000-000000000202';
  SELECT oxygen_enabled INTO STRICT v_203 FROM public.merchant_feature_settings WHERE merchant_id = 'f2ab0000-0000-4000-8000-000000000203';
  SELECT oxygen_enabled INTO STRICT v_204 FROM public.merchant_feature_settings WHERE merchant_id = 'f2ab0000-0000-4000-8000-000000000204';

  IF v_201 IS DISTINCT FROM true OR v_202 IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Backfill failed to enable production merchants: %, %', v_201, v_202;
  END IF;
  IF v_203 IS DISTINCT FROM false OR v_204 IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Backfill enabled non-production or disabled merchant: %, %', v_203, v_204;
  END IF;
END $$;

ROLLBACK;
