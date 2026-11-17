-- Retention for shopper personal data held by the event pipeline.
--
-- Audit finding R1: ledger delivery data, event_deliveries.payload and
-- domain_event_failures.original_envelope hold the shopper's IP, user agent,
-- ad cookie ids, click ids, email and phone under data.delivery_user_data and
-- were never cleaned. This extends the existing retention RPC (same signature
-- and return columns, so the VPS worker and generated types are unchanged):
-- once a row is older than v_personal_data_retention and its delivery work is
-- finished, only that personal block (and the stray data.event_data.user_agent)
-- is removed (the two consent flags stay as the record of what was allowed);
-- the rest of the row stays. Ledger rows still queued after the
-- whole period are dead messages and are scrubbed too; failure rows follow
-- their latest failure, not the first.
--
-- OWNER DECISION: v_personal_data_retention (90 days) is the single place the
-- period is set.
--
-- POLICY (documented, not an oversight):
-- * Replaying a dead_letter or delivery_unknown delivery after the period is
--   intentionally unsupported: ad platforms reject events older than about 7
--   days, so a replay that late could not succeed even with the shopper ids.
--   The row, its status and the rest of the payload stay for reconciliation.
-- * A ledger row still queued after the period is a dead message by policy
--   (the queue archive itself is purged at 30 days); it is scrubbed like any
--   other row, and so is its copy in the live queue (pgmq.q_domain_events).

