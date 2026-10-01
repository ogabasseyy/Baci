-- Keep unreconciled refund intents out of the financial reconciliation feed.
-- A transaction recorded as transaction_type=refund/status=pending is not a
-- completed refund and must not be presented as a refund activity item.
-- Preserve the existing v3 implementation under an internal name, then add a
-- narrow compatibility wrapper so this invariant is enforced for all callers.

ALTER FUNCTION public.get_admin_reconciliation_v3(text, text, uuid, text, text, timestamptz, uuid, integer)
  RENAME TO get_admin_reconciliation_v3_base;
REVOKE ALL ON FUNCTION public.get_admin_reconciliation_v3_base(text, text, uuid, text, text, timestamptz, uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_admin_reconciliation_v3(
  p_period text DEFAULT '30d',
  p_currency text DEFAULT 'NGN',
  p_merchant_id uuid DEFAULT NULL,
  p_lane text DEFAULT 'all',
  p_status text DEFAULT 'all',
  p_cursor_created_at timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '8s'
AS $$
DECLARE
  v_result jsonb;
  v_items jsonb;
BEGIN
  v_result := public.get_admin_reconciliation_v3_base(
    p_period, p_currency, p_merchant_id, p_lane, p_status,
    p_cursor_created_at, p_cursor_id, p_limit
  );

  SELECT COALESCE(jsonb_agg(item ORDER BY ord), '[]'::jsonb)
    INTO v_items
  FROM jsonb_array_elements(COALESCE(v_result->'items', '[]'::jsonb)) WITH ORDINALITY AS rows(item, ord)
  WHERE NOT (
    item->>'lane' = 'refund'
    AND item->>'status' = 'pending'
  );

  RETURN jsonb_set(v_result, '{items}', v_items, true);
END;
$$;

ALTER FUNCTION public.get_admin_reconciliation_v3(text, text, uuid, text, text, timestamptz, uuid, integer)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_admin_reconciliation_v3(text, text, uuid, text, text, timestamptz, uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_reconciliation_v3(text, text, uuid, text, text, timestamptz, uuid, integer)
  TO authenticated;
COMMENT ON FUNCTION public.get_admin_reconciliation_v3(text, text, uuid, text, text, timestamptz, uuid, integer) IS
  'Admin reconciliation v3. Pending refund transactions are excluded from activity until reconciled.';
