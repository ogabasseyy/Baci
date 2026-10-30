BEGIN;

CREATE OR REPLACE FUNCTION public.get_customer_savings_interest_snapshot(
  p_merchant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  earnings jsonb;
  history jsonb;
BEGIN
  BEGIN
    earnings := public.get_customer_savings_earnings(p_merchant_id, true);
    earnings := earnings || jsonb_build_object('earnings_available', true);
  EXCEPTION WHEN SQLSTATE '22003' THEN
    -- Keep the numeric projection unavailable when aggregate earnings or a
    -- per-goal amount is outside the safe range, but do not hide independently
    -- valid activity history behind that projection failure.
    earnings := jsonb_build_object(
      'earnings_available', false,
      'credited_interest_kobo', NULL,
      'goal_interest_kobo', '[]'::jsonb
    );
  END;

  -- Keep this outside the exception block: auth, tenant, and environment
  -- failures from history remain errors and are never converted to partial data.
  history := public.get_customer_savings_interest_history(p_merchant_id);
  RETURN earnings || jsonb_build_object(
    'interest_history', history->'interest_history'
  );
END;
$$;

COMMENT ON FUNCTION public.get_customer_savings_interest_snapshot(uuid) IS
  'Authenticated security-invoker snapshot. Earnings outside the safe numeric range are marked unavailable while independently valid interest history remains available; auth, tenant and environment guard failures still propagate.';

COMMIT;
