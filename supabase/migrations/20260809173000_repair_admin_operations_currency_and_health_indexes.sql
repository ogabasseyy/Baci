-- Settlement rows do not carry a trustworthy currency, so operations must
-- retain their incident metadata without presenting a made-up money value.
-- Preserve the production v2 error-code projection beneath this narrow wrapper.
ALTER FUNCTION public.get_admin_operations_v2(text, integer, integer)
  RENAME TO get_admin_operations_v2_error_code_projection;

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
  v_result := public.get_admin_operations_v2_error_code_projection(
    p_section, p_limit, p_offset
  );

  IF p_section IN ('all', 'financial') THEN
    v_result := jsonb_set(
      v_result,
      '{financial,settlements}',
      COALESCE((
        SELECT jsonb_agg(
          jsonb_set(
            jsonb_set(item.value, '{netAmount}', 'null'::jsonb, true),
            '{currency}', 'null'::jsonb, true
          )
          ORDER BY item.ordinality
        )
        FROM jsonb_array_elements(
          COALESCE(v_result #> '{financial,settlements}', '[]'::jsonb)
        ) WITH ORDINALITY AS item(value, ordinality)
      ), '[]'::jsonb),
      true
    );
  END IF;

  RETURN v_result;
END;
$$;

ALTER FUNCTION public.get_admin_operations_v2_error_code_projection(text, integer, integer)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_admin_operations_v2_error_code_projection(text, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION public.get_admin_operations_v2(text, integer, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_admin_operations_v2(text, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_operations_v2(text, integer, integer)
  TO authenticated;

-- Health is deliberately freshness-bounded; use the same terminal shipment
-- states as operations, including a recent return that requires triage.
ALTER FUNCTION public.get_admin_system_health_v1()
  RENAME TO get_admin_system_health_v1_push_freshness;

CREATE OR REPLACE FUNCTION public.get_admin_system_health_v1()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '5s'
AS $$
DECLARE
  v_now timestamptz := statement_timestamp();
  v_shipping_exception boolean;
  v_result jsonb;
  v_health jsonb;
BEGIN
  IF NOT private.has_platform_admin_permission_v1(
    (SELECT auth.uid()), 'operations.read'
  ) THEN
    RAISE EXCEPTION 'platform_permission_denied' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.shipping_webhook_events AS webhook
    WHERE webhook.processed IS NOT TRUE
      AND (webhook.error IS NOT NULL
        OR webhook.created_at < v_now - interval '15 minutes')
  ) OR EXISTS (
    SELECT 1 FROM public.shipments AS shipment
    WHERE lower(coalesce(shipment.status, '')) IN (
      'failed', 'exception', 'shipment_exception', 'delivery_attempt_failed',
      'returned'
    )
      AND shipment.updated_at >= v_now - interval '24 hours'
  ) INTO v_shipping_exception;

  v_result := public.get_admin_system_health_v1_push_freshness();
  SELECT COALESCE(jsonb_agg(
    CASE WHEN health_check.value ->> 'check_name' = 'Shipping operations' THEN
      jsonb_build_object(
        'check_name', 'Shipping operations',
        'status', CASE WHEN v_shipping_exception THEN 'critical' ELSE 'healthy' END,
        'message', CASE WHEN v_shipping_exception
          THEN 'A shipment exception or unprocessed shipping webhook needs attention.'
          ELSE 'No shipment exceptions or stale shipping webhooks were found.' END,
        'details', COALESCE(health_check.value -> 'details', '{}'::jsonb) ||
          jsonb_build_object('shipmentStatusWindow', '24 hours')
      )
    ELSE health_check.value END
    ORDER BY health_check.ordinality
  ), '[]'::jsonb)
  INTO v_health
  FROM jsonb_array_elements(COALESCE(v_result -> 'health', '[]'::jsonb))
    WITH ORDINALITY AS health_check(value, ordinality);

  RETURN jsonb_set(v_result, '{health}', v_health);
END;
$$;

ALTER FUNCTION public.get_admin_system_health_v1_push_freshness() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_admin_system_health_v1_push_freshness()
  FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION public.get_admin_system_health_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_admin_system_health_v1()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_system_health_v1() TO authenticated;

COMMENT ON FUNCTION public.get_admin_operations_v2(text, integer, integer) IS
  'Platform-admin operations v2. Currency-less settlement incidents retain identifiers and workflow metadata while withholding amount and currency.';
COMMENT ON FUNCTION public.get_admin_system_health_v1() IS
  'Returns bounded live database and operations health to callers with operations.read. Terminal email and push attempts age out after 24 hours; recent returned shipments remain actionable.';
