CREATE OR REPLACE FUNCTION pg_temp.prepare_redvault_refund_925() RETURNS void LANGUAGE plpgsql AS $$
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
  INSERT INTO private.uba_redvault_write_context VALUES (txid_current()) ON CONFLICT DO NOTHING;
  UPDATE public.orders SET payment_status = 'paid', amount_paid = total WHERE id = v_order_id;
  UPDATE public.transactions SET status = 'completed' WHERE order_id = v_order_id AND transaction_type = 'payment';
  DELETE FROM private.uba_redvault_write_context WHERE transaction_id = txid_current();
END;
$$;

BEGIN;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SELECT pg_temp.prepare_redvault_refund_925();
DELETE FROM public.shipments WHERE order_id = (SELECT id FROM public.test_result);
DELETE FROM public.variant_inventory WHERE order_id = (SELECT id FROM public.test_result);
INSERT INTO private.uba_redvault_write_context VALUES (txid_current());
UPDATE public.orders SET shipment_id = NULL, tracking_number = NULL, shipped_at = NULL,
  delivered_at = NULL, shipping_status = 'processing' WHERE id = (SELECT id FROM public.test_result);
DELETE FROM private.uba_redvault_write_context WHERE transaction_id = txid_current();
UPDATE public.products SET inventory_tracking_policy = 'serialized_strict'
  WHERE id IN (SELECT product_id FROM public.order_items WHERE order_id = (SELECT id FROM public.test_result));
UPDATE public.product_variants SET inventory_tracking_policy = 'inherit'
  WHERE id IN (SELECT variant_id FROM public.order_items WHERE order_id = (SELECT id FROM public.test_result));
INSERT INTO public.product_variants(id, product_id, merchant_id, inventory_tracking_policy)
  SELECT '92500000-0000-4000-8000-000000000001', product_id,
    '6b5cb8a4-5575-456c-b936-8cdfae30db74', 'inherit'
  FROM public.order_items WHERE order_id = (SELECT id FROM public.test_result) LIMIT 1;
INSERT INTO public.variant_inventory(id, merchant_id, variant_id, order_id, order_item_id, status, reserved_at)
  SELECT '92500000-0000-4000-8000-000000000002', '6b5cb8a4-5575-456c-b936-8cdfae30db74',
    '92500000-0000-4000-8000-000000000001', order_id, id, 'reserved', now()
  FROM public.order_items WHERE order_id = (SELECT id FROM public.test_result) LIMIT 1;

