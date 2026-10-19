CREATE OR REPLACE FUNCTION private.reverse_uba_redvault_merchant_settlement(
  p_attempt_id uuid,
  p_refund_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_attempt private.uba_redvault_payment_attempts%ROWTYPE;
  v_settlement public.merchant_settlements%ROWTYPE;
  v_balance numeric;
BEGIN
  SELECT * INTO STRICT v_attempt FROM private.uba_redvault_payment_attempts WHERE id = p_attempt_id;
  FOR v_settlement IN
    SELECT settlement.* FROM public.merchant_settlements AS settlement
    WHERE settlement.merchant_id = v_attempt.merchant_id
      AND settlement.source_type = 'order'
      AND settlement.source_id = v_attempt.order_id
      AND settlement.gateway = 'paystack'
      AND settlement.gateway_reference = v_attempt.reference
      AND settlement.status IN ('pending', 'processing', 'settled')
    FOR UPDATE
  LOOP
    IF v_settlement.status IN ('pending', 'processing') THEN
      UPDATE public.merchant_wallets
      SET upcoming_balance = upcoming_balance - v_settlement.net_amount,
          upcoming_count = greatest(0, upcoming_count - 1), updated_at = pg_catalog.now()
      WHERE id = v_settlement.wallet_id;
    ELSE
      UPDATE public.merchant_wallets
      SET available_balance = available_balance - v_settlement.net_amount,
          total_earned = total_earned - v_settlement.net_amount,
          updated_at = pg_catalog.now()
      WHERE id = v_settlement.wallet_id
      RETURNING available_balance INTO v_balance;
      IF v_balance IS NULL THEN RAISE EXCEPTION 'redvault_settlement_wallet_missing'; END IF;
      INSERT INTO public.wallet_transactions (
        wallet_id, merchant_id, type, amount, balance_after, source_type, source_id,
        description, status, metadata
      ) VALUES (
        v_settlement.wallet_id, v_settlement.merchant_id, 'debit', v_settlement.net_amount,
        v_balance, 'refund', p_refund_id,
        'UBA REDVAULT capture refund settlement reversal', 'completed',
        jsonb_build_object('settlement_id', v_settlement.id, 'attempt_id', p_attempt_id)
      );
    END IF;
    UPDATE public.merchant_settlements
    SET status = 'cancelled', updated_at = pg_catalog.now()
    WHERE id = v_settlement.id;
  END LOOP;
END;
$$;
ALTER FUNCTION private.reverse_uba_redvault_merchant_settlement(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.reverse_uba_redvault_merchant_settlement(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_storefront_redvault_variant_pricing(p_variant_ids uuid[])
RETURNS TABLE (id uuid, product_id uuid, price_override numeric, condition text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.jwt()->>'storefront_order_context' IS DISTINCT FROM 'route'
    OR NULLIF(auth.jwt()->>'storefront_order_merchant_id', '') IS NULL THEN
    RAISE EXCEPTION 'redvault_route_context_required';
  END IF;
  RETURN QUERY
  SELECT variant.id, variant.product_id, variant.price_override, variant.condition
  FROM public.product_variants AS variant
  JOIN public.products AS product ON product.id = variant.product_id
  WHERE COALESCE(array_length(p_variant_ids, 1), 0) <= 10000
    AND variant.id = ANY(COALESCE(p_variant_ids, ARRAY[]::uuid[]))
    AND product.merchant_id::text = auth.jwt()->>'storefront_order_merchant_id';
END;
$$;
ALTER FUNCTION public.get_storefront_redvault_variant_pricing(uuid[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_storefront_redvault_variant_pricing(uuid[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_storefront_redvault_variant_pricing(uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION private.reject_unscoped_redvault_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.payment_method = 'uba_redvault' AND NEW.payment_method = 'uba_redvault'
    AND NEW.payment_status = 'paid'
    AND NEW.cancelled_at IS NOT DISTINCT FROM OLD.cancelled_at
    AND lower(COALESCE(NEW.shipping_status, '')) IN ('pending', 'processing', 'fulfilled', 'shipped', 'out_for_delivery', 'delivered', 'completed')
    AND (to_jsonb(NEW) - ARRAY[
      'shipping_status', 'tracking_number', 'shipping_provider', 'shipment_id',
      'shipped_at', 'delivered_at', 'fulfillment_details', 'updated_at',
      'shipment_booking_lock_token', 'shipment_booking_started_at'
    ]) IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY[
      'shipping_status', 'tracking_number', 'shipping_provider', 'shipment_id',
      'shipped_at', 'delivered_at', 'fulfillment_details', 'updated_at',
      'shipment_booking_lock_token', 'shipment_booking_started_at'
    ])
    AND private.redvault_approved_completion_durable(NEW.id) THEN
    RETURN NEW;
  END IF;
  IF (NEW.payment_method = 'uba_redvault' OR (TG_OP = 'UPDATE' AND OLD.payment_method = 'uba_redvault'))
    AND NOT EXISTS (SELECT 1 FROM private.uba_redvault_write_context WHERE transaction_id = pg_catalog.txid_current()) THEN
    RAISE EXCEPTION 'redvault_order_requires_protected_path';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.reject_unscoped_redvault_order() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.reject_unscoped_redvault_order() FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.reserve_uba_redvault_refund_v2(
  p_attempt_id uuid, p_merchant_id uuid, p_idempotency_key text,
  p_type text, p_units jsonb DEFAULT NULL
)
RETURNS TABLE (id uuid, amount_kobo bigint, state text, attempt_reference text,
  provider_reference text, provider_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_attempt private.uba_redvault_payment_attempts%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_attempt FROM private.uba_redvault_payment_attempts
  WHERE id = p_attempt_id FOR UPDATE;
  IF v_attempt.merchant_id IS DISTINCT FROM p_merchant_id THEN
    RAISE EXCEPTION 'redvault_refund_attempt_not_found';
  END IF;
  IF EXISTS (
    SELECT 1 FROM private.uba_redvault_refunds
    WHERE attempt_id = p_attempt_id AND idempotency_key = p_idempotency_key
  ) THEN
    RETURN QUERY SELECT * FROM public.reserve_uba_redvault_refund(
      p_attempt_id, p_merchant_id, p_idempotency_key, p_type, p_units
    );
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM private.uba_redvault_refunds
    WHERE attempt_id = p_attempt_id AND state = 'needs_reconciliation'
  ) THEN
    RAISE EXCEPTION 'redvault_refund_amount_reserved';
  END IF;
  RETURN QUERY SELECT * FROM public.reserve_uba_redvault_refund(
    p_attempt_id, p_merchant_id, p_idempotency_key, p_type, p_units
  );
END;
$$;
ALTER FUNCTION public.reserve_uba_redvault_refund(uuid, uuid, text, text, jsonb) OWNER TO postgres;
ALTER FUNCTION public.reserve_uba_redvault_refund_v2(uuid, uuid, text, text, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reserve_uba_redvault_refund_v2(uuid, uuid, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_uba_redvault_refund_v2(uuid, uuid, text, text, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION private.persist_redvault_surviving_shipment_quantity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_order_item_id uuid := COALESCE(NEW.order_item_id, OLD.order_item_id);
BEGIN
  IF v_order_item_id IS NULL OR NEW.status IS NOT DISTINCT FROM OLD.status
    AND NEW.order_item_id IS NOT DISTINCT FROM OLD.order_item_id THEN
    RETURN NEW;
  END IF;
  UPDATE public.order_items AS item
  SET fulfillment_data = COALESCE(item.fulfillment_data, '{}'::jsonb) || jsonb_build_object(
    'fulfillmentQuantity', (
      SELECT count(*) FROM public.variant_inventory AS inventory
      WHERE inventory.order_item_id = item.id AND inventory.status = 'reserved'
    )
  )
  FROM public.orders AS order_row
  WHERE item.id = v_order_item_id
    AND order_row.id = item.order_id
    AND order_row.payment_method = 'uba_redvault';
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.persist_redvault_surviving_shipment_quantity() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.persist_redvault_surviving_shipment_quantity() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER persist_redvault_surviving_shipment_quantity
  AFTER UPDATE OF status, order_item_id ON public.variant_inventory
  FOR EACH ROW EXECUTE FUNCTION private.persist_redvault_surviving_shipment_quantity();
