-- Queue the cancellation refund side-effect row for refund-state legs.
-- The claim gate admits completed, refund_pending, and self-terminal
-- refunded payment legs so the drain resumes provider-awaiting work and
-- runs aggregate finalization — but cancel_order_as_merchant only queued
-- the row when a completed leg existed. A cancellation whose funded legs
-- were already refund_pending or refunded (e.g. PayPal flips the payment
-- row itself) therefore succeeded without ever creating the row the
-- claim needs, leaving the order paid, its settlement unreversed, and
-- processed-refund notifications unsent. Match the claim's three funded
-- statuses here.
CREATE OR REPLACE FUNCTION public.cancel_order_as_merchant(
  p_order_id uuid,
  p_reason text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_order record;
  v_reason text := NULLIF(btrim(p_reason), '');
  v_wallet_reversed numeric := 0;
  v_savings_reversed numeric := 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF v_reason IS NOT NULL AND char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'reason_too_long' USING ERRCODE = '22001';
  END IF;

  SELECT o.merchant_id, o.shipping_status, o.cancelled_at,
         o.payment_status, o.amount_paid, o.total,
         o.cancellation_reason, o.cancelled_by
    INTO v_order
    FROM public.orders o
   WHERE o.id = p_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (
    EXISTS (
      SELECT 1 FROM public.merchants m
       WHERE m.id = v_order.merchant_id AND m.user_id = v_actor
    )
    OR public.check_staff_permission(
      v_actor, v_order.merchant_id, 'orders', 'edit'
    )
  ) THEN
    RAISE EXCEPTION 'order_cancel_forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_order.shipping_status IN ('cancelled', 'canceled')
     OR v_order.cancelled_at IS NOT NULL THEN
    RETURN false;
  END IF;
  IF v_order.shipping_status IN (
    'shipped', 'out_for_delivery', 'delivered', 'completed', 'returned'
  ) THEN
    RAISE EXCEPTION 'order_not_cancellable' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.transactions t
     WHERE t.order_id = p_order_id
       AND t.merchant_id = v_order.merchant_id
       AND t.transaction_type = 'payment'
       AND t.status IN ('pending', 'processing')
  ) THEN
    RAISE EXCEPTION 'payment_capture_in_flight' USING ERRCODE = 'P0001';
  END IF;
  IF v_order.payment_status = 'paid'
     AND v_order.amount_paid IS DISTINCT FROM v_order.total THEN
    RAISE EXCEPTION 'paid_order_ledger_inconsistent' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.orders
     SET shipping_status = 'cancelled', cancelled_at = now(),
         cancellation_reason = v_reason, cancelled_by = 'merchant',
         updated_at = now()
   WHERE id = p_order_id;

  UPDATE public.order_payment_accounts SET expires_at = now()
   WHERE order_id = p_order_id
     AND (expires_at IS NULL OR expires_at > now());
  UPDATE public.order_wallet_funding_intents
     SET status = 'cancelled', updated_at = now()
   WHERE order_id = p_order_id
     AND status NOT IN ('completed', 'cancelled', 'expired', 'failed');

  SELECT COALESCE(sum(reversed_amount), 0)
    INTO v_wallet_reversed
    FROM public.reverse_wallet_redemption(
      p_order_id, COALESCE(v_reason, 'Order cancelled'), v_order.merchant_id
    );
  v_savings_reversed := public.reverse_savings_redemption_for_order(
    p_order_id, v_order.merchant_id, v_actor,
    COALESCE(v_reason, 'Order cancelled')
  );

  PERFORM private.restock_order_items(p_order_id);
  PERFORM private.release_order_inventory_units(
    v_order.merchant_id, p_order_id, 'available'
  );

  INSERT INTO public.order_audit_events (
    merchant_id, order_id, actor_user_id, action, change_category,
    changed_fields, before_snapshot, after_snapshot, metadata
  ) VALUES (
    v_order.merchant_id, p_order_id, v_actor, 'order.update',
    'customer_visible',
    ARRAY['shipping_status', 'cancelled_at', 'cancellation_reason', 'cancelled_by'],
    jsonb_build_object(
      'shipping_status', v_order.shipping_status,
      'cancelled_at', v_order.cancelled_at,
      'cancellation_reason', v_order.cancellation_reason,
      'cancelled_by', v_order.cancelled_by
    ),
    jsonb_build_object(
      'shipping_status', 'cancelled', 'cancelled_at', now(),
      'cancellation_reason', v_reason, 'cancelled_by', 'merchant'
    ),
    jsonb_build_object(
      'operation', 'merchant_order_cancellation',
      'wallet_reversed', v_wallet_reversed,
      'savings_reversed', v_savings_reversed
    )
  );

  INSERT INTO public.order_cancellation_side_effects (
    order_id, merchant_id, step, status, claim_token, attempts
  ) VALUES (
    p_order_id, v_order.merchant_id, 'customer_email', 'failed',
    extensions.gen_random_uuid(), 0
  ) ON CONFLICT (order_id, step) DO NOTHING;

  IF EXISTS (
    SELECT 1 FROM public.transactions t
     WHERE t.order_id = p_order_id
       AND t.merchant_id = v_order.merchant_id
       AND t.transaction_type = 'payment'
       -- Mirror the claim gate's funded-leg statuses: refund-state legs
       -- (e.g. PayPal flips the payment row itself while its provider
       -- refund is pending or terminal) need the row so the drain
       -- resumes them and runs aggregate finalization.
       AND t.status IN ('completed', 'refund_pending', 'refunded')
       AND t.amount > 0
       AND COALESCE(t.gateway, '') NOT IN (
         'wallet', 'savings', 'store_credit', 'cash', 'manual', 'pay_on_delivery'
       )
  ) THEN
    INSERT INTO public.order_cancellation_side_effects (
      order_id, merchant_id, step, status, claim_token, attempts
    ) VALUES (
      p_order_id, v_order.merchant_id, 'refund', 'failed',
      extensions.gen_random_uuid(), 0
    ) ON CONFLICT (order_id, step) DO NOTHING;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_order_as_merchant(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.cancel_order_as_merchant(uuid, text)
  TO authenticated;