DO $$
DECLARE v_attempt private.uba_redvault_payment_attempts%ROWTYPE; v_refund record; v_snapshot jsonb; v_state text;
BEGIN
  IF position('reservation_released' IN pg_get_functiondef('private.release_order_inventory_units(uuid,uuid,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '925 inventory tests require the real serialized release function';
  END IF;
  SELECT * INTO STRICT v_attempt FROM private.uba_redvault_payment_attempts
    WHERE id = (SELECT attempt_id FROM public.test_attempt);
  FOREACH v_state IN ARRAY ARRAY['approved', 'captured_held'] LOOP
  BEGIN
  IF v_state = 'captured_held' THEN
    INSERT INTO private.uba_redvault_write_context VALUES (txid_current());
    UPDATE public.orders SET payment_status = 'unpaid', amount_paid = 0 WHERE id = v_attempt.order_id;
    UPDATE public.transactions SET status = 'pending' WHERE gateway_reference = v_attempt.reference;
    UPDATE private.uba_redvault_payment_attempts SET state = v_state WHERE id = v_attempt.id;
    UPDATE private.uba_redvault_applications SET status = 'pending' WHERE id = v_attempt.application_id;
    DELETE FROM private.uba_redvault_write_context WHERE transaction_id = txid_current();
  END IF;
  SELECT * INTO v_refund FROM public.reserve_uba_redvault_refund(v_attempt.id,
    v_attempt.merchant_id, '925-reserved-full', 'full_capture', NULL);
  PERFORM public.claim_next_uba_redvault_refund();
  PERFORM public.finish_uba_redvault_refund(v_refund.id, 'processed', '925-reserved-provider', 'processed');
  IF NOT EXISTS (SELECT 1 FROM public.variant_inventory WHERE id = '92500000-0000-4000-8000-000000000002'
    AND status = 'available' AND order_id IS NULL AND order_item_id IS NULL)
    OR NOT EXISTS (SELECT 1 FROM private.uba_redvault_refund_lifecycle WHERE refund_id = v_refund.id
      AND financial_state = 'refunded' AND inventory_state = 'released'
      AND (inventory_receipt->>'releasedCount')::integer >= 1) THEN
    RAISE EXCEPTION 'unshipped serialized reservation was not released';
  END IF;
  SELECT to_jsonb(inventory) INTO v_snapshot FROM public.variant_inventory AS inventory
    WHERE id = '92500000-0000-4000-8000-000000000002';
  UPDATE private.uba_redvault_refunds SET state = state WHERE id = v_refund.id;
  IF (SELECT to_jsonb(inventory) FROM public.variant_inventory AS inventory
    WHERE id = '92500000-0000-4000-8000-000000000002') IS DISTINCT FROM v_snapshot THEN
    RAISE EXCEPTION 'processed replay released inventory twice';
  END IF;
  RAISE EXCEPTION '925 restore capture fixture';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> '925 restore capture fixture' THEN RAISE; END IF;
  END;
  END LOOP;
END;
$$;
ROLLBACK;

BEGIN;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SELECT pg_temp.prepare_redvault_refund_925();
DELETE FROM public.shipments WHERE order_id = (SELECT id FROM public.test_result);
INSERT INTO private.uba_redvault_write_context VALUES (txid_current());
UPDATE public.orders SET shipment_id = NULL, tracking_number = NULL, shipped_at = NULL,
  delivered_at = NULL, shipping_status = 'processing' WHERE id = (SELECT id FROM public.test_result);
DELETE FROM private.uba_redvault_write_context WHERE transaction_id = txid_current();
UPDATE public.products SET inventory_tracking_policy = 'serialized_strict'
  WHERE id IN (SELECT product_id FROM public.order_items WHERE order_id = (SELECT id FROM public.test_result));
CREATE OR REPLACE FUNCTION private.release_order_inventory_units(p_merchant_id uuid, p_order_id uuid, p_target_status text DEFAULT 'available')
RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic inventory failure'; END; $$;
DO $$
DECLARE v_attempt private.uba_redvault_payment_attempts%ROWTYPE; v_refund record;
BEGIN
  SELECT * INTO STRICT v_attempt FROM private.uba_redvault_payment_attempts
    WHERE id = (SELECT attempt_id FROM public.test_attempt);
  SELECT * INTO v_refund FROM public.reserve_uba_redvault_refund(v_attempt.id,
    v_attempt.merchant_id, '925-inventory-failure', 'full_capture', NULL);
  PERFORM public.claim_next_uba_redvault_refund();
  PERFORM public.finish_uba_redvault_refund(v_refund.id, 'processed', '925-failure-provider', 'processed');
  IF (SELECT state FROM private.uba_redvault_refunds WHERE id = v_refund.id) <> 'processed'
    OR (SELECT payment_status FROM public.orders WHERE id = v_attempt.order_id) <> 'refunded'
    OR NOT EXISTS (SELECT 1 FROM private.uba_redvault_refund_lifecycle WHERE refund_id = v_refund.id
      AND inventory_state = 'review_required' AND review_reason = 'inventory_release_requires_review') THEN
    RAISE EXCEPTION 'inventory failure lost durable processed refund';
  END IF;
END;
$$;
ROLLBACK;

BEGIN;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SELECT pg_temp.prepare_redvault_refund_925();
DO $$
DECLARE v_attempt private.uba_redvault_payment_attempts%ROWTYPE; v_refund record; v_units jsonb; v_net bigint;
BEGIN
  SELECT * INTO STRICT v_attempt FROM private.uba_redvault_payment_attempts
    WHERE id = (SELECT attempt_id FROM public.test_attempt);
  SELECT sum(unit_price_kobo - allocation_kobo),
    jsonb_agg(jsonb_build_object('orderItemId', order_item_id, 'unitOrdinal', unit_ordinal))
  INTO v_net, v_units FROM private.uba_redvault_line_allocations WHERE application_id = v_attempt.application_id;
  INSERT INTO private.uba_redvault_write_context VALUES (txid_current());
  UPDATE public.orders SET total = v_net::numeric / 100, amount_paid = v_net::numeric / 100,
    tax_amount = 0, shipping_fee = 0 WHERE id = v_attempt.order_id;
  UPDATE public.transactions SET amount = v_net::numeric / 100 WHERE gateway_reference = v_attempt.reference;
  UPDATE private.uba_redvault_payment_attempts SET amount_kobo = v_net,
    provider_response = provider_response || jsonb_build_object('capture_amount_kobo', v_net)
    WHERE id = v_attempt.id;
  DELETE FROM private.uba_redvault_write_context WHERE transaction_id = txid_current();
  SELECT * INTO v_refund FROM public.reserve_uba_redvault_refund(v_attempt.id,
    v_attempt.merchant_id, '925-all-merchandise', 'merchandise_units', v_units);
  PERFORM public.claim_next_uba_redvault_refund();
  PERFORM public.finish_uba_redvault_refund(v_refund.id, 'processed', '925-all-units-provider', 'processed');
  IF (SELECT payment_status FROM public.orders WHERE id = v_attempt.order_id) <> 'refunded'
    OR (SELECT status FROM public.transactions WHERE gateway_reference = v_attempt.reference) <> 'refunded'
    OR private.redvault_approved_completion_durable(v_attempt.order_id) THEN
    RAISE EXCEPTION 'merchandise refunds reaching capture total must terminalize financial state';
  END IF;
END;
$$;
ROLLBACK;

DO $$
DECLARE v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF has_table_privilege(v_role, 'private.uba_redvault_refund_lifecycle', 'SELECT,INSERT,UPDATE,DELETE')
      OR has_function_privilege(v_role, 'private.finalize_redvault_processed_refund()', 'EXECUTE')
      OR has_function_privilege(v_role, 'private.enforce_redvault_redemption_usage_limits()', 'EXECUTE') THEN
      RAISE EXCEPTION '925 internal lifecycle or usage boundary exposed';
    END IF;
  END LOOP;
END;
$$;
SELECT 'REDVAULT 925 real reserved-inventory release, replay, capture-total refund and grants passed' AS result;
