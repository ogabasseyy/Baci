-- Closes a hole in finalize_store_credit_order_payment: it trusted the
-- caller's amount and never checked that savings (or wallet) credit was
-- redeemed for the order, so an order owner could mark an unpaid order paid
-- with a token amount. It now verifies the order state and the redeemed
-- credit (net savings redemption plus net wallet order_redemption, for this
-- customer and merchant) against the order total and p_amount, and records
-- payment at the verified amount. EXECUTE is limited to authenticated and
-- service_role (the orders route calls it on the customer session).
--
-- Rollback (restores the unverified, exploitable behaviour; do not use
-- outside an incident): re-apply the function from
-- 20260521205531_customer_savings_order_redemptions.sql.

CREATE OR REPLACE FUNCTION public.finalize_store_credit_order_payment(
  p_order_id uuid,
  p_amount numeric,
  p_payment_method text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_order record;
  v_savings numeric;
  v_wallet_debited numeric;
  v_wallet_reversed numeric;
  v_wallet numeric;
  v_redeemed numeric;
  v_expected_method text;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id_required' USING ERRCODE = '22023';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount_invalid' USING ERRCODE = '22023';
  END IF;

  IF p_payment_method IS NULL
    OR p_payment_method NOT IN ('savings', 'store_credit')
  THEN
    RAISE EXCEPTION 'invalid_store_credit_payment_method'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    o.id,
    o.customer_id,
    o.merchant_id,
    o.order_number,
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
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- service_role (trusted server code) skips the ownership check only; it is
  -- held to the same ledger verification below as any customer.
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.customers c
      WHERE c.id = v_order.customer_id
        AND c.merchant_id = v_order.merchant_id
        AND c.user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Same lock keys as redeem_wallet_for_order / reverse_wallet_redemption and
  -- reverse_savings_redemption_for_order, taken in the order
  -- cancel_order_as_merchant takes them (order row, wallet, savings
  -- reversal), so the ledger reads below cannot interleave with a wallet
  -- debit or a reversal.
  --
  -- The savings redemption key ('customer_savings_redemption:') is
  -- deliberately NOT taken: redeem_savings_for_order holds it and then needs
  -- this order row (its redemption trigger selects the order FOR UPDATE), so
  -- holding the row here and waiting on that key would deadlock (observed).
  -- The row lock already serializes redemption inserts against this read.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    ('x' || pg_catalog.substr(pg_catalog.md5(p_order_id::text), 1, 16))::bit(64)::bigint
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('savings_reversal:' || p_order_id::text, 0)
  );

  IF EXISTS (
    SELECT 1
    FROM public.transactions t
    WHERE t.order_id = p_order_id
      AND t.merchant_id = v_order.merchant_id
      AND t.transaction_type = 'payment'
      AND t.gateway = p_payment_method
      AND t.status = 'completed'
  ) THEN
    RETURN true;
  END IF;

  -- Payable means exactly 'unpaid'. The savings checkout creates its order
  -- through create_storefront_order, which accepts only 'unpaid' or
  -- 'pending'; the web storefront always sends 'unpaid' and the mobile
  -- storefront sends 'pending' only for invoice / pay-for-me / pay-on-delivery,
  -- none of which can carry savings (savings are offered on the full-payment
  -- tab only). The orders route forces 'pending' only for pay-on-delivery,
  -- and create_payment_transaction moves an order to 'pending' once a
  -- gateway payment is in flight, which is another payment flow's order.
  -- Other values in use (paid, partially_paid, bnpl_*, refunded, failed,
  -- cancelled) are settled, owned by another flow, or terminal.
  -- Merchant/customer cancellation sets shipping_status/cancelled_at and
  -- leaves payment_status untouched. Savings and wallets are NGN-only
  -- ledgers, as the orders route also enforces; a blank currency prices in
  -- NGN like the refund helpers.
  IF v_order.payment_status IS DISTINCT FROM 'unpaid'
    OR COALESCE(v_order.shipping_status, '') IN ('cancelled', 'canceled')
    OR v_order.cancelled_at IS NOT NULL
    OR pg_catalog.upper(pg_catalog.btrim(
         COALESCE(NULLIF(pg_catalog.btrim(v_order.currency), ''), 'NGN')
       )) <> 'NGN'
  THEN
    RAISE EXCEPTION 'order_not_payable' USING ERRCODE = 'P0001';
  END IF;

  -- Savings: one redemption row per order (unique on order_id); a reversal
  -- stamps metadata.reversed_at and the credit is no longer spent.
  SELECT COALESCE(SUM(r.amount), 0)
  INTO v_savings
  FROM public.customer_savings_redemptions r
  WHERE r.order_id = p_order_id
    AND r.customer_id = v_order.customer_id
    AND r.merchant_id = v_order.merchant_id
    AND NOT (COALESCE(r.metadata, '{}'::jsonb) ? 'reversed_at');

  -- Wallet: reversals count whatever their status, so an unclear row can
  -- only make this check stricter.
  SELECT
    COALESCE(SUM(t.amount) FILTER (
      WHERE t.source_type = 'order_redemption'
        AND t.type = 'redemption'
        AND t.status = 'completed'
    ), 0),
    COALESCE(SUM(t.amount) FILTER (
      WHERE t.source_type = 'order_reversal'
    ), 0)
  INTO v_wallet_debited, v_wallet_reversed
  FROM public.customer_wallet_transactions t
  WHERE t.source_id = p_order_id
    AND t.customer_id = v_order.customer_id
    AND t.merchant_id = v_order.merchant_id
    AND t.source_type IN ('order_redemption', 'order_reversal');

  v_wallet := v_wallet_debited - v_wallet_reversed;
  v_redeemed := v_savings + v_wallet;

  -- Store credit means savings were applied; a wallet-only payment goes
  -- through finalize_wallet_order_payment.
  IF v_savings <= 0 OR v_wallet < 0 OR v_redeemed < v_order.total THEN
    RAISE EXCEPTION 'store_credit_insufficient' USING ERRCODE = 'P0001';
  END IF;

  -- p_amount is the route's JS float sum of two 2-decimal amounts, so it is
  -- compared at kobo precision (the ledgers are numeric(_,2)). What is
  -- recorded below is the verified ledger amount, never p_amount.
  IF v_redeemed > v_order.total
    OR pg_catalog.round(p_amount, 2) IS DISTINCT FROM v_redeemed
  THEN
    RAISE EXCEPTION 'store_credit_amount_mismatch' USING ERRCODE = 'P0001';
  END IF;

  v_expected_method := CASE WHEN v_wallet > 0 THEN 'store_credit' ELSE 'savings' END;
  IF p_payment_method IS DISTINCT FROM v_expected_method THEN
    RAISE EXCEPTION 'store_credit_method_mismatch' USING ERRCODE = 'P0001';
  END IF;

  -- amount_paid must equal the total for merchant cancellation to accept a
  -- paid order; wallet_amount_used matches what partial redemptions record.
  UPDATE public.orders
  SET payment_status = 'paid',
      payment_method = p_payment_method,
      amount_paid = v_redeemed,
      wallet_amount_used = CASE
        WHEN v_wallet > 0 THEN v_wallet
        ELSE wallet_amount_used
      END,
      updated_at = now()
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
    p_payment_method,
    pg_catalog.upper(p_payment_method) || '-'
      || pg_catalog.upper(pg_catalog.substr(p_order_id::text, 1, 8)),
    0,
    v_redeemed,
    'Store credit payment for order '
      || COALESCE(v_order.order_number, p_order_id::text),
    jsonb_build_object(
      'store_credit_used', v_redeemed,
      'savings_credit_used', v_savings,
      'wallet_credit_used', v_wallet
    )
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_store_credit_order_payment(uuid, numeric, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_store_credit_order_payment(uuid, numeric, text)
  TO authenticated, service_role;
