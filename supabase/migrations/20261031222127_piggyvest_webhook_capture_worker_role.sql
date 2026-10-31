-- Dedicated database authority for the PiggyVest webhook capture drain (R5).
--
-- The drain replays captured deliveries from the worker host, outside the
-- web app, so it must not hold the service-role key. It connects with its
-- own login, which the owner provisions later from
-- docs/piggyvest-webhook-capture-drain-runbook.md. That login is a member
-- of exactly one role, created here: piggyvest_webhook_capture_worker.
--
-- The role can lease, settle and count captured deliveries through the
-- existing SECURITY DEFINER functions (claim, resolve, status). It cannot
-- log in, capture new deliveries, run the evidence trigger, or touch
-- public.piggyvest_webhook_captures directly. No function is created or
-- replaced: the three functions keep their definitions and their existing
-- service_role grants, which the web receiver still uses.
--
-- Nothing runs until the login exists and the worker host flag is on, so
-- applying this migration changes no behaviour.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'piggyvest_webhook_capture_worker'
  ) THEN
    CREATE ROLE piggyvest_webhook_capture_worker
      NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
  ELSIF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'piggyvest_webhook_capture_worker'
      AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreatedb
        OR rolcreaterole OR rolreplication)
  ) THEN
    RAISE EXCEPTION 'piggyvest_webhook_capture_worker exists with unexpected attributes';
  END IF;
  -- The drain login inherits from this role alone; a parent role would
  -- widen what the login can reach.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members m
    JOIN pg_catalog.pg_roles r ON r.oid = m.member
    WHERE r.rolname = 'piggyvest_webhook_capture_worker'
  ) THEN
    RAISE EXCEPTION 'piggyvest_webhook_capture_worker must not be a member of another role';
  END IF;
END
$$;

-- The grants below rely on the three functions still being SECURITY
-- DEFINER with a pinned search_path; refuse to grant on anything else.
DO $$
DECLARE
  v_fn regprocedure;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.claim_piggyvest_webhook_captures(integer,integer,integer)'::regprocedure,
    'public.resolve_piggyvest_webhook_capture(uuid,uuid,text,text)'::regprocedure,
    'public.piggyvest_webhook_capture_status()'::regprocedure
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
      WHERE p.oid = v_fn
        AND p.prosecdef
        AND p.proconfig = ARRAY['search_path=pg_catalog']
    ) THEN
      RAISE EXCEPTION '% is not SECURITY DEFINER with search_path=pg_catalog', v_fn;
    END IF;
  END LOOP;
END
$$;

GRANT USAGE ON SCHEMA public TO piggyvest_webhook_capture_worker;

-- No direct table authority, and never the capture door or the trigger.
REVOKE ALL ON TABLE public.piggyvest_webhook_captures
  FROM piggyvest_webhook_capture_worker;
REVOKE ALL ON FUNCTION public.capture_piggyvest_webhook_delivery(jsonb)
  FROM piggyvest_webhook_capture_worker;
REVOKE ALL ON FUNCTION public.piggyvest_webhook_captures_immutable_evidence()
  FROM piggyvest_webhook_capture_worker;

-- Re-assert the API-role denials before widening, then grant exactly the
-- drain's three entry points.
REVOKE ALL ON FUNCTION public.claim_piggyvest_webhook_captures(integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_piggyvest_webhook_capture(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.piggyvest_webhook_capture_status()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_piggyvest_webhook_captures(integer, integer, integer)
  TO piggyvest_webhook_capture_worker;
GRANT EXECUTE ON FUNCTION public.resolve_piggyvest_webhook_capture(uuid, uuid, text, text)
  TO piggyvest_webhook_capture_worker;
GRANT EXECUTE ON FUNCTION public.piggyvest_webhook_capture_status()
  TO piggyvest_webhook_capture_worker;
