-- A non-login PostgREST role for the VPS tracking poller. Its JWT is minted
-- offline and can invoke only these five lease-bound wrapper procedures.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gigl_tracking_worker') THEN
    CREATE ROLE gigl_tracking_worker NOLOGIN NOINHERIT NOSUPERUSER
      NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;

-- Converge a pre-existing worker role BEFORE granting wrapper access.
-- Production is mid-rollout with interim LOGIN (see the deploy.yml
-- final-state step), and the applier commits per file: without this, a
-- stall before the converge migration would leave direct login + fresh
-- EXECUTE grants indefinitely. A direct session can SET
-- request.jwt.claim.role to pass the auth.role() wrapper guard while
-- the PostgREST scope hook never runs — so "five wrappers only" would
-- not hold. NOLOGIN + PASSWORD NULL (a later accidental LOGIN cannot
-- resurrect password auth); a no-op on fresh chains, where the role
-- was just created NOLOGIN above. The converge migration re-asserts
-- this and additionally revokes any interim membership.
ALTER ROLE gigl_tracking_worker NOLOGIN CONNECTION LIMIT -1 PASSWORD NULL;

-- No GRANT to authenticator here: membership lands atomically with the
-- pre-request hook in 20260805170000_isolate_gigl_tracking_postgrest_capability.
-- Granting it here would leave the worker JWT usable without the hook if a
-- later migration failed.
GRANT USAGE ON SCHEMA public TO gigl_tracking_worker;

CREATE OR REPLACE FUNCTION public.gigl_worker_claim_due_tracking_monitors(
  p_limit integer,
  p_worker_id text
)
RETURNS TABLE (
  shipment_id uuid,
  tracking_epoch_id uuid,
  order_id uuid,
  tracking_number text,
  state text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'gigl_tracking_worker' THEN
    RAISE EXCEPTION 'GIGL worker capability required' USING ERRCODE = '42501';
  END IF;
  -- Defense in depth: mirror the underlying RPC bounds here so a future
  -- relaxation of the inner function cannot silently widen worker
  -- authority, and reject before elevating to service_role.
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'GIGL worker claim limit must be between 1 and 100'
      USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(p_worker_id), '') IS NULL
    OR char_length(btrim(p_worker_id)) > 128 THEN
    RAISE EXCEPTION 'GIGL worker id is invalid' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  RETURN QUERY SELECT *
  FROM public.claim_due_gigl_tracking_monitors(p_limit, p_worker_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.gigl_worker_apply_tracking_result(
  p_shipment_id uuid,
  p_tracking_epoch_id uuid,
  p_worker_id text,
  p_status text,
  p_current_location text,
  p_actual_delivery timestamptz,
  p_events jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'gigl_tracking_worker' THEN
    RAISE EXCEPTION 'GIGL worker capability required' USING ERRCODE = '42501';
  END IF;
  -- Lease ids are written by the claim wrapper (non-blank, <=128 chars),
  -- so anything else can never match; reject before elevating.
  IF nullif(btrim(p_worker_id), '') IS NULL
    OR char_length(btrim(p_worker_id)) > 128 THEN
    RAISE EXCEPTION 'GIGL worker id is invalid' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  RETURN public.apply_gigl_tracking_result(
    p_shipment_id, p_tracking_epoch_id, p_worker_id, p_status,
    p_current_location, p_actual_delivery, p_events
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.gigl_worker_record_tracking_failure(
  p_shipment_id uuid,
  p_tracking_epoch_id uuid,
  p_worker_id text,
  p_error text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'gigl_tracking_worker' THEN
    RAISE EXCEPTION 'GIGL worker capability required' USING ERRCODE = '42501';
  END IF;
  -- Lease ids are written by the claim wrapper (non-blank, <=128 chars),
  -- so anything else can never match; reject before elevating.
  IF nullif(btrim(p_worker_id), '') IS NULL
    OR char_length(btrim(p_worker_id)) > 128 THEN
    RAISE EXCEPTION 'GIGL worker id is invalid' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  RETURN public.record_gigl_tracking_failure(
    p_shipment_id, p_tracking_epoch_id, p_worker_id, p_error
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.gigl_worker_release_tracking_claim(
  p_shipment_id uuid,
  p_tracking_epoch_id uuid,
  p_worker_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'gigl_tracking_worker' THEN
    RAISE EXCEPTION 'GIGL worker capability required' USING ERRCODE = '42501';
  END IF;
  -- Lease ids are written by the claim wrapper (non-blank, <=128 chars),
  -- so anything else can never match; reject before elevating.
  IF nullif(btrim(p_worker_id), '') IS NULL
    OR char_length(btrim(p_worker_id)) > 128 THEN
    RAISE EXCEPTION 'GIGL worker id is invalid' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  RETURN public.release_gigl_tracking_claim(
    p_shipment_id, p_tracking_epoch_id, p_worker_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.gigl_worker_pause_tracking_monitor(
  p_shipment_id uuid,
  p_tracking_epoch_id uuid,
  p_worker_id text,
  p_error text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'gigl_tracking_worker' THEN
    RAISE EXCEPTION 'GIGL worker capability required' USING ERRCODE = '42501';
  END IF;
  -- Lease ids are written by the claim wrapper (non-blank, <=128 chars),
  -- so anything else can never match; reject before elevating.
  IF nullif(btrim(p_worker_id), '') IS NULL
    OR char_length(btrim(p_worker_id)) > 128 THEN
    RAISE EXCEPTION 'GIGL worker id is invalid' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  RETURN public.pause_gigl_tracking_monitor(
    p_shipment_id, p_tracking_epoch_id, p_worker_id, p_error
  );
END;
$$;

ALTER FUNCTION public.gigl_worker_claim_due_tracking_monitors(integer, text)
  OWNER TO postgres;
ALTER FUNCTION public.gigl_worker_apply_tracking_result(
  uuid, uuid, text, text, text, timestamptz, jsonb
) OWNER TO postgres;
ALTER FUNCTION public.gigl_worker_record_tracking_failure(uuid, uuid, text, text)
  OWNER TO postgres;
ALTER FUNCTION public.gigl_worker_release_tracking_claim(uuid, uuid, text)
  OWNER TO postgres;
ALTER FUNCTION public.gigl_worker_pause_tracking_monitor(uuid, uuid, text, text)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.gigl_worker_claim_due_tracking_monitors(integer, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.gigl_worker_apply_tracking_result(
  uuid, uuid, text, text, text, timestamptz, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.gigl_worker_record_tracking_failure(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.gigl_worker_release_tracking_claim(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.gigl_worker_pause_tracking_monitor(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.gigl_worker_claim_due_tracking_monitors(integer, text)
  TO gigl_tracking_worker;
GRANT EXECUTE ON FUNCTION public.gigl_worker_apply_tracking_result(
  uuid, uuid, text, text, text, timestamptz, jsonb
) TO gigl_tracking_worker;
GRANT EXECUTE ON FUNCTION public.gigl_worker_record_tracking_failure(uuid, uuid, text, text)
  TO gigl_tracking_worker;
GRANT EXECUTE ON FUNCTION public.gigl_worker_release_tracking_claim(uuid, uuid, text)
  TO gigl_tracking_worker;
GRANT EXECUTE ON FUNCTION public.gigl_worker_pause_tracking_monitor(uuid, uuid, text, text)
  TO gigl_tracking_worker;
