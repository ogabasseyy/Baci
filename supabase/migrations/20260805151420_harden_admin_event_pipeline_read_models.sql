-- Replace raw event-pipeline operator reads with redacted platform-admin DTOs.
-- Workers retain their service-role access to the legacy functions; browser
-- sessions can use only the fixed operations.read projections below.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.list_event_pipeline_ingress_failures_v1(
  integer, integer, text, uuid, timestamptz, timestamptz
) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.list_event_pipeline_deliveries_v1(
  text, integer, integer, text, text, uuid, timestamptz, timestamptz
) FROM authenticated;

CREATE OR REPLACE FUNCTION public.list_event_pipeline_ingress_failures_admin_v2(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_error_code text DEFAULT NULL,
  p_merchant_id uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '5s'
AS $$
DECLARE
  v_actor_user_id uuid := (SELECT auth.uid());
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_offset integer := LEAST(GREATEST(COALESCE(p_offset, 0), 0), 10000);
BEGIN
  IF v_actor_user_id IS NULL OR NOT private.has_platform_admin_permission_v1(
    v_actor_user_id,
    'operations.read'
  ) THEN
    RAISE EXCEPTION 'platform_admin_operations_read_required'
      USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'count', (
      SELECT count(*)::bigint
      FROM public.domain_event_failures AS failure
      WHERE (p_error_code IS NULL OR failure.failure_code = p_error_code)
        AND (p_merchant_id IS NULL OR failure.merchant_id = p_merchant_id)
        AND (p_from IS NULL OR failure.first_failed_at >= p_from)
        AND (p_to IS NULL OR failure.first_failed_at <= p_to)
    ),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', page.id,
        'event_name', page.event_name,
        'failure_code', page.failure_code,
        'first_failed_at', page.first_failed_at,
        'last_failed_at', page.last_failed_at,
        'replay_count', page.replay_count
      ) ORDER BY page.first_failed_at DESC, page.id DESC)
      FROM (
        SELECT
          failure.id,
          failure.event_name,
          failure.failure_code,
          failure.first_failed_at,
          failure.last_failed_at,
          failure.replay_count
        FROM public.domain_event_failures AS failure
        WHERE (p_error_code IS NULL OR failure.failure_code = p_error_code)
          AND (p_merchant_id IS NULL OR failure.merchant_id = p_merchant_id)
          AND (p_from IS NULL OR failure.first_failed_at >= p_from)
          AND (p_to IS NULL OR failure.first_failed_at <= p_to)
        ORDER BY failure.first_failed_at DESC, failure.id DESC
        LIMIT v_limit OFFSET v_offset
      ) AS page
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_event_pipeline_deliveries_admin_v2(
  p_status text,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_destination text DEFAULT NULL,
  p_error_code text DEFAULT NULL,
  p_merchant_id uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '5s'
AS $$
DECLARE
  v_actor_user_id uuid := (SELECT auth.uid());
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_offset integer := LEAST(GREATEST(COALESCE(p_offset, 0), 0), 10000);
BEGIN
  IF v_actor_user_id IS NULL OR NOT private.has_platform_admin_permission_v1(
    v_actor_user_id,
    'operations.read'
  ) THEN
    RAISE EXCEPTION 'platform_admin_operations_read_required'
      USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL
    OR p_status NOT IN ('dead_letter', 'delivery_unknown') THEN
    RAISE EXCEPTION 'invalid_event_delivery_status' USING ERRCODE = '22023';
  END IF;
  IF p_destination IS NOT NULL
    AND p_destination NOT IN ('facebook', 'tiktok', 'snapchat', 'ga4') THEN
    RAISE EXCEPTION 'invalid_event_destination' USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object(
    'count', (
      SELECT count(*)::bigint
      FROM public.event_deliveries AS delivery
      INNER JOIN public.domain_event_ledger AS ledger
        ON ledger.domain_event_id = delivery.domain_event_id
      WHERE delivery.status = p_status
        AND (p_destination IS NULL OR delivery.destination = p_destination)
        AND (p_error_code IS NULL OR delivery.last_error_code = p_error_code)
        AND (p_merchant_id IS NULL OR ledger.merchant_id = p_merchant_id)
        AND (p_from IS NULL OR delivery.updated_at >= p_from)
        AND (p_to IS NULL OR delivery.updated_at <= p_to)
    ),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', page.id,
        'destination', page.destination,
        'status', page.status,
        'attempts', page.attempts,
        'replay_count', page.replay_count,
        'last_error_code', page.last_error_code,
        'created_at', page.created_at,
        'updated_at', page.updated_at,
        'event_name', page.event_name
      ) ORDER BY page.updated_at DESC, page.id DESC)
      FROM (
        SELECT
          delivery.id,
          delivery.destination,
          delivery.status,
          delivery.attempts,
          delivery.replay_count,
          delivery.last_error_code,
          delivery.created_at,
          delivery.updated_at,
          ledger.event_name
        FROM public.event_deliveries AS delivery
        INNER JOIN public.domain_event_ledger AS ledger
          ON ledger.domain_event_id = delivery.domain_event_id
        WHERE delivery.status = p_status
          AND (p_destination IS NULL OR delivery.destination = p_destination)
          AND (p_error_code IS NULL OR delivery.last_error_code = p_error_code)
          AND (p_merchant_id IS NULL OR ledger.merchant_id = p_merchant_id)
          AND (p_from IS NULL OR delivery.updated_at >= p_from)
          AND (p_to IS NULL OR delivery.updated_at <= p_to)
        ORDER BY delivery.updated_at DESC, delivery.id DESC
        LIMIT v_limit OFFSET v_offset
      ) AS page
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_event_pipeline_operations_admin_v2()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '3s'
AS $$
DECLARE
  v_actor_user_id uuid := (SELECT auth.uid());
