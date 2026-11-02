BEGIN;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
SELECT set_config('request.jwt.claim.role','anon',true);
DO $$
BEGIN
 BEGIN
  PERFORM public.get_storefront_offer_resolution(NULL,'{}'::uuid[]);
  RAISE EXCEPTION 'anonymous unscoped offer read accepted';
 EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM<>'merchant_scope_required' THEN RAISE;END IF;
 END;
 PERFORM public.get_storefront_offer_resolution('77777777-7777-4777-8777-777777777777','{}'::uuid[]);
END $$;
RESET ROLE;
-- A direct database session without claims is intentionally not an
-- unscoped authority caller, even when its login is postgres.
SELECT set_config('request.jwt.claims','',true);
SELECT set_config('request.jwt.claim.role','',true);
DO $$ BEGIN
 BEGIN
  PERFORM public.get_storefront_offer_resolution(NULL,'{}'::uuid[]);
  RAISE EXCEPTION 'claimless direct session accepted';
 EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM<>'merchant_scope_required' THEN RAISE; END IF;
 END;
END $$;
-- Verify the claim.role fallback independently of the JSON JWT claim.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
DO $$ BEGIN PERFORM public.get_storefront_offer_resolution(NULL,'{}'::uuid[]); END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.role','',true);
-- The database role fallback is needed for trusted SET ROLE contexts.
SET LOCAL ROLE service_role;
DO $$ BEGIN PERFORM public.get_storefront_offer_resolution(NULL,'{}'::uuid[]); END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN
  PERFORM public.get_storefront_offer_resolution(NULL,'{}'::uuid[]);
  RAISE EXCEPTION 'claimless anon accepted';
 EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM<>'merchant_scope_required' THEN RAISE; END IF;
 END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated"}',true);
DO $$ BEGIN PERFORM public.get_storefront_offer_resolution(NULL,'{}'::uuid[]); END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
DO $$ BEGIN
 PERFORM public.get_storefront_offer_resolution(NULL,'{}'::uuid[]);
 BEGIN
  PERFORM public.get_storefront_offer_resolution(NULL,(SELECT array_agg(gen_random_uuid()) FROM generate_series(1,201)));
  RAISE EXCEPTION 'privileged unscoped cap was removed';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
