-- Run against a disposable database after all migrations; rolls back fixtures.
BEGIN;

INSERT INTO auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES
 ('f2ab0000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','oxygen-toggle-merchant@example.test','test',now(),now(),now(),'{}','{}');

SELECT pg_catalog.set_config('request.jwt.claim.sub', 'f2ab0000-0000-4000-8000-000000000001', true);
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO public.merchants(id, user_id, email, business_name, slug)
VALUES ('f2ab0000-0000-4000-8000-000000000011','f2ab0000-0000-4000-8000-000000000001','oxygen-toggle-merchant@example.test','Oxygen Toggle Store','oxygen-toggle-store');

INSERT INTO oxygen_private.partner_workers(partner_reference, worker_user_id)
VALUES ('oxygen-toggle-fixture', 'f2ab0000-0000-4000-8000-000000000001');

INSERT INTO oxygen_private.runtime_bindings(merchant_id, worker_user_id, partner_reference, environment, enabled)
VALUES ('f2ab0000-0000-4000-8000-000000000011','f2ab0000-0000-4000-8000-000000000001','oxygen-toggle-fixture','production',true);

INSERT INTO oxygen_private.production_admission_policy(merchant_id, mode)
VALUES ('f2ab0000-0000-4000-8000-000000000011','open');

-- New merchant defaults oxygen_enabled = false and hides Oxygen despite open runtime binding.
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

-- Authenticated merchant owner can SELECT and UPDATE oxygen_enabled (audited cleanly).
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
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

-- Disabling oxygen_enabled immediately disables availability without altering runtime_bindings.
UPDATE public.merchant_feature_settings
SET oxygen_enabled = false
WHERE merchant_id = 'f2ab0000-0000-4000-8000-000000000011';

DO $$ BEGIN
  IF public.oxygen_storefront_pilot_available('f2ab0000-0000-4000-8000-000000000011') THEN
    RAISE EXCEPTION 'Disabling oxygen_enabled must immediately hide Oxygen';
  END IF;
END $$;

ROLLBACK;