BEGIN
  IF v_actor_user_id IS NULL OR NOT private.has_platform_admin_permission_v1(
    v_actor_user_id,
    'operations.read'
  ) THEN
    RAISE EXCEPTION 'platform_admin_operations_read_required'
      USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'deliveries', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'destination', metric.destination,
        'status', metric.status,
        'delivery_count', metric.delivery_count,
        'oldest_age_seconds', metric.oldest_age_seconds
      ) ORDER BY metric.destination, metric.status)
      FROM (
        SELECT
          delivery.destination,
          delivery.status,
          count(*)::bigint AS delivery_count,
          floor(extract(epoch FROM (statement_timestamp() - min(delivery.created_at))))::integer
            AS oldest_age_seconds
        FROM public.event_deliveries AS delivery
        WHERE delivery.status IN ('pending', 'retry', 'claimed')
        GROUP BY delivery.destination, delivery.status
      ) AS metric
    ), '[]'::jsonb),
    'heartbeats', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'worker_name', heartbeat.worker_name,
        'worker_id', heartbeat.worker_id,
        'last_started_at', heartbeat.last_started_at,
        'last_succeeded_at', heartbeat.last_succeeded_at,
        'last_error_at', heartbeat.last_error_at,
        'last_error_code', heartbeat.last_error_code,
        'processed_count', heartbeat.processed_count,
        'updated_at', heartbeat.updated_at
      ) ORDER BY heartbeat.worker_name, heartbeat.worker_id)
      FROM public.event_pipeline_worker_heartbeats AS heartbeat
    ), '[]'::jsonb),
    'queue', (
      SELECT jsonb_build_object(
        'queue_length', metrics.queue_length,
        'newest_message_age_seconds', metrics.newest_msg_age_sec,
        'oldest_message_age_seconds', metrics.oldest_msg_age_sec,
        'total_messages', metrics.total_messages,
        'measured_at', metrics.scrape_time
      )
      FROM pgmq.metrics('domain_events') AS metrics
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_event_pipeline_ingress_failures_admin_v2(
  integer, integer, text, uuid, timestamptz, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_event_pipeline_deliveries_admin_v2(
  text, integer, integer, text, text, uuid, timestamptz, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_event_pipeline_operations_admin_v2()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_event_pipeline_ingress_failures_admin_v2(
  integer, integer, text, uuid, timestamptz, timestamptz
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_event_pipeline_deliveries_admin_v2(
  text, integer, integer, text, text, uuid, timestamptz, timestamptz
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_pipeline_operations_admin_v2()
  TO authenticated;

COMMIT;
