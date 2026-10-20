-- Run with psql -v ON_ERROR_STOP=1 against a disposable migrated database.
BEGIN;
SELECT set_config('app.audit_actor_user_id', '4d19ab10-0000-4000-8000-000000000099', true);
INSERT INTO auth.users(id, email) VALUES
 ('4d19ab10-0000-4000-8000-000000000099', 'cart-hints-test@example.com');
INSERT INTO public.merchants(id,user_id,email,business_name,slug,is_published,premium_features)
VALUES
 ('4d19ab10-0000-4000-8000-000000000001','4d19ab10-0000-4000-8000-000000000099',
 'cart-hints-test@example.com','Cart hints','storefront-snapshot-test',true,
 '["shared_cart","shared_cart_realtime","private-feature"]'::jsonb),
 ('4d19ab10-0000-4000-8000-000000000012',NULL,
 'cart-hints-draft@example.com','Draft cart hints','storefront-unpublished-snapshot-test',false,
 '["shared_cart","shared_cart_accounts","shared_cart_realtime"]'::jsonb);
INSERT INTO public.domains(merchant_id,domain,domain_type,status,is_primary)
VALUES ('4d19ab10-0000-4000-8000-000000000001','cart-hints-test.usebaci.com','subdomain','active',true);
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.role', 'anon', true);
DO $test$
DECLARE data jsonb;
BEGIN
  SELECT merchant_data INTO STRICT data
  FROM public.resolve_storefront_public_snapshot_v2(' CART-HINTS-TEST.USEBACI.COM ');
  IF data->'shared_cart_enabled' IS DISTINCT FROM 'true'::jsonb
    OR data->'shared_cart_accounts_enabled' IS DISTINCT FROM 'false'::jsonb
    OR data->'shared_cart_realtime_enabled' IS DISTINCT FROM 'true'::jsonb
  THEN RAISE EXCEPTION 'public cart hints lost exact pilot enrollment'; END IF;
  IF data ? 'premium_features' OR data ? 'plan_tier' THEN
    RAISE EXCEPTION 'raw merchant entitlements leaked';
  END IF;
  SELECT merchant_data INTO STRICT data
  FROM public.resolve_storefront_public_snapshot_v2('storefront-unpublished-snapshot-test');
  IF data ? 'shared_cart_enabled' OR data ? 'shared_cart_accounts_enabled'
    OR data ? 'shared_cart_realtime_enabled' THEN
    RAISE EXCEPTION 'unpublished merchant exposed cart capabilities';
  END IF;
END;
$test$;
-- Wildcards, case changes and malformed JSON must not enroll another tenant.
RESET ROLE;
-- The canonical writer rejects these values. Verify that boundary first,
-- then stage a legacy row with only this trigger disabled in this rollback-
-- only fixture. Restore the guard before testing the anonymous read.
DO $guard$
BEGIN
  BEGIN
    UPDATE public.merchants SET premium_features = '["SHARED_CART"]'::jsonb
    WHERE id = '4d19ab10-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'canonical feature guard accepted non-exact enrollment';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
END;
$guard$;
ALTER TABLE public.merchants DISABLE TRIGGER commerce_cart_canonical_features_guard;
UPDATE public.merchants SET premium_features = '["all_features","SHARED_CART"," shared_cart "]'::jsonb
WHERE id = '4d19ab10-0000-4000-8000-000000000001';
ALTER TABLE public.merchants ENABLE TRIGGER commerce_cart_canonical_features_guard;
SET LOCAL ROLE anon;
DO $test$
DECLARE data jsonb;
BEGIN
  SELECT merchant_data INTO STRICT data
  FROM public.resolve_storefront_public_snapshot_v2('storefront-snapshot-test');
  IF data->'shared_cart_enabled' IS DISTINCT FROM 'false'::jsonb THEN
    RAISE EXCEPTION 'non-exact enrollment enabled public cart';
  END IF;
END;
$test$;
RESET ROLE;
DO $test$
DECLARE features jsonb; data jsonb;
BEGIN
  FOREACH features IN ARRAY ARRAY[NULL::jsonb, '[]'::jsonb, '{}'::jsonb,
    '{"shared_cart":true}'::jsonb, '"shared_cart"'::jsonb]
  LOOP
    UPDATE public.merchants SET premium_features = features
    WHERE id = '4d19ab10-0000-4000-8000-000000000001';
    SELECT merchant_data INTO STRICT data
    FROM public.resolve_storefront_public_snapshot_v2('storefront-snapshot-test');
    IF data->'shared_cart_enabled' IS DISTINCT FROM 'false'::jsonb
      OR data->'shared_cart_accounts_enabled' IS DISTINCT FROM 'false'::jsonb
      OR data->'shared_cart_realtime_enabled' IS DISTINCT FROM 'false'::jsonb THEN
      RAISE EXCEPTION 'malformed or absent enrollment did not fail closed';
    END IF;
  END LOOP;
END;
$test$;
ROLLBACK;
