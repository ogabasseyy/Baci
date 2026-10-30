-- Disposable full-history replay assertions. No provider request is made.
BEGIN;
DO $$
DECLARE selected_role text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='address_budget_reserver'
    AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolinherit) THEN
    RAISE EXCEPTION 'Unsafe address reservation role';
  END IF;
  IF NOT pg_has_role('authenticator','address_budget_reserver','MEMBER') THEN
    RAISE EXCEPTION 'Address reservation membership missing after staged grant';
  END IF;
  FOREACH selected_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_function_privilege(selected_role,'public.reserve_address_provider_request()','EXECUTE')
      OR has_schema_privilege(selected_role,'address_budget','USAGE') THEN
      RAISE EXCEPTION 'Unexpected address budget access for %', selected_role;
    END IF;
  END LOOP;
  IF has_table_privilege('address_budget_reserver','address_budget.authorizations','INSERT,UPDATE,DELETE')
    OR has_table_privilege('address_budget_reserver','address_budget.reservations','UPDATE,DELETE')
    OR has_table_privilege('address_budget_reserver','public.orders','SELECT')
    OR has_function_privilege('address_budget_reserver',
      'address_budget.authorize_provider(text,text,text[],integer,text,timestamptz,timestamptz)','EXECUTE') THEN
    RAISE EXCEPTION 'Address reservation role can change allowance/history or access orders';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='address_budget' AND c.relname IN ('authorizations','reservations')
      AND NOT c.relrowsecurity) THEN
    RAISE EXCEPTION 'Address ledger RLS is not enabled';
  END IF;
END $$;

SET LOCAL ROLE address_budget_reserver;
SELECT set_config('request.jwt.claims',jsonb_build_object(
  'role','address_budget_reserver','address_provider','google','address_request_kind','autocomplete',
  'address_credential_hash',repeat('a',64),'address_reservation_id','00000000-0000-4000-8000-000000000001',
  'iat',floor(extract(epoch FROM clock_timestamp())),
  'exp',floor(extract(epoch FROM clock_timestamp()))+60)::text,true);
DO $$ BEGIN
  IF public.reserve_address_provider_request()->>'status' <> 'unavailable' THEN
    RAISE EXCEPTION 'Unverified address allowance must remain unavailable';
  END IF;
END $$;
RESET ROLE;
SELECT set_config('request.method','POST',true);
SELECT set_config('request.path','/rpc/reserve_address_provider_request',true);
SELECT public.enforce_gigl_tracking_worker_request_scope();
SELECT set_config('request.path','/rpc/get_order_tracking',true);
DO $$ BEGIN
  BEGIN
    PERFORM public.enforce_gigl_tracking_worker_request_scope();
    RAISE EXCEPTION 'Address token reached unrelated RPC';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'Address budget request is outside its capability scope' THEN RAISE; END IF;
  END;
END $$;
ROLLBACK;
