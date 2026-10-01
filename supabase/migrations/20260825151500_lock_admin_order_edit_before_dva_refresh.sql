-- Match the lock order used by payment refresh and webhook RPCs: take the
-- per-order payment advisory lock before the admin editor locks the order row.

CREATE OR REPLACE FUNCTION public.update_admin_order(
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
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0)
  );

  v_result := public.update_admin_order_without_dva_balance_refresh(
    p_order_id,
    p_payload
  );

  PERFORM public.refresh_paystack_order_payable_amount(p_order_id);

  RETURN v_result;
END;
$$;
