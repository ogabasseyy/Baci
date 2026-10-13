-- Do not turn currency-less settlement ledger amounts into an "UNK" money lane.
CREATE OR REPLACE FUNCTION public.get_admin_reconciliation_v2(
  p_period text DEFAULT '30d', p_currency text DEFAULT NULL,
  p_merchant_id uuid DEFAULT NULL, p_lane text DEFAULT 'all',
  p_status text DEFAULT 'all', p_cursor_created_at timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL, p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
  v_supported_currencies jsonb;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT private.has_platform_admin_permission_v1(
    (SELECT auth.uid()), 'financials.read'
  ) THEN
    RAISE EXCEPTION 'Platform admin access required' USING ERRCODE = '42501';
  END IF;
  IF p_currency = 'UNK' THEN
    RAISE EXCEPTION 'Currency-less settlements cannot be used for money totals'
      USING ERRCODE = '22023';
  END IF;

  v_result := public.get_admin_reconciliation(
    p_period, p_currency, p_merchant_id, p_lane, p_status,
    p_cursor_created_at, p_cursor_id, p_limit
  );
  SELECT COALESCE(jsonb_agg(currency.value ORDER BY currency.value), '[]'::jsonb)
    INTO v_supported_currencies
  FROM jsonb_array_elements_text(v_result -> 'supportedCurrencies') AS currency(value)
  WHERE currency.value <> 'UNK';

  v_result := jsonb_set(v_result, '{supportedCurrencies}', v_supported_currencies);
  v_result := jsonb_set(v_result, '{metrics,platformSettlements,pendingAmount}', 'null'::jsonb);
  v_result := jsonb_set(v_result, '{metrics,platformSettlements,settledAmount}', 'null'::jsonb);
  v_result := jsonb_set(v_result, '{metrics,platformSettlements,failedAmount}', 'null'::jsonb);
  v_result := jsonb_set(v_result, '{metrics,directSettlements,amount}', 'null'::jsonb);
  RETURN v_result || jsonb_build_object('reviewScope', 'all_unresolved');
END;
$$;

ALTER FUNCTION public.get_admin_reconciliation_v2(
  text, text, uuid, text, text, timestamptz, uuid, integer
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_admin_reconciliation_v2(
  text, text, uuid, text, text, timestamptz, uuid, integer
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_reconciliation_v2(
  text, text, uuid, text, text, timestamptz, uuid, integer
) TO authenticated;
COMMENT ON FUNCTION public.get_admin_reconciliation_v2(
  text, text, uuid, text, text, timestamptz, uuid, integer
) IS 'Admin reconciliation v2. Currency-less settlement amounts are withheld; reviews are all unresolved cases.';
