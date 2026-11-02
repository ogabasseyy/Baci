-- Regression test for 20261102130000_link_external_gigl_waybill.sql.
--
-- Staff can attach a GIG waybill booked in GIG's own app to an order. Only the
-- proof-gated SECURITY DEFINER RPC may create such an "external_manual"
-- shipment; clients cannot set funding_source, and one live shipment may hold
-- a waybill.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/gigl_external_waybill_link.sql

BEGIN;

DO $$
DECLARE
  v_rpc regprocedure :=
    pg_catalog.to_regprocedure('public.link_external_gigl_waybill(uuid,jsonb)');
  v_index_definition text;
BEGIN
  IF v_rpc IS NULL THEN
    RAISE EXCEPTION 'public.link_external_gigl_waybill(uuid,jsonb) is missing';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_rpc) THEN
    RAISE EXCEPTION 'link_external_gigl_waybill must be SECURITY DEFINER';
  END IF;
  IF NOT COALESCE(
    (SELECT 'search_path=""' = ANY (proconfig)
     FROM pg_catalog.pg_proc WHERE oid = v_rpc),
    false
  ) THEN
    RAISE EXCEPTION 'link_external_gigl_waybill must pin an empty search_path';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_rpc, 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute link_external_gigl_waybill';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS proc
    CROSS JOIN LATERAL pg_catalog.aclexplode(proc.proacl) AS acl
    WHERE proc.oid = v_rpc AND acl.grantee = 0
  ) THEN
    RAISE EXCEPTION 'PUBLIC must not execute link_external_gigl_waybill';
  END IF;
  IF NOT pg_catalog.has_function_privilege('authenticated', v_rpc, 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated must execute the proof-gated link RPC';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'shipments'
      AND column_name = 'funding_source'
      AND is_nullable = 'NO'
      AND column_default = '''baci_booking''::text'
  ) THEN
    RAISE EXCEPTION 'shipments.funding_source must default to baci_booking';
  END IF;
  IF pg_catalog.has_column_privilege(
       'authenticated', 'public.shipments', 'funding_source', 'INSERT'
     )
     OR pg_catalog.has_column_privilege(
       'authenticated', 'public.shipments', 'funding_source', 'UPDATE'
     ) THEN
    RAISE EXCEPTION 'clients must not write shipments.funding_source';
  END IF;
  IF NOT pg_catalog.has_column_privilege(
    'authenticated', 'public.shipments', 'funding_source', 'SELECT'
  ) THEN
    RAISE EXCEPTION 'authenticated must read shipments.funding_source';
  END IF;

  SELECT pg_catalog.pg_get_indexdef(index_class.oid) INTO v_index_definition
  FROM pg_catalog.pg_class AS index_class
  JOIN pg_catalog.pg_index AS index_meta ON index_meta.indexrelid = index_class.oid
  WHERE index_class.relname = 'shipments_provider_tracking_number_live_key'
    AND index_meta.indisunique;
  IF v_index_definition IS NULL
     OR v_index_definition NOT LIKE '%(provider, upper(btrim(tracking_number)))%'
     OR v_index_definition NOT LIKE '%status <> ''cancelled''%'
     OR v_index_definition NOT LIKE '%provider = ''GIGL''%' THEN
    RAISE EXCEPTION 'waybill uniqueness index is missing or changed: %',
      v_index_definition;
  END IF;
END
$$;

ROLLBACK;
