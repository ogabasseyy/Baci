-- Adds a `loyalty_redemption` source type to credit_customer_wallet so
-- store_credit loyalty redemptions credit the spendable wallet ledger
-- (issue #3165). Before this, redeem_loyalty_reward credited
-- customers.store_credit, a display-only field no checkout path spends;
-- routing through the wallet writer makes the credit redeemable via
-- redeem_wallet_for_order and keeps one canonical ledger entry point.
--
-- 'credit' is the established wallet_topup transaction type, and a
-- loyalty grant is merchant-granted earnings (like topup/cashback), so
-- it maps there and counts toward total_earned. Idempotency is
-- unchanged: the advisory lock + dedupe SELECT key on (customer_id,
-- merchant_id, source_type, source_id, type) with source_id = the
-- reward_redemptions id, which collides with nothing. Full body is
-- re-declared unchanged except the one added CASE arm (same shape as
-- the order_refund extension in 20260723000007).

CREATE OR REPLACE FUNCTION public.credit_customer_wallet(
  p_customer_id uuid,
  p_merchant_id uuid,
  p_amount numeric,
  p_source_type text,
  p_source_id uuid,
  p_description text DEFAULT NULL::text
) RETURNS TABLE(success boolean, new_balance numeric, transaction_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_wallet_id uuid;
  v_new_balance numeric;
  v_transaction_id uuid;
  v_transaction_type text;
  v_earned_delta numeric;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'credit_customer_wallet amount must be greater than zero'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.customers c
    WHERE c.id = p_customer_id AND c.merchant_id = p_merchant_id
  ) THEN
    RAISE EXCEPTION 'Customer does not belong to merchant'
      USING ERRCODE = '42501';
  END IF;

  v_transaction_type := CASE
    WHEN p_source_type = 'vtu_transaction' THEN 'cashback'
    WHEN p_source_type = 'wallet_topup' THEN 'credit'
    WHEN p_source_type = 'order_refund' THEN 'refund'
    WHEN p_source_type = 'loyalty_redemption' THEN 'credit'
  END;

  IF v_transaction_type IS NULL THEN
    RAISE EXCEPTION 'Unsupported customer wallet credit source type: %', p_source_type
      USING ERRCODE = '22023';
  END IF;

  -- These source types are retried by async payment/fulfillment flows and use
  -- source_id as the idempotency key. Reject null before any balance mutation
  -- so a malformed call cannot create duplicate wallet credits.
  IF p_source_id IS NULL THEN
    RAISE EXCEPTION 'credit_customer_wallet source_id is required for source type: %', p_source_type
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'customer_wallet:' || p_source_type || ':' || p_source_id::text,
      0
    )
  );

  SELECT
    cwt.wallet_id,
    cwt.balance_after,
    cwt.id
  INTO v_wallet_id, v_new_balance, v_transaction_id
  FROM public.customer_wallet_transactions cwt
  WHERE
    cwt.customer_id = p_customer_id
    AND cwt.merchant_id = p_merchant_id
    AND cwt.source_type IS NOT DISTINCT FROM p_source_type
    AND cwt.source_id = p_source_id
    AND cwt.type = v_transaction_type
  ORDER BY cwt.created_at DESC
  LIMIT 1;

  IF v_transaction_id IS NOT NULL THEN
    RETURN QUERY SELECT true, v_new_balance, v_transaction_id;
    RETURN;
  END IF;

  -- `total_earned` tracks lifetime EARNINGS (cashback/credit). A refund returns
  -- the customer's own money, so it must credit available_balance WITHOUT
  -- inflating lifetime earnings — the wallet-balance backfill treats 'refund'
  -- the same way, and counting it here would drift analytics until a rebuild.
  v_earned_delta := CASE WHEN v_transaction_type = 'refund' THEN 0 ELSE p_amount END;

  INSERT INTO public.customer_wallets (
    customer_id,
    merchant_id,
    available_balance,
    total_earned
  )
  VALUES (p_customer_id, p_merchant_id, p_amount, v_earned_delta)
  ON CONFLICT (customer_id) DO UPDATE SET
    available_balance =
      public.customer_wallets.available_balance + EXCLUDED.available_balance,
    total_earned = public.customer_wallets.total_earned + EXCLUDED.total_earned,
    updated_at = now()
  RETURNING id, available_balance INTO v_wallet_id, v_new_balance;

  INSERT INTO public.customer_wallet_transactions (
    wallet_id,
    customer_id,
    merchant_id,
    type,
    amount,
    balance_after,
    source_type,
    source_id,
    description
  )
  VALUES (
    v_wallet_id,
    p_customer_id,
    p_merchant_id,
    v_transaction_type,
    p_amount,
    v_new_balance,
    p_source_type,
    p_source_id,
    COALESCE(p_description, 'Wallet credit')
  )
  RETURNING id INTO v_transaction_id;

  RETURN QUERY SELECT true, v_new_balance, v_transaction_id;
END;
$$;
