-- Keep a provisioned Paystack alias aligned with financial edits completed by
-- the mobile-admin order editor before the edit transaction is committed.

ALTER FUNCTION public.update_admin_order(uuid, jsonb)
  RENAME TO update_admin_order_without_dva_balance_refresh;

REVOKE ALL ON FUNCTION public.update_admin_order_without_dva_balance_refresh(
  uuid, jsonb
) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.update_admin_order(
  p_order_id uuid,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.update_admin_order_without_dva_balance_refresh(
    p_order_id,
    p_payload
  );

  PERFORM public.refresh_paystack_order_payable_amount(p_order_id);

  RETURN v_result;
END;
$$;

ALTER FUNCTION public.update_admin_order(uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_admin_order(uuid, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_admin_order(uuid, jsonb)
  TO authenticated;
