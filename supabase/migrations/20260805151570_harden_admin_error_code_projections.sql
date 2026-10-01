-- Redact externally supplied diagnostic strings before they reach browser-admin DTOs.
BEGIN;

CREATE OR REPLACE FUNCTION private.project_admin_error_code_v1(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE lower(pg_catalog.btrim(COALESCE(p_value, '')))
    WHEN 'analytics_config_unavailable' THEN 'analytics_config_unavailable'
    WHEN 'batch_partial_failure' THEN 'batch_partial_failure'
    WHEN 'destination_not_configured' THEN 'destination_not_configured'
    WHEN 'domain_event_message_failed' THEN 'domain_event_message_failed'
    WHEN 'domain_event_message_invalid' THEN 'domain_event_message_invalid'
    WHEN 'domain_event_read_failed' THEN 'domain_event_read_failed'
    WHEN 'domain_event_read_invalid' THEN 'domain_event_read_invalid'
    WHEN 'domain_event_route_failed' THEN 'domain_event_route_failed'
    WHEN 'event_delivery_claim_failed' THEN 'event_delivery_claim_failed'
    WHEN 'ingress_dead_letter_failed' THEN 'ingress_dead_letter_failed'
    WHEN 'invalid_destination_credentials' THEN 'invalid_destination_credentials'
    WHEN 'invalid_destination_payload' THEN 'invalid_destination_payload'
    WHEN 'invalid_event_envelope' THEN 'invalid_event_envelope'
    WHEN 'invalid_payload' THEN 'invalid_payload'
    WHEN 'max_attempts_exceeded' THEN 'max_attempts_exceeded'
    WHEN 'missing_immutable_data' THEN 'missing_immutable_data'
    WHEN 'paid_order_lookup_failed' THEN 'paid_order_lookup_failed'
    WHEN 'paid_order_not_deliverable' THEN 'paid_order_not_deliverable'
    WHEN 'provider_failure' THEN 'provider_failure'
    WHEN 'provider_rejected' THEN 'provider_rejected'
    WHEN 'provider_request_timeout' THEN 'provider_request_timeout'
    WHEN 'routing_attempts_exhausted' THEN 'routing_attempts_exhausted'
    WHEN 'timeout' THEN 'timeout'
    WHEN 'unsupported_event' THEN 'unsupported_event'
    ELSE 'unclassified_error'
  END;
$$;

ALTER FUNCTION private.project_admin_error_code_v1(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.project_admin_error_code_v1(text)
  FROM PUBLIC, anon, authenticated, service_role;

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
  v_result jsonb;
BEGIN
  v_result := public.list_event_pipeline_ingress_failures_admin_v2(
    p_limit, p_offset, p_error_code, p_merchant_id, p_from, p_to
  );
  RETURN pg_catalog.jsonb_set(
    v_result,
    '{items}',
    COALESCE((
      SELECT pg_catalog.jsonb_agg(
        item.value || pg_catalog.jsonb_build_object(
          'failure_code', private.project_admin_error_code_v1(item.value->>'failure_code')
        )
        ORDER BY item.ordinality
      )
      FROM pg_catalog.jsonb_array_elements(v_result->'items') WITH ORDINALITY AS item(value, ordinality)
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
  v_result jsonb;
BEGIN
  v_result := public.list_event_pipeline_deliveries_admin_v2(
    p_status, p_limit, p_offset, p_destination, p_error_code, p_merchant_id, p_from, p_to
  );
  RETURN pg_catalog.jsonb_set(
    v_result,
    '{items}',
    COALESCE((
      SELECT pg_catalog.jsonb_agg(
        item.value || pg_catalog.jsonb_build_object(
          'last_error_code', private.project_admin_error_code_v1(item.value->>'last_error_code')
        )
        ORDER BY item.ordinality
      )
      FROM pg_catalog.jsonb_array_elements(v_result->'items') WITH ORDINALITY AS item(value, ordinality)
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_event_pipeline_operations_admin_v3()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '5s'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.get_event_pipeline_operations_admin_v2();
  RETURN pg_catalog.jsonb_set(
    v_result,
    '{heartbeats}',
    COALESCE((
      SELECT pg_catalog.jsonb_agg(
        (item.value - 'worker_id') || pg_catalog.jsonb_build_object(
          'last_error_code', private.project_admin_error_code_v1(item.value->>'last_error_code')
        )
        ORDER BY item.ordinality
      )
      FROM pg_catalog.jsonb_array_elements(v_result->'heartbeats') WITH ORDINALITY AS item(value, ordinality)
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_admin_operations_v2(
  p_section text DEFAULT 'all',
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '5s'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.get_admin_operations_v1(p_section, p_limit, p_offset);
  v_result := pg_catalog.jsonb_set(
    v_result,
    '{notifications,email}',
    COALESCE((
      SELECT pg_catalog.jsonb_agg(
        item.value || pg_catalog.jsonb_build_object(
          'providerErrorCode', private.project_admin_error_code_v1(item.value->>'providerErrorCode')
        )
        ORDER BY item.ordinality
      )
      FROM pg_catalog.jsonb_array_elements(v_result #> '{notifications,email}') WITH ORDINALITY AS item(value, ordinality)
    ), '[]'::jsonb)
  );
  RETURN pg_catalog.jsonb_set(
    v_result,
    '{workers}',
    COALESCE((
      SELECT pg_catalog.jsonb_agg(
        (item.value - 'workerId') || pg_catalog.jsonb_build_object(
          'lastErrorCode', private.project_admin_error_code_v1(item.value->>'lastErrorCode')
        )
        ORDER BY item.ordinality
      )
      FROM pg_catalog.jsonb_array_elements(v_result->'workers') WITH ORDINALITY AS item(value, ordinality)
    ), '[]'::jsonb)
  );
END;
$$;

ALTER FUNCTION public.list_event_pipeline_ingress_failures_admin_v3(integer, integer, text, uuid, timestamptz, timestamptz) OWNER TO postgres;
ALTER FUNCTION public.list_event_pipeline_deliveries_admin_v3(text, integer, integer, text, text, uuid, timestamptz, timestamptz) OWNER TO postgres;
ALTER FUNCTION public.get_event_pipeline_operations_admin_v3() OWNER TO postgres;
ALTER FUNCTION public.get_admin_operations_v2(text, integer, integer) OWNER TO postgres;

REVOKE EXECUTE ON FUNCTION public.list_event_pipeline_ingress_failures_admin_v2(integer, integer, text, uuid, timestamptz, timestamptz) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.list_event_pipeline_deliveries_admin_v2(text, integer, integer, text, text, uuid, timestamptz, timestamptz) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_event_pipeline_operations_admin_v2() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_admin_operations_v1(text, integer, integer) FROM authenticated;
REVOKE ALL ON FUNCTION public.list_event_pipeline_ingress_failures_admin_v3(integer, integer, text, uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_event_pipeline_deliveries_admin_v3(text, integer, integer, text, text, uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_event_pipeline_operations_admin_v3() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_admin_operations_v2(text, integer, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_event_pipeline_ingress_failures_admin_v3(integer, integer, text, uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_event_pipeline_deliveries_admin_v3(text, integer, integer, text, text, uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_pipeline_operations_admin_v3() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_operations_v2(text, integer, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.write_platform_audit_event_v1(text, text, text, text[], jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION public.write_platform_audit_event_v1(text, text, text, text[], jsonb);

COMMIT;
