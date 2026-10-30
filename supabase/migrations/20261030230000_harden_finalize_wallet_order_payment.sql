-- Closes a hole in finalize_wallet_order_payment: it trusted the caller's amount
-- and never checked that the wallet was debited, so an order owner could mark an
-- unpaid order paid. It now verifies the order state and the net order_redemption
-- debit (and p_amount) before recording payment at that debit; EXECUTE is limited
-- to authenticated and service_role (the orders route uses the customer session).

CREATE OR REPLACE FUNCTION public.finalize_wallet_order_payment(
  p_order_id uuid,
  p_amount numeric
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_order record;
  v_debited numeric;
  v_reversed numeric;
  v_redeemed numeric;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id_required';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount_invalid';
  END IF;

  SELECT
    o.id,
    o.customer_id,
    o.merchant_id,
    o.order_number,
    o.customer_email,
    o.customer_name,
    o.payment_status,
    o.shipping_status,
    o.cancelled_at,
    o.currency,
    o.total
  INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.customers c
    WHERE c.id = v_order.customer_id
      AND c.merchant_id = v_order.merchant_id
      AND c.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- Same lock key as redeem_wallet_for_order / reverse_wallet_redemption, so
  -- the ledger read below cannot interleave with a debit or reversal.
  PERFORM pg_advisory_xact_lock(
    ('x' || substr(md5(p_order_id::text), 1, 16))::bit(64)::bigint
  );

  IF EXISTS (
    SELECT 1
    FROM public.transactions t
    WHERE t.order_id = p_order_id
      AND t.gateway = 'wallet'
      AND t.status = 'completed'
  ) THEN
    RETURN true;
  END IF;

  -- Payable means exactly 'unpaid'. Other values in use (paid, partially_paid,
  -- pending, bnpl_*, refunded, failed, cancelled) are either settled, owned by
  -- another payment flow, or terminal. Merchant/customer cancellation sets
  -- shipping_status/cancelled_at and leaves payment_status untouched.
  -- Wallets are an NGN-only ledger, as the orders route also enforces.
  IF v_order.payment_status IS DISTINCT FROM 'unpaid'
    OR COALESCE(v_order.shipping_status, '') IN ('cancelled', 'canceled')
    OR v_order.cancelled_at IS NOT NULL
    OR COALESCE(v_order.currency, 'NGN') <> 'NGN'
  THEN
    RAISE EXCEPTION 'order_not_payable';
  END IF;

  -- Reversals count whatever their status, so an unclear row can only make
  -- this check stricter.
  SELECT
    COALESCE(SUM(t.amount) FILTER (
      WHERE t.source_type = 'order_redemption'
        AND t.type = 'redemption'
        AND t.status = 'completed'
    ), 0),
    COALESCE(SUM(t.amount) FILTER (
      WHERE t.source_type = 'order_reversal'
    ), 0)
  INTO v_debited, v_reversed
  FROM public.customer_wallet_transactions t
  WHERE t.source_id = p_order_id
    AND t.customer_id = v_order.customer_id
    AND t.merchant_id = v_order.merchant_id
    AND t.source_type IN ('order_redemption', 'order_reversal');

  v_redeemed := v_debited - v_reversed;

  IF v_redeemed < v_order.total THEN
    RAISE EXCEPTION 'wallet_debit_insufficient';
  END IF;

  IF p_amount IS DISTINCT FROM v_redeemed OR v_redeemed > v_order.total THEN
    RAISE EXCEPTION 'wallet_amount_mismatch';
  END IF;

  UPDATE public.orders
  SET payment_status = 'paid',
      payment_method = 'wallet'
  WHERE id = p_order_id;

  INSERT INTO public.transactions (
    merchant_id,
    order_id,
    transaction_type,
    amount,
    currency,
    status,
    gateway,
    gateway_reference,
    platform_fee,
    merchant_amount,
    description,
    metadata
  )
  VALUES (
    v_order.merchant_id,
    p_order_id,
    'payment',
    v_redeemed,
    'NGN',
    'completed',
    'wallet',
    'WALLET-' || upper(substr(p_order_id::text, 1, 8)),
    0,
    v_redeemed,
    'Wallet payment for order ' || COALESCE(v_order.order_number, p_order_id::text),
    jsonb_build_object(
      'customer_email', v_order.customer_email,
      'customer_name', v_order.customer_name,
      'wallet_credit_used', v_redeemed
    )
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_wallet_order_payment(uuid, numeric)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_wallet_order_payment(uuid, numeric)
  TO authenticated, service_role;
