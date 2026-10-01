-- Settlement ledger rows do not contain verifiable currency. Do not expose
-- their amounts in a selected-currency reconciliation activity feed.
CREATE OR REPLACE FUNCTION public.get_admin_reconciliation_v3(
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
  v_items jsonb;
BEGIN
  v_result := public.get_admin_reconciliation_v2(
    p_period, p_currency, p_merchant_id, p_lane, p_status,
    p_cursor_created_at, p_cursor_id, p_limit
  );

  SELECT COALESCE(
    jsonb_agg(
      CASE
        WHEN item.value ->> 'lane' IN ('platform_settlement', 'direct_settlement')
          THEN jsonb_set(
            jsonb_set(item.value, '{amount}', 'null'::jsonb),
            '{currency}', 'null'::jsonb
          )
        ELSE item.value
      END
      ORDER BY item.ordinality
    ),
    '[]'::jsonb
  )
  INTO v_items
  FROM jsonb_array_elements(COALESCE(v_result -> 'items', '[]'::jsonb))
    WITH ORDINALITY AS item(value, ordinality);

  RETURN jsonb_set(v_result, '{items}', v_items);
END;
$$;

ALTER FUNCTION public.get_admin_reconciliation_v3(
  text, text, uuid, text, text, timestamptz, uuid, integer
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_admin_reconciliation_v3(
  text, text, uuid, text, text, timestamptz, uuid, integer
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_reconciliation_v3(
  text, text, uuid, text, text, timestamptz, uuid, integer
) TO authenticated;
COMMENT ON FUNCTION public.get_admin_reconciliation_v3(
  text, text, uuid, text, text, timestamptz, uuid, integer
) IS 'Admin reconciliation v3. Settlement activity item amounts and currencies are withheld because the source ledger lacks currency evidence.';
