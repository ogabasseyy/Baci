-- Retention for shopper personal data held by the event pipeline.
--
-- Audit finding R1: ledger delivery data, event_deliveries.payload and
-- domain_event_failures.original_envelope hold the shopper's IP, user agent,
-- ad cookie ids, click ids, email and phone under data.delivery_user_data and
-- were never cleaned. This extends the existing retention RPC (same signature
-- and return columns, so the VPS worker and generated types are unchanged):
-- once a row is older than v_personal_data_retention and its delivery work is
-- finished, only that personal block is removed; the rest of the row stays.
--
-- OWNER DECISION: v_personal_data_retention (90 days) is the single place the
-- period is set.

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

  -- Finished deliveries: remove the shopper block from the per-destination copy.
  WITH expired_deliveries AS (
    SELECT delivery.id
    FROM public.event_deliveries AS delivery
    WHERE delivery.status IN
        ('delivered', 'skipped', 'shadowed', 'dead_letter', 'delivery_unknown')
      AND delivery.created_at < now() - v_personal_data_retention
      AND delivery.payload #> '{data,delivery_user_data}' IS NOT NULL
    ORDER BY delivery.created_at
    LIMIT 10000
  )
  UPDATE public.event_deliveries AS delivery
  SET payload = delivery.payload #- '{data,delivery_user_data}'
  FROM expired_deliveries AS expired
  WHERE delivery.id = expired.id;

  -- Ledger rows with no unfinished delivery work left.
  WITH expired_ledger AS (
    SELECT ledger.domain_event_id
    FROM public.domain_event_ledger AS ledger
    WHERE ledger.status <> 'queued'
      AND ledger.created_at < now() - v_personal_data_retention
      AND ledger.envelope #> '{data,delivery_user_data}' IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.event_deliveries AS open_delivery
        WHERE open_delivery.domain_event_id = ledger.domain_event_id
          AND open_delivery.status IN ('pending', 'claimed', 'retry')
      )
    ORDER BY ledger.created_at
    LIMIT 10000
  )
  UPDATE public.domain_event_ledger AS ledger
  SET envelope = ledger.envelope #- '{data,delivery_user_data}'
  FROM expired_ledger AS expired
  WHERE ledger.domain_event_id = expired.domain_event_id;

  -- Dead-letter evidence rows.
  WITH expired_failures AS (
    SELECT failure.id
    FROM public.domain_event_failures AS failure
    WHERE failure.first_failed_at < now() - v_personal_data_retention
      AND failure.original_envelope #> '{data,delivery_user_data}' IS NOT NULL
    ORDER BY failure.first_failed_at
    LIMIT 10000
  )
  UPDATE public.domain_event_failures AS failure
  SET original_envelope = failure.original_envelope #- '{data,delivery_user_data}'
  FROM expired_failures AS expired
  WHERE failure.id = expired.id;

  RETURN QUERY SELECT v_attempts_deleted, v_archive_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_domain_event_pipeline_v1(interval, interval)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_domain_event_pipeline_v1(interval, interval)
  TO service_role;
