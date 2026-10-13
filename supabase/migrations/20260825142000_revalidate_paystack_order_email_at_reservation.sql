-- Keep the Paystack customer identity read before provisioning consistent with
-- the order row locked immediately before the account alias is reserved.

REVOKE EXECUTE ON FUNCTION public.reserve_paystack_order_payment_account(
  uuid, text, text, text, timestamptz, timestamptz
) FROM authenticated;

CREATE FUNCTION public.reserve_paystack_order_payment_account(
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
BEGIN
  IF auth.uid() IS NULL
    OR nullif(trim(p_expected_customer_email), '') IS NULL THEN
    RAISE EXCEPTION 'invalid reservation request';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0)
  );

  SELECT lower(trim(orders.customer_email))
  INTO v_customer_email
  FROM public.orders AS orders
  WHERE orders.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_customer_email IS DISTINCT FROM lower(trim(p_expected_customer_email)) THEN
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

REVOKE ALL ON FUNCTION public.reserve_paystack_order_payment_account(
  uuid, text, text, text, timestamptz, timestamptz, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_paystack_order_payment_account(
  uuid, text, text, text, timestamptz, timestamptz, text
) TO authenticated;
