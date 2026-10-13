-- Keep receipt/admin payable refreshes aligned with checkout DVA reservation
-- when an order has an active customer savings redemption.

CREATE OR REPLACE FUNCTION public.refresh_paystack_order_payable_amount(
  p_order_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_merchant_id uuid;
  v_total numeric;
  v_amount_paid numeric;
  v_wallet_amount_used numeric;
  v_transaction_paid numeric;
  v_wallet_transaction_paid numeric;
  v_savings_paid numeric;
  v_payable_amount numeric;
BEGIN
  IF auth.uid() IS NULL OR p_order_id IS NULL THEN
    RAISE EXCEPTION 'invalid refresh request';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0)
  );

  SELECT orders.merchant_id, COALESCE(orders.total, 0),
    COALESCE(orders.amount_paid, 0), COALESCE(orders.wallet_amount_used, 0)
  INTO v_merchant_id, v_total, v_amount_paid, v_wallet_amount_used
  FROM public.orders AS orders
  WHERE orders.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND OR NOT (
    public.check_staff_permission(auth.uid(), v_merchant_id, 'orders', 'view')
    OR public.check_staff_permission(auth.uid(), v_merchant_id, 'orders', 'edit')
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT
    COALESCE(sum(COALESCE(transactions.amount, 0)), 0)::numeric,
    COALESCE(sum(COALESCE(transactions.amount, 0)) FILTER (
      WHERE lower(COALESCE(transactions.gateway, '')) IN ('wallet', 'store_credit')
    ), 0)::numeric
  INTO v_transaction_paid, v_wallet_transaction_paid
  FROM public.transactions AS transactions
  WHERE transactions.order_id = p_order_id
    AND transactions.merchant_id = v_merchant_id
    AND transactions.transaction_type = 'payment'
    AND transactions.status IN ('success', 'completed');

  SELECT COALESCE(sum(COALESCE(redemptions.amount, 0)), 0)::numeric
  INTO v_savings_paid
  FROM public.customer_savings_redemptions AS redemptions
  WHERE redemptions.order_id = p_order_id
    AND redemptions.merchant_id = v_merchant_id
    AND redemptions.metadata ->> 'reversed_at' IS NULL;

  v_payable_amount := greatest(
    v_total - greatest(
      v_amount_paid,
      v_transaction_paid + greatest(
        0,
        v_wallet_amount_used - v_wallet_transaction_paid
      ) + v_savings_paid
    ),
    0
  );

  UPDATE public.order_payment_accounts AS account
  SET payable_amount = v_payable_amount
  WHERE account.order_id = p_order_id
    AND account.provider = 'paystack';

  RETURN v_payable_amount;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_paystack_order_payable_amount(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_paystack_order_payable_amount(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.refresh_paystack_order_payable_amount(uuid) IS
  'Refreshes an order Paystack balance including active savings redemptions.';
