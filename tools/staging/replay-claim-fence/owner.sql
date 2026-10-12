BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
DO $baci_claim_fence_owner$
DECLARE
  target oid;
  before_metadata jsonb;
  before_receipts jsonb;
  before_quarantine jsonb;
BEGIN
  IF session_user <> '__INSTALLER_LOGIN__' OR current_user <> session_user
    OR current_database() <> '__DATABASE__'
    OR NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = session_user AND rolsuper)
    OR (SELECT system_identifier::text FROM pg_catalog.pg_control_system())
      IS DISTINCT FROM '__SYSTEM_IDENTIFIER__'
    OR pg_catalog.clock_timestamp() >= '__DEADLINE__'::pg_catalog.timestamptz THEN
    RAISE EXCEPTION 'Claim fence owner scope refused';
  END IF;
  LOCK TABLE pg_catalog.pg_proc IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.piggyvest_staging_receipts,
    public.piggyvest_staging_replay_quarantine IN SHARE MODE;
  target := pg_catalog.to_regprocedure('__SIGNATURE__');
  IF target IS DISTINCT FROM __ROUTINE_OID__::oid OR NOT EXISTS (
    SELECT FROM pg_catalog.pg_proc routine
    JOIN pg_catalog.pg_language language ON language.oid = routine.prolang
    WHERE routine.oid = target
      AND pg_catalog.pg_get_userbyid(routine.proowner) = '__OWNER__'
      AND pg_catalog.to_jsonb(routine.proacl::text[]) IS NOT DISTINCT FROM __ACL__::jsonb
      AND routine.prosecdef AND routine.provolatile = 'v' AND language.lanname = 'plpgsql'
      AND routine.proconfig IS NOT DISTINCT FROM ARRAY['search_path=pg_catalog']
      AND encode(sha256(convert_to(routine.prosrc, 'UTF8')), 'hex') = '__BODY_SHA256__'
      AND encode(sha256(convert_to(pg_catalog.pg_get_functiondef(target), 'UTF8')), 'hex')
        = '__DEFINITION_SHA256__') THEN
    RAISE EXCEPTION 'Claim fence routine baseline refused';
  END IF;
  SELECT to_jsonb(routine) - 'prosrc' INTO STRICT before_metadata
    FROM pg_catalog.pg_proc routine WHERE oid = target;
  SELECT coalesce(jsonb_agg(to_jsonb(receipt) ORDER BY id), '[]'::jsonb)
    INTO before_receipts FROM public.piggyvest_staging_receipts receipt;
  SELECT coalesce(jsonb_agg(to_jsonb(entry) ORDER BY receipt_id), '[]'::jsonb)
    INTO before_quarantine FROM public.piggyvest_staging_replay_quarantine entry;
  IF pg_catalog.clock_timestamp() >= '__DEADLINE__'::pg_catalog.timestamptz THEN
    RAISE EXCEPTION 'Claim fence deadline refused';
  END IF;
  EXECUTE $baci_fenced_definition$__FENCED_DEFINITION__$baci_fenced_definition$;
  IF (SELECT to_jsonb(routine) - 'prosrc' FROM pg_catalog.pg_proc routine WHERE oid = target)
      IS DISTINCT FROM before_metadata
    OR encode(sha256(convert_to(pg_catalog.pg_get_functiondef(target), 'UTF8')), 'hex')
      IS DISTINCT FROM '__FENCED_DEFINITION_SHA256__'
    OR (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_catalog.pg_proc
      WHERE oid = target) IS DISTINCT FROM '__FENCED_BODY_SHA256__'
    OR (SELECT coalesce(jsonb_agg(to_jsonb(receipt) ORDER BY id), '[]'::jsonb)
      FROM public.piggyvest_staging_receipts receipt) IS DISTINCT FROM before_receipts
    OR (SELECT coalesce(jsonb_agg(to_jsonb(entry) ORDER BY receipt_id), '[]'::jsonb)
      FROM public.piggyvest_staging_replay_quarantine entry) IS DISTINCT FROM before_quarantine
    OR pg_catalog.clock_timestamp() >= '__DEADLINE__'::pg_catalog.timestamptz THEN
    RAISE EXCEPTION 'Claim fence postflight refused';
  END IF;
END;
$baci_claim_fence_owner$;
__FINISH__
