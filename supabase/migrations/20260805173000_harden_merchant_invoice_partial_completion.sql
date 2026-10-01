-- Close the lock gap between merchant-invoice balance matching and full order
-- completion, and include active savings credits in the authoritative ledger.

ALTER FUNCTION public.complete_merchant_invoice_partial_payment(
  uuid, uuid, text, numeric, numeric, jsonb, text
) RENAME TO complete_merchant_invoice_partial_payment_v1;

REVOKE ALL ON FUNCTION public.complete_merchant_invoice_partial_payment_v1(
  uuid, uuid, text, numeric, numeric, jsonb, text
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.complete_merchant_invoice_partial_payment(
  p_transaction_id uuid,
  p_order_id uuid,
  p_settlement_reference text,
  p_verified_gateway_fee numeric,
  p_payment_platform_fee numeric,
  p_gateway_response jsonb DEFAULT NULL,
  p_actor text DEFAULT 'gateway_webhook'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_txn_order_id uuid;
  v_txn_merchant_id uuid;
  v_txn_metadata jsonb;
  v_order_merchant_id uuid;
  v_order_total numeric := 0;
  v_order_amount_paid numeric := 0;
  v_order_wallet_used numeric := 0;
  v_completed_transaction_paid numeric := 0;
  v_completed_wallet_paid numeric := 0;
  v_savings_paid numeric := 0;
  v_authoritative_paid numeric := 0;
  v_result jsonb;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: complete_merchant_invoice_partial_payment requires service_role';
  END IF;

  IF p_transaction_id IS NULL OR p_order_id IS NULL THEN
    RETURN jsonb_build_object(
      'outcome', 'review_required',
      'error_code', 'INVALID_ARGUMENTS'
    );
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0)
  );

  SELECT t.order_id, t.merchant_id, COALESCE(t.metadata, '{}'::jsonb)
  INTO v_txn_order_id, v_txn_merchant_id, v_txn_metadata
  FROM public.transactions AS t
  WHERE t.id = p_transaction_id
  FOR UPDATE;

  SELECT
    o.merchant_id,
    COALESCE(o.total, 0),
    COALESCE(o.amount_paid, 0),
    COALESCE(o.wallet_amount_used, 0)
  INTO
    v_order_merchant_id,
    v_order_total,
    v_order_amount_paid,
    v_order_wallet_used
  FROM public.orders AS o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF v_txn_order_id = p_order_id
    AND v_txn_merchant_id = v_order_merchant_id
    AND v_txn_metadata ->> 'order_payment_allocation'
      = 'merchant_invoice_partial' THEN
    SELECT
      COALESCE(sum(COALESCE(t.amount, 0)), 0)::numeric,
      COALESCE(sum(COALESCE(t.amount, 0)) FILTER (
        WHERE lower(COALESCE(t.gateway, '')) IN ('wallet', 'store_credit')
      ), 0)::numeric
    INTO v_completed_transaction_paid, v_completed_wallet_paid
    FROM public.transactions AS t
    WHERE t.order_id = p_order_id
      AND t.merchant_id = v_order_merchant_id
      AND t.transaction_type = 'payment'
      AND t.status = 'completed'
      AND t.id <> p_transaction_id;

    SELECT COALESCE(sum(COALESCE(r.amount, 0)), 0)::numeric
    INTO v_savings_paid
    FROM public.customer_savings_redemptions AS r
    WHERE r.order_id = p_order_id
      AND r.merchant_id = v_order_merchant_id
      AND r.metadata ->> 'reversed_at' IS NULL;

    v_authoritative_paid := greatest(
      v_order_amount_paid,
      v_completed_transaction_paid
        + greatest(0, v_order_wallet_used - v_completed_wallet_paid)
        + v_savings_paid
    );

    UPDATE public.orders AS o
    SET amount_paid = least(v_order_total, v_authoritative_paid),
        updated_at = now()
    WHERE o.id = p_order_id
      AND o.amount_paid IS DISTINCT FROM least(
        v_order_total,
        v_authoritative_paid
      );
  END IF;

  SELECT public.complete_merchant_invoice_partial_payment_v1(
    p_transaction_id,
    p_order_id,
    p_settlement_reference,
    p_verified_gateway_fee,
    p_payment_platform_fee,
    p_gateway_response,
    p_actor
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_merchant_invoice_partial_payment(
  uuid, uuid, text, numeric, numeric, jsonb, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.complete_merchant_invoice_partial_payment(
  uuid, uuid, text, numeric, numeric, jsonb, text
) TO service_role;

COMMENT ON FUNCTION public.complete_merchant_invoice_partial_payment(
  uuid, uuid, text, numeric, numeric, jsonb, text
) IS
  'Adds active savings credits to the locked merchant-invoice ledger before delegating to the reviewed partial-payment implementation.';
