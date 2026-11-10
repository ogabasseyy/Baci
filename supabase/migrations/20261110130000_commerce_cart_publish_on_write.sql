-- Shared-cart change notices: fix the sender, send at write time, keep a
-- slow sweep as the safety net, and expose a health reading for alerting.
--
-- Why: production showed every queued notice failing. Supabase's
-- realtime.send now adds an `id` key to a payload that has none, so the
-- publisher's exact-payload acknowledgement check
-- (20261014070000_commerce_cart_broadcast.sql) could never match and every
-- send was counted as lost. Nothing was ever delivered.
--
-- What changes:
--  1. One private sender builds the notice with its own `id`, so the stored
--     payload is exactly what was sent on every realtime.send version, and
--     confirms the stored row by that id.
--  2. A BEFORE INSERT trigger on the outbox sends the notice inside the cart
--     write's own transaction (realtime.send is an INSERT that Realtime ships
--     from the WAL after commit, so a rolled-back cart write sends nothing).
--     A failed or unconfirmed send never fails the cart write: the row simply
--     stays undelivered for the sweep.
--  3. The publisher keeps its leases, backoff and dead-letter rules and now
--     uses the same sender. pg_cron runs it every 30 seconds as the sweep.
--  4. commerce_cart_publish_health() reports stale and dead-lettered notices
--     as counts only, for a monitor to alert on.

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.commerce_cart_send_change(
  p_merchant_id uuid,
  p_cart_id uuid,
  p_version integer,
  p_operation_id text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id text := pg_catalog.gen_random_uuid()::text;
  v_topic text := 'cart:' || p_merchant_id::text || ':' || p_cart_id::text;
  -- Routing hint only: no cart contents ever enter a notice. The id is
  -- supplied here because realtime.send keeps a caller's `id` and only adds
  -- one when the payload has none (confirmed against the production function
  -- and with a live send on 2026-11-10).
  v_payload jsonb := pg_catalog.jsonb_build_object(
    'id', v_id,
    'merchantId', p_merchant_id,
    'cartId', p_cart_id,
    'version', p_version,
    'operationId', p_operation_id
  );
BEGIN
  PERFORM realtime.send(v_payload, 'cart_changed', v_topic, true);
  -- realtime.send reports a failed insert (for example a missing daily
  -- partition) as a warning, not an error. Never acknowledge without the
  -- durable row this call wrote. The topic, extension and private filters
  -- match Realtime's replay index. inserted_at is timestamp without time
  -- zone, stamped in the writing session's zone, so the bound is a loose
  -- one-day window (wider than any zone offset) that only prunes old daily
  -- partitions; the row being confirmed is always seconds old.
  RETURN EXISTS (
    SELECT 1
    FROM realtime.messages AS message
    WHERE message.topic = v_topic
      AND message.extension = 'broadcast'
      AND message.private = true
      AND message.inserted_at
        >= (pg_catalog.now() AT TIME ZONE 'utc') - interval '1 day'
      AND message.event = 'cart_changed'
      AND message.payload ->> 'id' = v_id
  );
END;
$$;
ALTER FUNCTION private.commerce_cart_send_change(uuid, uuid, integer, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.commerce_cart_send_change(uuid, uuid, integer, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- Send at write time. Every cart writer already records its change in the
-- outbox, so one trigger covers them all.
CREATE OR REPLACE FUNCTION private.commerce_cart_events_send_on_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Same eligibility as the sweep: undelivered, not parked, not expired.
  IF NEW.delivered_at IS NOT NULL OR NEW.dead_letter_at IS NOT NULL
    OR NEW.expires_at <= pg_catalog.now() THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.merchants AS merchant
    WHERE merchant.id = NEW.merchant_id
      AND merchant.premium_features
        @> '["shared_cart","shared_cart_realtime"]'::jsonb
  ) THEN
    RETURN NEW;
  END IF;
  BEGIN
    IF private.commerce_cart_send_change(
      NEW.merchant_id, NEW.cart_id, NEW.version, NEW.operation_id
    ) THEN
      NEW.delivered_at := pg_catalog.now();
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- The cart write must never fail because a notice could not be sent.
    -- The row stays undelivered and the sweep retries it.
    NULL;
  END;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.commerce_cart_events_send_on_write() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.commerce_cart_events_send_on_write()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS commerce_cart_events_send_on_write
  ON public.commerce_cart_events;
CREATE TRIGGER commerce_cart_events_send_on_write
  BEFORE INSERT ON public.commerce_cart_events
  FOR EACH ROW
  EXECUTE FUNCTION private.commerce_cart_events_send_on_write();

-- Sweep publisher: unchanged contract (signature, grants, leases, backoff,
-- dead letter after 10 attempts); only the send and its confirmation move to
-- the shared sender.
CREATE OR REPLACE FUNCTION public.commerce_cart_publish_events(
  p_limit integer,
  p_worker_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  r record;
  v_sent integer := 0;
  v_failed integer := 0;
  v_dead integer := 0;
  v_attempt integer;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50
    OR p_worker_id IS NULL OR p_worker_id !~ '^[a-zA-Z0-9_-]{1,80}$' THEN
    RAISE EXCEPTION 'invalid publisher parameters';
  END IF;
  FOR r IN
    SELECT e.id, e.merchant_id, e.cart_id, e.version, e.operation_id,
      e.attempts
    FROM public.commerce_cart_events AS e
    JOIN public.merchants AS m ON m.id = e.merchant_id
    WHERE e.delivered_at IS NULL
      AND e.dead_letter_at IS NULL
      AND e.next_attempt_at <= pg_catalog.now()
      AND e.expires_at > pg_catalog.now()
      AND m.premium_features @> '["shared_cart","shared_cart_realtime"]'::jsonb
    ORDER BY e.id
    LIMIT p_limit
    FOR UPDATE OF e SKIP LOCKED
  LOOP
    v_attempt := r.attempts + 1;
    BEGIN
      UPDATE public.commerce_cart_events
      SET locked_at = pg_catalog.now(), locked_by = p_worker_id,
        attempts = v_attempt
      WHERE id = r.id;
      IF NOT private.commerce_cart_send_change(
        r.merchant_id, r.cart_id, r.version, r.operation_id
      ) THEN
        RAISE EXCEPTION 'broadcast not durably accepted';
      END IF;
      UPDATE public.commerce_cart_events
      SET delivered_at = pg_catalog.now(), locked_at = NULL, locked_by = NULL
      WHERE id = r.id;
      v_sent := v_sent + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.commerce_cart_events
      SET attempts = v_attempt, locked_at = NULL, locked_by = NULL,
        next_attempt_at = pg_catalog.now() + pg_catalog.make_interval(
          secs => least(300, power(2, least(v_attempt, 8))::integer)
        ),
        dead_letter_at = CASE
          WHEN v_attempt >= 10 THEN pg_catalog.now() ELSE NULL
        END
      WHERE id = r.id;
      v_failed := v_failed + 1;
      IF v_attempt >= 10 THEN v_dead := v_dead + 1; END IF;
    END;
  END LOOP;
  RETURN pg_catalog.jsonb_build_object(
    'sent', v_sent, 'failed', v_failed, 'deadLettered', v_dead
  );
END;
$$;
ALTER FUNCTION public.commerce_cart_publish_events(integer, text)
  OWNER TO postgres;
-- Same closed list as 20261014070000; the commerce_cart_worker grant made
-- there is kept by CREATE OR REPLACE.
REVOKE ALL ON FUNCTION public.commerce_cart_publish_events(integer, text)
  FROM PUBLIC, anon, authenticated, commerce_cart_shopper,
    commerce_cart_receiver;

-- Health reading for alerting: two counts, no cart or merchant identifiers.
-- "Stale" is a notice for a live-update merchant still undelivered five
-- minutes after it was written; with send-on-write and a 30-second sweep
-- that only happens when delivery is broken. Both counts cover merchants
-- currently enrolled in live updates only, so unenrolling a merchant clears
-- its share of the alarm at once. The stale count is limited to unsent,
-- unparked notices, a set the existing partial indexes
-- commerce_cart_events_outbox_idx (20261012050000) and
-- commerce_cart_events_ready_idx (20261014070000) already narrow; the
-- dead-letter count uses the index below.
--
-- Rows waiting out a retry backoff are counted on purpose: a notice still
-- unsent five minutes after its cart write has been failing for five
-- minutes, which is the fault this alarm exists to report.
--
-- The reading is deliberately callable with the public anon key (as
-- get_merchant_signup_policy_health in 20260728091958 is): the monitor route must not use a
-- service-role client, and the result is two platform-wide counts with no
-- cart, shopper or merchant data. CRON_SECRET gates the alerting route, not
-- the counts themselves.
CREATE INDEX IF NOT EXISTS commerce_cart_events_dead_letter_idx
  ON public.commerce_cart_events (dead_letter_at)
  WHERE dead_letter_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.commerce_cart_publish_health()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH counts AS (
    SELECT
      (
        SELECT pg_catalog.count(*)
        FROM public.commerce_cart_events AS e
        JOIN public.merchants AS m ON m.id = e.merchant_id
        WHERE e.delivered_at IS NULL
          AND e.dead_letter_at IS NULL
          AND e.expires_at > pg_catalog.now()
          AND e.created_at < pg_catalog.now() - interval '5 minutes'
          AND m.premium_features
            @> '["shared_cart","shared_cart_realtime"]'::jsonb
      ) AS stale_undelivered,
      (
        SELECT pg_catalog.count(*)
        FROM public.commerce_cart_events AS e
        JOIN public.merchants AS m ON m.id = e.merchant_id
        WHERE e.dead_letter_at > pg_catalog.now() - interval '24 hours'
          AND m.premium_features
            @> '["shared_cart","shared_cart_realtime"]'::jsonb
      ) AS dead_lettered_24h
  )
  SELECT pg_catalog.jsonb_build_object(
    'healthy', stale_undelivered = 0 AND dead_lettered_24h = 0,
    'staleUndelivered', stale_undelivered,
    'deadLettered24h', dead_lettered_24h
  )
  FROM counts;
$$;
ALTER FUNCTION public.commerce_cart_publish_health() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.commerce_cart_publish_health()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commerce_cart_publish_health() TO anon;

-- Sweep schedule and its run-log retention. Non-destructive: the publisher
-- only sends notices for merchants enrolled in live updates. New jobs are
-- active as soon as they are scheduled.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pg_cron') THEN
    -- Start from a clean slate: cron.schedule only replaces a same-name
    -- job owned by the same role, and production already holds jobs with
    -- these names from the first switch-on attempt.
    PERFORM cron.unschedule(job.jobid)
    FROM cron.job AS job
    WHERE job.jobname IN (
      'commerce-cart-publish-events',
      'commerce-cart-publish-events-log-retention'
    );
    PERFORM cron.schedule(
      'commerce-cart-publish-events',
      '30 seconds',
      $job$SELECT public.commerce_cart_publish_events(50, 'pg-cron')$job$
    );
    PERFORM cron.schedule(
      'commerce-cart-publish-events-log-retention',
      '23 3 * * *',
      $job$DELETE FROM cron.job_run_details WHERE command = 'SELECT public.commerce_cart_publish_events(50, ''pg-cron'')' AND end_time < pg_catalog.clock_timestamp() - interval '7 days'$job$
    );
  END IF;
END;
$do$;
