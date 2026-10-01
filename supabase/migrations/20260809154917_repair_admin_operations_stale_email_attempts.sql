-- Pending email attempts are only incidents once they outlive the normal
-- provider window. Surface those stalled rows beside terminal email failures.
ALTER FUNCTION public.get_admin_operations_v1(text, integer, integer)
  RENAME TO get_admin_operations_v0;

CREATE OR REPLACE FUNCTION public.get_admin_operations_v1(
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
  v_now timestamptz := statement_timestamp();
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 25), 100));
  v_offset integer := GREATEST(0, LEAST(COALESCE(p_offset, 0), 10000));
  v_stale_pending_count bigint;
  v_notification_email_items jsonb;
  v_result jsonb;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT private.has_platform_admin_permission_v1(
    (SELECT auth.uid()), 'operations.read'
  ) THEN
    RAISE EXCEPTION 'Platform admin access required' USING ERRCODE = '42501';
  END IF;
  IF p_section NOT IN ('all', 'financial', 'notifications', 'shipping', 'workers') THEN
    RAISE EXCEPTION 'Invalid operations section' USING ERRCODE = '22023';
  END IF;
  IF p_limit NOT BETWEEN 1 AND 100 OR p_offset NOT BETWEEN 0 AND 10000 THEN
    RAISE EXCEPTION 'Invalid operations page' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)::bigint INTO v_stale_pending_count
  FROM public.email_send_attempts AS email_attempt
  WHERE email_attempt.status = 'pending'
    AND email_attempt.updated_at < v_now - interval '15 minutes';

  -- Replace the legacy failed-only page with one globally ordered, bounded
  -- projection. Concatenating separately limited arrays could overflow the
  -- requested page and produce an incorrect order.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'attemptCount', email_attempt.attempt_count,
    'createdAt', email_attempt.created_at,
    'emailType', email_attempt.email_type,
    'id', email_attempt.id,
    'merchantId', email_attempt.merchant_id,
    'merchantName', COALESCE(merchant.business_name, 'Platform message'),
    'provider', email_attempt.provider,
    'providerErrorCode', email_attempt.provider_error_code,
    'status', CASE WHEN email_attempt.status = 'failed' THEN 'failed' ELSE 'stale' END
  ) ORDER BY email_attempt.created_at DESC), '[]'::jsonb)
  INTO v_notification_email_items
  FROM (
    SELECT attempt.id, attempt.merchant_id, attempt.provider, attempt.email_type, attempt.status,
      attempt.provider_error_code, attempt.attempt_count, attempt.created_at
    FROM public.email_send_attempts AS attempt
    WHERE attempt.status = 'failed'
      OR (attempt.status = 'pending'
        AND attempt.updated_at < v_now - interval '15 minutes')
    ORDER BY attempt.created_at DESC
    LIMIT v_limit OFFSET v_offset
  ) AS email_attempt
  LEFT JOIN public.merchants AS merchant ON merchant.id = email_attempt.merchant_id;

  v_result := public.get_admin_operations_v0(p_section, p_limit, p_offset);
  v_result := jsonb_set(
    v_result,
    '{summary,notifications}',
    to_jsonb(COALESCE((v_result #>> '{summary,notifications}')::bigint, 0) + v_stale_pending_count)
  );
  IF p_section IN ('all', 'notifications') THEN
    v_result := jsonb_set(
      v_result,
      '{notifications,email}',
      v_notification_email_items
    );
  END IF;
  RETURN v_result;
END;
$$;

ALTER FUNCTION public.get_admin_operations_v0(text, integer, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_admin_operations_v0(text, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION public.get_admin_operations_v1(text, integer, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_admin_operations_v1(text, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_operations_v1(text, integer, integer) TO authenticated;

COMMENT ON FUNCTION public.get_admin_operations_v1(text, integer, integer) IS
  'Platform-admin operational incidents. Failed emails are retained for review; pending emails become incidents only after a 15-minute stale threshold.';