-- Partial indexes hold only rows that still carry personal data (any key in
-- delivery_user_data besides the two consent flags, or a stray user agent), so
-- the scrub finds its work without scanning rows that were already minimised
-- at ingest or cleaned.
CREATE INDEX IF NOT EXISTS idx_event_deliveries_personal_data_created
  ON public.event_deliveries (created_at)
  WHERE ((jsonb_typeof(payload #> '{data,delivery_user_data}') = 'object'
          AND (payload #> '{data,delivery_user_data}') - 'analytics_consent' - 'marketing_consent' <> '{}'::jsonb)
        OR payload #> '{data,event_data,user_agent}' IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_domain_event_ledger_personal_data_created
  ON public.domain_event_ledger (created_at)
  WHERE ((jsonb_typeof(envelope #> '{data,delivery_user_data}') = 'object'
          AND (envelope #> '{data,delivery_user_data}') - 'analytics_consent' - 'marketing_consent' <> '{}'::jsonb)
        OR envelope #> '{data,event_data,user_agent}' IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_domain_event_failures_personal_data_failed
  ON public.domain_event_failures (first_failed_at)
  WHERE ((jsonb_typeof(original_envelope #> '{data,delivery_user_data}') = 'object'
          AND (original_envelope #> '{data,delivery_user_data}') - 'analytics_consent' - 'marketing_consent' <> '{}'::jsonb)
        OR original_envelope #> '{data,event_data,user_agent}' IS NOT NULL);

CREATE OR REPLACE FUNCTION public.cleanup_domain_event_pipeline_v1(
  p_delivered_attempt_retention interval DEFAULT interval '30 days',
  p_queue_archive_retention interval DEFAULT interval '30 days'
) RETURNS TABLE (
  delivery_attempts_deleted bigint,
  queue_archive_messages_deleted bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s'
AS $$
DECLARE
  v_personal_data_retention CONSTANT interval := interval '90 days';
  v_attempts_deleted bigint;
  v_archive_deleted bigint;
  v_batch bigint;
  v_deadline timestamptz;
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden: cleanup_domain_event_pipeline_v1 requires service_role'
      USING ERRCODE = '42501';
  END IF;
  IF p_delivered_attempt_retention < interval '30 days' THEN
    RAISE EXCEPTION 'delivered_attempt_retention_must_be_at_least_30_days'
      USING ERRCODE = '22023';
  END IF;
  IF p_queue_archive_retention < interval '30 days' THEN
    RAISE EXCEPTION 'queue_archive_retention_must_be_at_least_30_days'
      USING ERRCODE = '22023';
  END IF;

  WITH expired_attempts AS (
    SELECT attempt.id
    FROM public.event_delivery_attempts AS attempt
    JOIN public.event_deliveries AS delivery
      ON delivery.id = attempt.delivery_id
    WHERE delivery.status IN ('delivered', 'skipped')
      AND attempt.finished_at < now() - p_delivered_attempt_retention
    ORDER BY attempt.finished_at
    LIMIT 10000
  )
  DELETE FROM public.event_delivery_attempts AS attempt
  USING expired_attempts AS expired
  WHERE attempt.id = expired.id;
  GET DIAGNOSTICS v_attempts_deleted = ROW_COUNT;

  WITH expired_archive AS (
    SELECT archive.ctid
    FROM pgmq.a_domain_events AS archive
    WHERE archive.archived_at < now() - p_queue_archive_retention
    ORDER BY archive.archived_at
    LIMIT 10000
  )
  DELETE FROM pgmq.a_domain_events AS archive
  USING expired_archive AS expired
  WHERE archive.ctid = expired.ctid;
  GET DIAGNOSTICS v_archive_deleted = ROW_COUNT;

  -- Each scrub works in batches of 10,000 until nothing is left or its own
  -- 4 second budget is used (five scrubs plus the deletes above stay inside
  -- the 30 second statement limit). Anything left over carries to the next
  -- daily run, so a very large backlog drains over days, never in one rolled
  -- back run. Rows are locked (SKIP LOCKED) and the status test is repeated in
  -- the UPDATE, so a delivery replayed at the same moment is never scrubbed
  -- while active.

  -- Finished deliveries: remove the shopper block from the per-destination copy.
  v_deadline := clock_timestamp() + interval '4 seconds';
  LOOP
    WITH expired_deliveries AS (
      SELECT delivery.id
      FROM public.event_deliveries AS delivery
      WHERE delivery.status IN
          ('delivered', 'skipped', 'shadowed', 'dead_letter', 'delivery_unknown')
        AND delivery.created_at < now() - v_personal_data_retention
        AND ((jsonb_typeof(delivery.payload #> '{data,delivery_user_data}') = 'object'
          AND (delivery.payload #> '{data,delivery_user_data}') - 'analytics_consent' - 'marketing_consent' <> '{}'::jsonb)
        OR delivery.payload #> '{data,event_data,user_agent}' IS NOT NULL)
      ORDER BY delivery.created_at
      LIMIT 10000
      FOR UPDATE SKIP LOCKED
    )
    UPDATE public.event_deliveries AS delivery
    SET payload = CASE WHEN delivery.payload #> '{data,delivery_user_data}' IS NULL
        THEN delivery.payload #- '{data,event_data,user_agent}'
        ELSE jsonb_set(
          delivery.payload #- '{data,event_data,user_agent}',
          '{data,delivery_user_data}',
          jsonb_strip_nulls(jsonb_build_object(
            'analytics_consent', coalesce(delivery.payload #> '{data,delivery_user_data,analytics_consent}', 'false'::jsonb),
            'marketing_consent', coalesce(delivery.payload #> '{data,delivery_user_data,marketing_consent}', 'false'::jsonb)))
        ) END
    FROM expired_deliveries AS expired
    WHERE delivery.id = expired.id
      AND delivery.status IN
        ('delivered', 'skipped', 'shadowed', 'dead_letter', 'delivery_unknown');
    GET DIAGNOSTICS v_batch = ROW_COUNT;
    EXIT WHEN v_batch < 10000 OR clock_timestamp() > v_deadline;
  END LOOP;

  -- The live queue holds its own copy of each queued envelope; scrub the copy
  -- of a ledger row that is past the period with no open delivery work.
  v_deadline := clock_timestamp() + interval '4 seconds';
  LOOP
    WITH expired_queue AS (
      SELECT queued.msg_id
      FROM pgmq.q_domain_events AS queued
      JOIN public.domain_event_ledger AS ledger
        ON ledger.queue_message_id = queued.msg_id
      WHERE queued.enqueued_at < now() - v_personal_data_retention
        AND ledger.created_at < now() - v_personal_data_retention
        AND ((jsonb_typeof(queued.message #> '{data,delivery_user_data}') = 'object'
          AND (queued.message #> '{data,delivery_user_data}') - 'analytics_consent' - 'marketing_consent' <> '{}'::jsonb)
        OR queued.message #> '{data,event_data,user_agent}' IS NOT NULL)
        AND NOT EXISTS (
          SELECT 1
          FROM public.event_deliveries AS open_delivery
          WHERE open_delivery.domain_event_id = ledger.domain_event_id
            AND open_delivery.status IN ('pending', 'claimed', 'retry')
        )
      ORDER BY queued.enqueued_at
      LIMIT 10000
      FOR UPDATE OF queued SKIP LOCKED
    )
    UPDATE pgmq.q_domain_events AS queued
    SET message = CASE WHEN queued.message #> '{data,delivery_user_data}' IS NULL
        THEN queued.message #- '{data,event_data,user_agent}'
        ELSE jsonb_set(
          queued.message #- '{data,event_data,user_agent}',
          '{data,delivery_user_data}',
          jsonb_strip_nulls(jsonb_build_object(
            'analytics_consent', coalesce(queued.message #> '{data,delivery_user_data,analytics_consent}', 'false'::jsonb),
            'marketing_consent', coalesce(queued.message #> '{data,delivery_user_data,marketing_consent}', 'false'::jsonb)))
        ) END
    FROM expired_queue AS expired
    WHERE queued.msg_id = expired.msg_id
      AND queued.enqueued_at < now() - v_personal_data_retention
      AND NOT EXISTS (
        SELECT 1
        FROM public.domain_event_ledger AS ledger
        JOIN public.event_deliveries AS open_delivery
          ON open_delivery.domain_event_id = ledger.domain_event_id
        WHERE ledger.queue_message_id = queued.msg_id
          AND open_delivery.status IN ('pending', 'claimed', 'retry')
      );
    GET DIAGNOSTICS v_batch = ROW_COUNT;
    EXIT WHEN v_batch < 10000 OR clock_timestamp() > v_deadline;
  END LOOP;

  -- Ledger rows with no unfinished delivery work left.
  v_deadline := clock_timestamp() + interval '4 seconds';
  LOOP
    WITH expired_ledger AS (
      SELECT ledger.domain_event_id
      FROM public.domain_event_ledger AS ledger
      WHERE ledger.created_at < now() - v_personal_data_retention
        AND ((jsonb_typeof(ledger.envelope #> '{data,delivery_user_data}') = 'object'
          AND (ledger.envelope #> '{data,delivery_user_data}') - 'analytics_consent' - 'marketing_consent' <> '{}'::jsonb)
        OR ledger.envelope #> '{data,event_data,user_agent}' IS NOT NULL)
        AND NOT EXISTS (
          SELECT 1
          FROM public.event_deliveries AS open_delivery
          WHERE open_delivery.domain_event_id = ledger.domain_event_id
            AND open_delivery.status IN ('pending', 'claimed', 'retry')
        )
      ORDER BY ledger.created_at
      LIMIT 10000
      FOR UPDATE OF ledger SKIP LOCKED
    )
    UPDATE public.domain_event_ledger AS ledger
    SET envelope = CASE WHEN ledger.envelope #> '{data,delivery_user_data}' IS NULL
        THEN ledger.envelope #- '{data,event_data,user_agent}'
        ELSE jsonb_set(
          ledger.envelope #- '{data,event_data,user_agent}',
          '{data,delivery_user_data}',
          jsonb_strip_nulls(jsonb_build_object(
            'analytics_consent', coalesce(ledger.envelope #> '{data,delivery_user_data,analytics_consent}', 'false'::jsonb),
            'marketing_consent', coalesce(ledger.envelope #> '{data,delivery_user_data,marketing_consent}', 'false'::jsonb)))
        ) END
    FROM expired_ledger AS expired
    WHERE ledger.domain_event_id = expired.domain_event_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.event_deliveries AS open_delivery
        WHERE open_delivery.domain_event_id = ledger.domain_event_id
          AND open_delivery.status IN ('pending', 'claimed', 'retry')
      );
    GET DIAGNOSTICS v_batch = ROW_COUNT;
    EXIT WHEN v_batch < 10000 OR clock_timestamp() > v_deadline;
  END LOOP;

  -- Dead-letter evidence rows.
  v_deadline := clock_timestamp() + interval '4 seconds';
  LOOP
    WITH expired_failures AS (
      SELECT failure.id
      FROM public.domain_event_failures AS failure
      WHERE failure.first_failed_at < now() - v_personal_data_retention
        AND failure.last_failed_at < now() - v_personal_data_retention
        AND ((jsonb_typeof(failure.original_envelope #> '{data,delivery_user_data}') = 'object'
          AND (failure.original_envelope #> '{data,delivery_user_data}') - 'analytics_consent' - 'marketing_consent' <> '{}'::jsonb)
        OR failure.original_envelope #> '{data,event_data,user_agent}' IS NOT NULL)
      ORDER BY failure.first_failed_at
      LIMIT 10000
      FOR UPDATE SKIP LOCKED
    )
    UPDATE public.domain_event_failures AS failure
    SET original_envelope = CASE WHEN failure.original_envelope #> '{data,delivery_user_data}' IS NULL
        THEN failure.original_envelope #- '{data,event_data,user_agent}'
        ELSE jsonb_set(
          failure.original_envelope #- '{data,event_data,user_agent}',
          '{data,delivery_user_data}',
          jsonb_strip_nulls(jsonb_build_object(
            'analytics_consent', coalesce(failure.original_envelope #> '{data,delivery_user_data,analytics_consent}', 'false'::jsonb),
            'marketing_consent', coalesce(failure.original_envelope #> '{data,delivery_user_data,marketing_consent}', 'false'::jsonb)))
        ) END
    FROM expired_failures AS expired
    WHERE failure.id = expired.id
      AND failure.first_failed_at < now() - v_personal_data_retention
      AND failure.last_failed_at < now() - v_personal_data_retention;
    GET DIAGNOSTICS v_batch = ROW_COUNT;
    EXIT WHEN v_batch < 10000 OR clock_timestamp() > v_deadline;
  END LOOP;

  -- The queue archive keeps its own copy of every routed envelope, stamped
  -- with the archive time, so an event archived late would otherwise outlive
  -- the period. Scrub by the event's own age (enqueued_at).
  v_deadline := clock_timestamp() + interval '4 seconds';
  LOOP
    WITH expired_archive AS (
      SELECT archived.msg_id
      FROM pgmq.a_domain_events AS archived
      WHERE archived.enqueued_at < now() - v_personal_data_retention
        AND ((jsonb_typeof(archived.message #> '{data,delivery_user_data}') = 'object'
          AND (archived.message #> '{data,delivery_user_data}') - 'analytics_consent' - 'marketing_consent' <> '{}'::jsonb)
        OR archived.message #> '{data,event_data,user_agent}' IS NOT NULL)
      ORDER BY archived.enqueued_at
      LIMIT 10000
      FOR UPDATE OF archived SKIP LOCKED
    )
    UPDATE pgmq.a_domain_events AS archived
    SET message = CASE WHEN archived.message #> '{data,delivery_user_data}' IS NULL
        THEN archived.message #- '{data,event_data,user_agent}'
        ELSE jsonb_set(
          archived.message #- '{data,event_data,user_agent}',
          '{data,delivery_user_data}',
          jsonb_strip_nulls(jsonb_build_object(
            'analytics_consent', coalesce(archived.message #> '{data,delivery_user_data,analytics_consent}', 'false'::jsonb),
            'marketing_consent', coalesce(archived.message #> '{data,delivery_user_data,marketing_consent}', 'false'::jsonb)))
        ) END
    FROM expired_archive AS expired
    WHERE archived.msg_id = expired.msg_id
      AND archived.enqueued_at < now() - v_personal_data_retention;
    GET DIAGNOSTICS v_batch = ROW_COUNT;
    EXIT WHEN v_batch < 10000 OR clock_timestamp() > v_deadline;
  END LOOP;

  RETURN QUERY SELECT v_attempts_deleted, v_archive_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_domain_event_pipeline_v1(interval, interval)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_domain_event_pipeline_v1(interval, interval)
  TO service_role;
