-- Part of piggyvest_webhook_durable_capture.sql (\ir): inline completion, immutable evidence, catalog-asserted denials, service_role capture.
-- Runs inside the entry file's transaction and session; not a standalone suite.

DO $$
DECLARE
  v_id uuid;
BEGIN
  v_id := (public.capture_piggyvest_webhook_delivery(
    pg_temp.pv_cmd('\x7b2262223a327d'::bytea, 'evt-inline', 'bank-transfer.inflow.success')))->>'id';
  IF NOT public.resolve_piggyvest_webhook_capture(v_id, NULL, 'processed', NULL) THEN
    RAISE EXCEPTION 'inline completion of a pending row must succeed';
  END IF;
  BEGIN
    UPDATE public.piggyvest_webhook_captures SET raw_body = '\x00' WHERE id = v_id;
    RAISE EXCEPTION 'captured evidence must be immutable';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$$;

-- Denials are asserted through the catalog, never by calling the denied
-- object as an API role: on the pinned replay image a denied function
-- EXECUTE cannot be trapped by an exception handler (see
-- finalize_wallet_order_payment_privileges.sql), so a runtime denial probe
-- aborts the whole statement instead of reporting. The effective-privilege
-- block near the top already covers table, function and PUBLIC
-- grants; the statements below add column-level grants and the diagnostics
-- that name the exact failing precondition through the SQLSTATE: ZACL1 /
-- ZACL2 (anon / authenticated can execute the capture function), ZOWN1
-- (the function is not owned by the role running this suite), ZCOL1
-- (a column-level grant exists), ZRLS1 (RLS or its deny-all policy is off).
DO $$
BEGIN
  IF pg_catalog.has_function_privilege('anon',
    'public.capture_piggyvest_webhook_delivery(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute the capture function'
      USING ERRCODE = 'ZACL1';
  END IF;
END
$$;

DO $$
BEGIN
  IF pg_catalog.has_function_privilege('authenticated',
    'public.capture_piggyvest_webhook_delivery(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can execute the capture function'
      USING ERRCODE = 'ZACL2';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    WHERE p.oid = 'public.capture_piggyvest_webhook_delivery(jsonb)'::pg_catalog.regprocedure
      AND pg_catalog.pg_get_userbyid(p.proowner) = current_user
  ) THEN
    RAISE EXCEPTION 'the capture function is not owned by the role running this suite'
      USING ERRCODE = 'ZOWN1';
  END IF;
END
$$;

DO $$
DECLARE
  v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF pg_catalog.has_any_column_privilege(
      v_role, 'public.piggyvest_webhook_captures'::pg_catalog.regclass,
      'SELECT, INSERT, UPDATE, REFERENCES') THEN
      RAISE EXCEPTION '% holds a column-level grant on piggyvest_webhook_captures', v_role
        USING ERRCODE = 'ZCOL1';
    END IF;
  END LOOP;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    WHERE c.oid = 'public.piggyvest_webhook_captures'::pg_catalog.regclass
      AND c.relrowsecurity
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'piggyvest_webhook_captures'
      AND policyname = 'piggyvest_webhook_captures_deny_all'
      AND permissive = 'RESTRICTIVE'
      AND qual = 'false'
  ) THEN
    RAISE EXCEPTION 'row level security or its deny-all policy is not in force'
      USING ERRCODE = 'ZRLS1';
  END IF;
END
$$;

-- The one positive runtime role check: service_role captures through the
-- function. The command is built as the owner first and handed over through
-- a transaction-local setting, because the pg_temp helpers are not callable
-- by API roles when default privileges do not grant PUBLIC EXECUTE. Any
-- failure is re-raised with the observed SQLSTATE as its code.
SELECT pg_catalog.set_config('app.pv_cmd_service_role',
  pg_temp.pv_cmd('\x7b2263223a337d'::bytea, 'evt-service', 'x')::text, true);

SET LOCAL ROLE service_role;

DO $$
DECLARE
  v_result jsonb;
  v_state text := 'ALLOWED';
  v_message text;
BEGIN
  BEGIN
    v_result := public.capture_piggyvest_webhook_delivery(
      pg_catalog.current_setting('app.pv_cmd_service_role')::jsonb);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    RAISE EXCEPTION 'service_role capture failed: % (%)', v_state, v_message
      USING ERRCODE = CASE
        WHEN v_state = 'ALLOWED' THEN 'ZALLW'
        WHEN v_state ~ '^[0-9A-Z]{5}$' THEN v_state
        ELSE 'ZUNKN'
      END;
  END;
  IF v_result->>'outcome' IS DISTINCT FROM 'captured' THEN
    RAISE EXCEPTION 'service_role must capture through the function: %', v_result
      USING ERRCODE = 'ZOUTC';
  END IF;
END
$$;

RESET ROLE;
