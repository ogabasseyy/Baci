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
