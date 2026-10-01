-- Permission-gated composition for the live platform-admin analytics RPC.
-- "All" begins at Baci's production analytics start (18 December 2025,
-- Africa/Lagos), excluding imported pre-launch history.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_admin_platform_analytics(
  p_period text DEFAULT 'all'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := statement_timestamp();
  v_platform_start timestamptz :=
    (timestamp '2025-12-18 00:00:00' AT TIME ZONE 'Africa/Lagos');
  v_period_days integer;
  v_start_at timestamptz;
  v_previous_start_at timestamptz;
  v_previous_end_at timestamptz;
  v_result jsonb;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT private.has_platform_admin_permission_v1(
    (SELECT auth.uid()),
    'analytics.read'
  ) THEN
    RAISE EXCEPTION 'Platform admin access required' USING ERRCODE = '42501';
  END IF;

  IF p_period NOT IN ('7d', '30d', '90d', 'all') THEN
    RAISE EXCEPTION 'Invalid analytics period' USING ERRCODE = '22023';
  END IF;

  v_period_days := CASE p_period
    WHEN '7d' THEN 7
    WHEN '30d' THEN 30
    WHEN '90d' THEN 90
    ELSE NULL
  END;

  IF p_period = 'all' THEN
    v_start_at := v_platform_start;
    v_previous_start_at := v_platform_start;
    v_previous_end_at := v_platform_start;
  ELSE
    v_start_at := v_now - make_interval(days => v_period_days);
    v_previous_end_at := v_start_at;
    v_previous_start_at := v_start_at - make_interval(days => v_period_days);
  END IF;

  WITH
  summary AS (
    SELECT private.get_admin_platform_analytics_summary_v1(
      p_period, v_now, v_start_at, v_previous_start_at, v_previous_end_at
    ) AS value
  ),
  breakdowns AS (
    SELECT private.get_admin_platform_analytics_breakdowns_v1(
      v_start_at, v_now
    ) AS value
  ),
  merchant_profile AS (
    SELECT private.get_admin_platform_analytics_merchants_v1(
      v_now, v_platform_start
    ) AS value
  )
  SELECT jsonb_build_object('summary', summary.value)
  || breakdowns.value
  || (merchant_profile.value - 'growth')
  || jsonb_build_object(
    -- merchantGrowthRate is Lagos calendar-month sign-up growth; gmvGrowthRate
    -- is the selected rolling order window versus its prior matching window.
    'growth', (merchant_profile.value -> 'growth') || jsonb_build_object(
      'gmvGrowthRate', summary.value -> 'gmvChange'
    )
  )
  || jsonb_build_object('generatedAt', v_now)
  INTO v_result
  FROM summary
  CROSS JOIN breakdowns
  CROSS JOIN merchant_profile;

  RETURN v_result;
END;
$$;

ALTER FUNCTION public.get_admin_platform_analytics(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_admin_platform_analytics(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_platform_analytics(text)
  TO authenticated;

COMMENT ON FUNCTION public.get_admin_platform_analytics(text) IS
  'Permission-gated live platform analytics. Monetary metrics and money breakdowns are NGN-only; non-NGN or unknown-currency orders are counted as excluded. Settlement money is unavailable because its ledger has no currency field. GMV growth uses the selected rolling window, while merchant growth uses Africa/Lagos calendar months.';

COMMIT;
