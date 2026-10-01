CREATE OR REPLACE FUNCTION pg_temp.reset_redvault_refund_932() RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_order_id uuid := (SELECT id FROM public.test_result);
BEGIN
  DELETE FROM private.uba_redvault_refund_lifecycle WHERE order_id = v_order_id;
  DELETE FROM private.uba_redvault_refund_line_allocations WHERE refund_id IN (
    SELECT refund.id FROM private.uba_redvault_refunds AS refund
    JOIN private.uba_redvault_payment_attempts AS attempt ON attempt.id = refund.attempt_id
    WHERE attempt.order_id = v_order_id
  );
  DELETE FROM private.uba_redvault_refunds WHERE attempt_id IN (
    SELECT id FROM private.uba_redvault_payment_attempts WHERE order_id = v_order_id
  );
  DELETE FROM public.variant_inventory WHERE order_id = v_order_id;
  DELETE FROM public.shipments WHERE order_id = v_order_id;
  INSERT INTO private.uba_redvault_write_context VALUES (txid_current()) ON CONFLICT DO NOTHING;
  UPDATE public.orders SET payment_status = 'paid', amount_paid = total, shipping_status = 'processing',
    shipment_id = NULL, tracking_number = NULL, shipped_at = NULL, delivered_at = NULL WHERE id = v_order_id;
  UPDATE public.transactions SET status = 'completed' WHERE order_id = v_order_id AND transaction_type = 'payment';
  DELETE FROM private.uba_redvault_write_context WHERE transaction_id = txid_current();
  UPDATE public.products SET inventory_tracking_policy = 'serialized_strict'
    WHERE id IN (SELECT product_id FROM public.order_items WHERE order_id = v_order_id);
END;
$$;

BEGIN;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SELECT pg_temp.reset_redvault_refund_932();
INSERT INTO public.product_variants(id, product_id, merchant_id, inventory_tracking_policy)
  SELECT '93200000-0000-4000-8000-000000000001', product_id,
    '6b5cb8a4-5575-456c-b936-8cdfae30db74', 'inherit'
  FROM public.order_items WHERE order_id = (SELECT id FROM public.test_result) LIMIT 1;
INSERT INTO public.variant_inventory(id, merchant_id, variant_id, order_id, order_item_id, status, reserved_at)
  SELECT '93200000-0000-4000-8000-000000000002', '6b5cb8a4-5575-456c-b936-8cdfae30db74',
    '93200000-0000-4000-8000-000000000001', order_id, id, 'reserved', now()
  FROM public.order_items WHERE order_id = (SELECT id FROM public.test_result) LIMIT 1;
DO $$
DECLARE v_attempt private.uba_redvault_payment_attempts%ROWTYPE; v_partial record; v_remainder record; v_units jsonb;
BEGIN
  SELECT * INTO STRICT v_attempt FROM private.uba_redvault_payment_attempts WHERE id = (SELECT attempt_id FROM public.test_attempt);
  SELECT jsonb_agg(jsonb_build_object('orderItemId', order_item_id, 'unitOrdinal', unit_ordinal)) INTO v_units
    FROM private.uba_redvault_line_allocations WHERE application_id = v_attempt.application_id;
  SELECT * INTO v_partial FROM public.reserve_uba_redvault_refund(v_attempt.id, v_attempt.merchant_id,
    '932-partial', 'merchandise_units', v_units);
  PERFORM public.claim_next_uba_redvault_refund();
  PERFORM public.finish_uba_redvault_refund(v_partial.id, 'processed', '932-partial-provider', 'processed');
  IF NOT EXISTS (SELECT 1 FROM public.variant_inventory WHERE id = '93200000-0000-4000-8000-000000000002'
    AND status = 'available' AND order_id IS NULL AND order_item_id IS NULL)
    OR NOT EXISTS (SELECT 1 FROM private.uba_redvault_refund_lifecycle WHERE refund_id = v_partial.id
      AND inventory_state = 'released' AND (inventory_receipt->>'releasedCount')::integer = 1)
    OR NOT private.redvault_approved_completion_durable(v_attempt.order_id) THEN
    RAISE EXCEPTION 'processed partial refund did not release only reconciled inventory for remaining fulfillment';
  END IF;
  SELECT * INTO v_remainder FROM public.reserve_uba_redvault_refund(v_attempt.id, v_attempt.merchant_id,
    '932-full-remainder', 'full_capture', NULL);
  IF v_remainder.amount_kobo <> v_attempt.amount_kobo - v_partial.amount_kobo THEN
    RAISE EXCEPTION 'full refund after partial did not reserve only the remaining capture amount';
  END IF;
  PERFORM public.claim_next_uba_redvault_refund();
  PERFORM public.finish_uba_redvault_refund(v_remainder.id, 'processed', '932-remainder-provider', 'processed');
  IF (SELECT payment_status FROM public.orders WHERE id = v_attempt.order_id) <> 'refunded'
    OR (SELECT status FROM public.transactions WHERE order_id = v_attempt.order_id AND transaction_type = 'payment') <> 'refunded'
    OR private.redvault_approved_completion_durable(v_attempt.order_id) THEN
    RAISE EXCEPTION 'remaining full refund did not terminalize the order';
  END IF;
END;
$$;
ROLLBACK;

BEGIN;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SELECT pg_temp.reset_redvault_refund_932();
DO $$
DECLARE v_attempt private.uba_redvault_payment_attempts%ROWTYPE; v_refund record; v_units jsonb;
BEGIN
  SELECT * INTO STRICT v_attempt FROM private.uba_redvault_payment_attempts WHERE id = (SELECT attempt_id FROM public.test_attempt);
  SELECT jsonb_agg(jsonb_build_object('orderItemId', order_item_id, 'unitOrdinal', unit_ordinal)) INTO v_units
    FROM private.uba_redvault_line_allocations WHERE application_id = v_attempt.application_id;
  SELECT * INTO v_refund FROM public.reserve_uba_redvault_refund(v_attempt.id, v_attempt.merchant_id,
    '932-missing-inventory', 'merchandise_units', v_units);
  PERFORM public.claim_next_uba_redvault_refund();
  PERFORM public.finish_uba_redvault_refund(v_refund.id, 'processed', '932-missing-provider', 'processed');
  IF NOT EXISTS (SELECT 1 FROM private.uba_redvault_refund_lifecycle WHERE refund_id = v_refund.id
    AND inventory_state = 'review_required' AND review_reason = 'partial_units_require_fulfillment_reconciliation')
    OR private.redvault_approved_completion_durable(v_attempt.order_id) THEN
    RAISE EXCEPTION 'partial refund without exact reserved inventory must remain fail-closed';
  END IF;
END;
$$;
ROLLBACK;
SELECT 'REDVAULT partial refund quantity-safe release and remaining full refund regression passed' AS result;
