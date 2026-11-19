-- GIG (GIGL) tracking polls only when something triggers it, and stops when
-- nothing new is happening.
--
-- Before: every live monitor was polled every 15 minutes for 24 hours, and a
-- waybill GIG's batch tracking cannot show yet (it shows nothing until the
-- rider scans the parcel at pickup) was recorded as a tracking FAILURE on
-- every poll. Prod waybill 1349644465 reached 24 consecutive failures in a
-- day, and because the webhook expedite skips monitors in failure back-off,
-- GIG's own webhook could no longer wake it.
--
-- After, per monitor:
--   * Trigger: booking a waybill (or changing it) starts the monitor due now
--     (unchanged: private.activate_gigl_tracking_monitor).
--   * Burst: the first 4 unchanged polls run every 15 minutes (~1 hour).
--   * Back-off: unchanged polls 5-8 run hourly (~4 more hours).
--   * Dormant: from the 9th unchanged poll the monitor is 'paused' with only
--     a SAFETY CHECK every 6 hours (4 GIG calls a day), so a missed webhook
--     can never strand a shipment. A dormant check that finds nothing stays
--     dormant; it no longer restarts the burst.
--   * Wake: a GIG webhook delivery makes a dormant monitor due (with the
--     existing replay/rate-limit rules) and leaves room for a short follow-up
--     (2 hourly re-checks) before dormancy, because GIG's tracking can lag
--     its webhook. A poll that finds new events resets to the 15-minute
--     cadence and a fresh burst.
--   * "Not yet visible": the worker reports an omitted waybill through the
--     existing lease-bound record_gigl_tracking_failure RPC with the marker
--     'GIGL waybill not yet visible'. That is recorded as a quiet poll: no
--     consecutive_failures increment, no last_error, same ladder as above.
--     Reusing the RPC keeps the worker role's capability set unchanged.
--   * Terminal states stop as before.

-- 1. The ladder: replaces the 24-hour (96 polls) pause rule.
CREATE OR REPLACE FUNCTION private.pause_gigl_tracking_monitor_after_unchanged_polls()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Only an unchanged poll (the count went up) moves along the ladder; a
  -- poll with new events resets the count and keeps the 15-minute cadence.
  IF NEW.state = 'active'
     AND NEW.next_poll_at IS NOT NULL
     AND NEW.unchanged_poll_count > OLD.unchanged_poll_count THEN
    IF NEW.unchanged_poll_count >= 9 THEN
      NEW.state := 'paused';
      NEW.next_poll_at := now() + interval '6 hours';
      NEW.stopped_at := now();
      NEW.unchanged_poll_count := 9;
      IF NEW.last_error IS NOT DISTINCT FROM
         'GIGL tracking unchanged after 96 successful polls' THEN
        NEW.last_error := NULL;
      END IF;
    ELSIF NEW.unchanged_poll_count > 4 THEN
      NEW.next_poll_at := now() + interval '1 hour';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION private.pause_gigl_tracking_monitor_after_unchanged_polls()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.pause_gigl_tracking_monitor_after_unchanged_polls()
  FROM PUBLIC, anon, authenticated, service_role;

