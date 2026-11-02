-- GIG Logistics status webhooks are hints, never truth. An authenticated
-- delivery only makes the matching GIGL monitor due now; the VPS poller then
-- reads the authoritative status from GIG's tracking API through the existing
-- apply/notification pipeline, so order statuses and customer notifications
-- keep a single writer.
--
-- The webhook route runs on Vercel, which already holds the
-- gigl_tracking_worker JWT for the retained manual fallback route. This adds
-- one idempotent wrapper to that confined capability instead of a
-- service-role edge or a new PostgREST role: the worker can already claim,
-- apply and pause these monitors, so "poll this waybill sooner" adds no new
-- authority, and no authenticator membership changes (no reload window).

CREATE INDEX IF NOT EXISTS shipment_tracking_monitors_live_tracking_number_idx
  ON public.shipment_tracking_monitors (tracking_number)
  WHERE state IN ('active', 'final_poll', 'paused');

CREATE OR REPLACE FUNCTION public.gigl_worker_expedite_tracking_monitor(
  p_tracking_number text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  waybill text := btrim(p_tracking_number);
  matched_count integer;
  expedited_count integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'gigl_tracking_worker' THEN
    RAISE EXCEPTION 'GIGL worker capability required' USING ERRCODE = '42501';
  END IF;
  IF waybill IS NULL OR waybill !~ '^[A-Za-z0-9][A-Za-z0-9-]{0,63}$' THEN
    RAISE EXCEPTION 'GIGL waybill is invalid' USING ERRCODE = '22023';
  END IF;

  -- Terminal and inactive monitors stay untouched: a webhook can never
  -- reactivate a retired timeline. A paused (unchanged-for-a-day) monitor
  -- is woken, and the poller's claim/apply then resumes its normal cadence,
  -- because a fresh GIG scan means the shipment moved again. Monitors with
  -- no schedule (parked) or in failure backoff keep their schedule, so a
  -- burst of webhooks cannot hammer GIG during a tracking outage. A monitor
  -- polled within the last minute becomes due one minute after that poll,
  -- which bounds GIG calls when GIG sends scan bursts, retries or replays
  -- for one waybill. Repeated deliveries converge on the same next_poll_at.
  WITH candidates AS (
    SELECT monitor.shipment_id,
      greatest(
        now(),
        coalesce(monitor.last_polled_at + interval '1 minute', now())
      ) AS due_at
    FROM public.shipment_tracking_monitors AS monitor
    JOIN public.shipments AS shipment ON shipment.id = monitor.shipment_id
    WHERE monitor.provider = 'GIGL'
      AND monitor.tracking_number = waybill
      AND monitor.state IN ('active', 'final_poll', 'paused')
      AND shipment.provider = 'GIGL'
      AND btrim(shipment.tracking_number) = waybill
    ORDER BY monitor.shipment_id
    LIMIT 10
    FOR UPDATE OF monitor
  ), expedited AS (
    UPDATE public.shipment_tracking_monitors AS monitor
    SET next_poll_at = candidates.due_at, updated_at = now()
    FROM candidates
    WHERE monitor.shipment_id = candidates.shipment_id
      AND monitor.consecutive_failures = 0
      AND monitor.next_poll_at > candidates.due_at
    RETURNING monitor.shipment_id
  )
  SELECT
    (SELECT count(*)::integer FROM candidates),
    (SELECT count(*)::integer FROM expedited)
  INTO matched_count, expedited_count;

  RETURN jsonb_build_object(
    'matched', matched_count,
    'expedited', expedited_count
  );
END;
$$;

ALTER FUNCTION public.gigl_worker_expedite_tracking_monitor(text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.gigl_worker_expedite_tracking_monitor(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gigl_worker_expedite_tracking_monitor(text)
  TO gigl_tracking_worker;

-- Add the wrapper to the worker's PostgREST path allowlist, preserving every
-- other branch of the installed request guard verbatim. Only an existing
-- role's allowlist grows, so the change is live at commit with no hook
-- reload or membership window; until then the route fails closed (42501)
-- and GIG retries the delivery.
DO $guard$
DECLARE
  definition text := pg_get_functiondef(
    'public.enforce_gigl_tracking_worker_request_scope()'::regprocedure
  );
  anchor text := '''/rpc/gigl_worker_claim_due_tracking_monitors'',';
  insertion text := '''/rpc/gigl_worker_claim_due_tracking_monitors'',
        ''/rpc/gigl_worker_expedite_tracking_monitor'',';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles AS role_record, unnest(role_record.rolconfig) AS setting
    WHERE role_record.rolname = 'authenticator'
      AND setting = 'pgrst.db_pre_request=public.enforce_gigl_tracking_worker_request_scope'
  ) THEN
    RAISE EXCEPTION 'Unexpected PostgREST request guard';
  END IF;
  IF position('''/rpc/gigl_worker_expedite_tracking_monitor''' IN definition) > 0 THEN
    RETURN;
  END IF;
  IF (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) != 1 THEN
    RAISE EXCEPTION 'Unexpected PostgREST request guard definition';
  END IF;
  EXECUTE replace(definition, anchor, insertion);
END $guard$;

NOTIFY pgrst, 'reload schema';
