-- Filter admin event-pipeline reads and replay selection by projected error codes.
BEGIN;

CREATE OR REPLACE FUNCTION public.list_event_pipeline_ingress_failures_admin_v3(
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
  IF p_error_code IS NOT NULL
    AND p_error_code <> private.project_admin_error_code_v1(p_error_code) THEN
    RAISE EXCEPTION 'invalid_projected_error_code' USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object(
    'count', (
      SELECT count(*)::bigint
      FROM public.domain_event_failures AS failure
      WHERE (p_error_code IS NULL
          OR private.project_admin_error_code_v1(failure.failure_code) = p_error_code)
        AND (p_merchant_id IS NULL OR failure.merchant_id = p_merchant_id)
        AND (p_from IS NULL OR failure.first_failed_at >= p_from)
        AND (p_to IS NULL OR failure.first_failed_at <= p_to)
    ),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', page.id,
        'event_name', page.event_name,
        'failure_code', private.project_admin_error_code_v1(page.failure_code),
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
        WHERE (p_error_code IS NULL
            OR private.project_admin_error_code_v1(failure.failure_code) = p_error_code)
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

CREATE OR REPLACE FUNCTION public.list_event_pipeline_deliveries_admin_v3(
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
  IF p_error_code IS NOT NULL
    AND p_error_code <> private.project_admin_error_code_v1(p_error_code) THEN
    RAISE EXCEPTION 'invalid_projected_error_code' USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object(
    'count', (
      SELECT count(*)::bigint
      FROM public.event_deliveries AS delivery
      INNER JOIN public.domain_event_ledger AS ledger
        ON ledger.domain_event_id = delivery.domain_event_id
      WHERE delivery.status = p_status
        AND (p_destination IS NULL OR delivery.destination = p_destination)
        AND (p_error_code IS NULL
          OR private.project_admin_error_code_v1(delivery.last_error_code) = p_error_code)
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
        'last_error_code', private.project_admin_error_code_v1(page.last_error_code),
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
          AND (p_error_code IS NULL
            OR private.project_admin_error_code_v1(delivery.last_error_code) = p_error_code)
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

CREATE OR REPLACE FUNCTION public.select_event_pipeline_replay_ids_v1(
  p_status text,
  p_destination text,
  p_error_code text DEFAULT NULL,
  p_merchant_id uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '5s'
AS $$
DECLARE
  v_ids uuid[];
BEGIN
  IF NOT eventing.is_event_pipeline_operator_v1() THEN
    RAISE EXCEPTION 'forbidden: event pipeline operator required'
      USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL
    OR p_destination IS NULL
    OR p_status NOT IN ('dead_letter', 'delivery_unknown')
    OR p_destination NOT IN ('facebook', 'tiktok', 'snapchat', 'ga4') THEN
    RAISE EXCEPTION 'invalid_replay_filter' USING ERRCODE = '22023';
  END IF;
  IF p_error_code IS NOT NULL
    AND p_error_code <> private.project_admin_error_code_v1(p_error_code) THEN
    RAISE EXCEPTION 'invalid_projected_error_code' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(array_agg(candidate.id ORDER BY candidate.updated_at), ARRAY[]::uuid[])
  INTO v_ids
  FROM (
    SELECT delivery.id, delivery.updated_at
    FROM public.event_deliveries AS delivery
    JOIN public.domain_event_ledger AS ledger
      ON ledger.domain_event_id = delivery.domain_event_id
    WHERE delivery.status = p_status
      AND delivery.destination = p_destination
      AND (p_error_code IS NULL
        OR private.project_admin_error_code_v1(delivery.last_error_code) = p_error_code)
      AND (p_merchant_id IS NULL OR ledger.merchant_id = p_merchant_id)
      AND (p_from IS NULL OR delivery.updated_at >= p_from)
      AND (p_to IS NULL OR delivery.updated_at <= p_to)
    ORDER BY delivery.updated_at, delivery.id
    LIMIT 100
  ) AS candidate;

  RETURN v_ids;
END;
$$;

ALTER FUNCTION public.list_event_pipeline_ingress_failures_admin_v3(integer, integer, text, uuid, timestamptz, timestamptz) OWNER TO postgres;
ALTER FUNCTION public.list_event_pipeline_deliveries_admin_v3(text, integer, integer, text, text, uuid, timestamptz, timestamptz) OWNER TO postgres;
ALTER FUNCTION public.select_event_pipeline_replay_ids_v1(text, text, text, uuid, timestamptz, timestamptz) OWNER TO postgres;

COMMIT;