-- 2. "Not yet visible" is a quiet poll, never a failure.
CREATE OR REPLACE FUNCTION public.record_gigl_tracking_failure(
  p_shipment_id uuid, p_tracking_epoch_id uuid, p_worker_id text, p_error text
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_updated_count integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'GIGL tracking failure recording requires service role' USING ERRCODE = '42501';
  END IF;

  IF p_error IN (
    'GIGL waybill not yet visible',
    'GIGL batch tracking omitted claimed waybill'
  ) THEN
    -- A paused (dormant) monitor is set active for the ladder trigger, which
    -- puts it straight back to dormant when the count reaches 9 again.
    UPDATE public.shipment_tracking_monitors AS monitor
    SET state = CASE WHEN monitor.state = 'paused' THEN 'active' ELSE monitor.state END,
      unchanged_poll_count = monitor.unchanged_poll_count + 1,
      consecutive_failures = 0, last_error = NULL, last_polled_at = now(),
      next_poll_at = now() + interval '15 minutes',
      locked_at = NULL, locked_by = NULL, updated_at = now()
    WHERE monitor.shipment_id = p_shipment_id
      AND monitor.tracking_epoch_id = p_tracking_epoch_id
      AND monitor.locked_by = btrim(p_worker_id)
    RETURNING monitor.unchanged_poll_count INTO v_updated_count;
    RETURN v_updated_count IS NOT NULL;
  END IF;

  UPDATE public.shipment_tracking_monitors AS monitor
  SET consecutive_failures = monitor.consecutive_failures + 1,
    last_error = left(nullif(btrim(p_error), ''), 512), last_polled_at = now(),
    next_poll_at = now() + least(interval '60 minutes', interval '5 minutes' * power(2, least(monitor.consecutive_failures, 3))),
    locked_at = NULL, locked_by = NULL, updated_at = now()
  WHERE monitor.shipment_id = p_shipment_id
    AND monitor.tracking_epoch_id = p_tracking_epoch_id
    AND monitor.locked_by = btrim(p_worker_id)
  RETURNING consecutive_failures INTO v_updated_count;
  RETURN v_updated_count IS NOT NULL;
END;
$$;

ALTER FUNCTION public.record_gigl_tracking_failure(uuid, uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_gigl_tracking_failure(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_gigl_tracking_failure(uuid, uuid, text, text)
  TO service_role;

-- 3. Claiming a dormant monitor keeps its count, so a safety check that
-- finds nothing goes straight back to dormant instead of restarting the
-- burst. Otherwise identical to 20260801130400.
CREATE OR REPLACE FUNCTION public.claim_due_gigl_tracking_monitors(
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
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'GIGL monitor claims require service role'
      USING ERRCODE = '42501';
  END IF;

  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'GIGL monitor claim limit must be between 1 and 100'
      USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(p_worker_id), '') IS NULL
    OR char_length(btrim(p_worker_id)) > 128 THEN
    RAISE EXCEPTION 'GIGL monitor worker id is invalid' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH due_monitors AS (
    SELECT monitor.shipment_id
    FROM public.shipment_tracking_monitors AS monitor
    WHERE monitor.state IN ('active', 'final_poll', 'paused')
      AND monitor.next_poll_at <= now()
      AND (
        monitor.locked_at IS NULL
        OR monitor.locked_at < now() - interval '15 minutes'
      )
    ORDER BY monitor.next_poll_at ASC, monitor.shipment_id ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  ), claimed_monitors AS (
    UPDATE public.shipment_tracking_monitors AS monitor
    SET locked_at = now(),
      locked_by = btrim(p_worker_id),
      updated_at = now()
    FROM due_monitors
    WHERE monitor.shipment_id = due_monitors.shipment_id
    RETURNING monitor.shipment_id, monitor.tracking_epoch_id, monitor.order_id,
      monitor.tracking_number, monitor.state
  )
  SELECT * FROM claimed_monitors;
END;
$$;

ALTER FUNCTION public.claim_due_gigl_tracking_monitors(integer, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_due_gigl_tracking_monitors(integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_gigl_tracking_monitors(integer, text)
  TO service_role;

-- 4. A webhook wake leaves room for a short follow-up before dormancy.
-- Otherwise identical to 20261102120000 (same matching, rate limits and
-- "hint, never truth" rules; the request-guard allowlist is unchanged).
CREATE OR REPLACE FUNCTION public.gigl_worker_expedite_tracking_monitor(
  p_tracking_number text,
  p_status_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  waybill text := btrim(p_tracking_number);
  status_code text := upper(nullif(btrim(p_status_code), ''));
  matched_count integer;
  expedited_count integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'gigl_tracking_worker' THEN
    RAISE EXCEPTION 'GIGL worker capability required' USING ERRCODE = '42501';
  END IF;
  IF waybill IS NULL OR waybill !~ '^[A-Za-z0-9][A-Za-z0-9-]{0,63}$' THEN
    RAISE EXCEPTION 'GIGL waybill is invalid' USING ERRCODE = '22023';
  END IF;
  IF char_length(status_code) > 64 THEN
    RAISE EXCEPTION 'GIGL status code is invalid' USING ERRCODE = '22023';
  END IF;

  -- See 20261102120000 for the replay and rate-limit reasoning: a code
  -- already recorded for this epoch earns the 15-minute cadence after the
  -- last poll, a new code one minute, and monitors in failure back-off or
  -- parked without a schedule keep their schedule.
  WITH candidates AS (
    SELECT monitor.shipment_id,
      greatest(
        now(),
        coalesce(
          monitor.last_polled_at + CASE
            WHEN status_code IS NOT NULL AND EXISTS (
              SELECT 1
              FROM public.shipment_tracking_events AS event
              WHERE event.shipment_id = monitor.shipment_id
                AND event.tracking_epoch_id = monitor.tracking_epoch_id
                AND upper(btrim(event.raw_status)) = status_code
            ) THEN interval '15 minutes'
            ELSE interval '1 minute'
          END,
          now()
        )
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
    SET next_poll_at = LEAST(monitor.next_poll_at, candidates.due_at),
      -- A dormant monitor sits at 9 unchanged polls; 6 gives the wake poll
      -- plus two hourly re-checks before it goes dormant again.
      unchanged_poll_count = CASE WHEN monitor.state = 'paused'
        THEN least(monitor.unchanged_poll_count, 6)
        ELSE monitor.unchanged_poll_count END,
      updated_at = now()
    FROM candidates
    WHERE monitor.shipment_id = candidates.shipment_id
      AND monitor.consecutive_failures = 0
      AND (
        monitor.next_poll_at > candidates.due_at
        OR (monitor.state = 'paused' AND monitor.next_poll_at <= now())
      )
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

ALTER FUNCTION public.gigl_worker_expedite_tracking_monitor(text, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.gigl_worker_expedite_tracking_monitor(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gigl_worker_expedite_tracking_monitor(text, text)
  TO gigl_tracking_worker;

-- 5. Repair monitors stuck in failure back-off only because GIG could not
-- show their waybill yet (e.g. 1349644465): clear the false failures and
-- make them due, so the next poll runs under the new rules and webhooks can
-- wake them again.
UPDATE public.shipment_tracking_monitors AS monitor
SET consecutive_failures = 0,
  last_error = NULL,
  next_poll_at = least(coalesce(monitor.next_poll_at, now()), now()),
  updated_at = now()
WHERE monitor.provider = 'GIGL'
  AND monitor.state IN ('active', 'final_poll', 'paused')
  AND monitor.last_error = 'GIGL batch tracking omitted claimed waybill';
