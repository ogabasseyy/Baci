-- Do not reveal customer-email matches to authenticated users without access
-- to the order. This supersedes the prior wrapper while preserving its lock.

CREATE OR REPLACE FUNCTION public.reserve_paystack_order_payment_account(
  p_order_id uuid,
  p_account_number text,
  p_bank_name text,
  p_account_name text,
  p_assigned_at timestamptz,
  p_expires_at timestamptz,
  p_expected_customer_email text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_customer_email text;
  v_merchant_id uuid;
BEGIN
  IF auth.uid() IS NULL
    OR nullif(trim(p_expected_customer_email), '') IS NULL THEN
    RAISE EXCEPTION 'invalid reservation request';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0)
  );

  SELECT orders.merchant_id, lower(trim(orders.customer_email))
  INTO v_merchant_id, v_customer_email
  FROM public.orders AS orders
  WHERE orders.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND OR NOT public.check_staff_permission(
    auth.uid(), v_merchant_id, 'orders', 'edit'
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF v_customer_email IS DISTINCT FROM lower(trim(p_expected_customer_email)) THEN
    RETURN 'customer_changed';
  END IF;

  RETURN public.reserve_paystack_order_payment_account(
    p_order_id,
    p_account_number,
    p_bank_name,
    p_account_name,
    p_assigned_at,
    p_expires_at
  );
END;
$$;
