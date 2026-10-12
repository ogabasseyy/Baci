-- Reject late settlement recording for cancelled/refunded orders.
-- record_verified_paystack_cancellation_refund_v1 reverses the order's
-- settlements in a one-time scan, so a paid-order side-effect worker that
-- claimed merchant_settlement before cancellation would otherwise insert a
-- fresh pending row after the refund completes: the idempotency conflict
-- target excludes cancelled rows, and nothing rechecks order state before
-- crediting upcoming_balance. Lock the order row to serialize with that
-- reversal: whichever transaction commits first wins, and the loser
-- observes its outcome. record_merchant_settlement_gigl_v1 delegates to
-- this primitive, so GIGL orders inherit the guard.
CREATE OR REPLACE FUNCTION public.record_merchant_settlement(
  p_merchant_id       uuid,
  p_source_type       text,
  p_source_id         uuid,
  p_gateway           text,
  p_gateway_reference text,
  p_gross_amount      numeric,
  p_gateway_fee       numeric,
  p_platform_fee      numeric,
  p_description       text,
  p_metadata          jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wallet_id      UUID;
  v_net_amount     DECIMAL(12,2);
  v_expected_date  DATE;
  v_settlement_id  UUID;
  v_order_shipping_status text;
  v_order_payment_status text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: record_merchant_settlement requires service_role';
  END IF;

  IF p_source_type = 'order' AND p_source_id IS NOT NULL THEN
    SELECT o.shipping_status, o.payment_status
      INTO v_order_shipping_status, v_order_payment_status
      FROM public.orders AS o
     WHERE o.id = p_source_id
     FOR UPDATE;
    IF FOUND AND (
      v_order_shipping_status IN ('cancelled', 'canceled')
      OR v_order_payment_status = 'refunded'
    ) THEN
      RAISE EXCEPTION 'settlement_order_cancelled';
    END IF;
  END IF;

  v_wallet_id := get_or_create_merchant_wallet(p_merchant_id);
  v_net_amount := p_gross_amount - p_gateway_fee - p_platform_fee;
  v_expected_date := calculate_settlement_date(p_gateway);

  INSERT INTO merchant_settlements (
    merchant_id, wallet_id, source_type, source_id, gateway,
    gateway_reference, gross_amount, gateway_fee, platform_fee, net_amount,
    payment_date, expected_settlement_date, description, status, metadata
  ) VALUES (
    p_merchant_id, v_wallet_id, p_source_type, p_source_id, p_gateway,
    p_gateway_reference, p_gross_amount, p_gateway_fee, p_platform_fee,
    v_net_amount, NOW(), v_expected_date,
    COALESCE(p_description, 'Payment received'),
    CASE WHEN p_gateway = 'korapay' THEN 'settled' ELSE 'pending' END,
    p_metadata
  )
  ON CONFLICT (source_type, source_id, gateway_reference)
    WHERE gateway_reference IS NOT NULL AND status != 'cancelled'
    DO NOTHING
  RETURNING id INTO v_settlement_id;

  IF v_settlement_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_gateway != 'korapay' THEN
    UPDATE merchant_wallets
       SET upcoming_balance = upcoming_balance + v_net_amount,
           upcoming_count   = upcoming_count + 1,
           updated_at       = NOW()
     WHERE id = v_wallet_id;
  ELSE
    UPDATE merchant_wallets
       SET available_balance = available_balance + v_net_amount,
           total_earned      = total_earned + v_net_amount,
           updated_at        = NOW()
     WHERE id = v_wallet_id;

    INSERT INTO wallet_transactions (
      wallet_id, merchant_id, type, amount, balance_after,
      source_type, source_id, description, status
    )
    SELECT
      v_wallet_id, p_merchant_id, 'credit', v_net_amount, mw.available_balance,
      p_source_type, p_source_id,
      COALESCE(p_description, 'Payment settled'), 'completed'
    FROM merchant_wallets mw WHERE mw.id = v_wallet_id;
  END IF;

  RETURN v_settlement_id;
END $$;
