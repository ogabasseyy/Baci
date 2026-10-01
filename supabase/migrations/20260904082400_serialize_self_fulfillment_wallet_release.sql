-- Atomically release never-submitted wallet reservations and mark self-fulfillment.

CREATE OR REPLACE FUNCTION public.self_fulfill_order_with_wallet_release(
  p_order_id uuid,
  p_self_fulfillment_data jsonb,
  p_carrier_name text DEFAULT 'Self-Delivery',
  p_tracking_number text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_charge public.merchant_shipping_charges%ROWTYPE;
  v_balance numeric;
  v_transaction uuid;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('merchant-shipping-order:' || p_order_id::text, 0)
  );

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND OR NOT EXISTS (
    SELECT 1
    FROM public.orders AS o
    JOIN public.merchants AS merchant ON merchant.id = o.merchant_id
    WHERE o.id = p_order_id
      AND (
        merchant.user_id = (SELECT auth.uid())
        OR public.check_staff_permission(
          (SELECT auth.uid()), o.merchant_id, 'orders', 'fulfill'
        )
        OR public.check_staff_permission(
          (SELECT auth.uid()), o.merchant_id, 'orders', 'edit'
        )
      )
  ) THEN
    RAISE EXCEPTION 'order_not_owned' USING ERRCODE = '42501';
  END IF;

  IF v_order.shipping_status IN ('shipped', 'delivered') THEN
    RAISE EXCEPTION 'order_already_shipped' USING ERRCODE = 'P0001';
  END IF;

  IF v_order.shipment_booking_lock_token IS NOT NULL
     AND v_order.shipment_booking_started_at IS NOT NULL
     AND v_order.shipment_booking_started_at > now() - interval '15 minutes' THEN
    RAISE EXCEPTION 'active_shipment_booking_lock' USING ERRCODE = '55P03';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.merchant_shipping_charges AS charge
    WHERE charge.order_id = p_order_id
      AND charge.status IN ('booked', 'needs_reconciliation', 'provider_submitting')
  ) THEN
    RAISE EXCEPTION 'active_merchant_shipping_charge' USING ERRCODE = '55P03';
  END IF;

  FOR v_charge IN
    SELECT charge.*
    FROM public.merchant_shipping_charges AS charge
    WHERE charge.order_id = p_order_id
      AND charge.status = 'reserved'
      AND charge.shipment_id IS NULL
    FOR UPDATE
  LOOP
    UPDATE public.merchant_wallets
    SET available_balance = available_balance + v_charge.charged_amount,
        updated_at = now()
    WHERE merchant_id = v_charge.merchant_id
    RETURNING available_balance INTO v_balance;

    INSERT INTO public.wallet_transactions(
      wallet_id, merchant_id, type, amount, balance_after, source_type,
      source_id, description, status
    )
    SELECT id, v_charge.merchant_id, 'refund', v_charge.charged_amount,
      v_balance, 'gigl_shipping', v_charge.order_id,
      'GIGL shipping reservation refund before self-fulfillment', 'completed'
    FROM public.merchant_wallets
    WHERE merchant_id = v_charge.merchant_id
    RETURNING id INTO v_transaction;

    UPDATE public.merchant_shipping_charges
    SET status = 'refunded',
        refund_transaction_id = v_transaction,
        failure_code = 'SELF_FULFILL_BEFORE_SUBMISSION',
        refunded_at = now(),
        updated_at = now()
    WHERE id = v_charge.id;
  END LOOP;

  UPDATE public.orders
  SET shipping_status = 'shipped',
      fulfillment_type = 'self',
      self_fulfillment_data = p_self_fulfillment_data,
      tracking_number = p_tracking_number,
      shipping_provider = COALESCE(NULLIF(btrim(p_carrier_name), ''), 'Self-Delivery'),
      selected_quote_id = NULL,
      shipping_funding_source = NULL,
      shipping_provider_cost = NULL,
      shipping_platform_margin = NULL,
      shipping_pricing_version = NULL,
      shipping_platform_retained_amount = 0,
      shipment_booking_lock_token = NULL,
      shipment_booking_started_at = NULL,
      updated_at = now()
  WHERE id = p_order_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.self_fulfill_order_with_wallet_release(
  uuid, jsonb, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.self_fulfill_order_with_wallet_release(
  uuid, jsonb, text, text
) TO authenticated;
