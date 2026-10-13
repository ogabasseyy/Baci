-- Round-8 review fixes for the REDVAULT subsystem (OR REPLACE only; no base
-- files touched).
--
-- P1 (indeterminate refunds): mark_uba_redvault_refund_submission_indeterminate
-- parks provider timeouts/non-2xx/unverifiable responses in
-- needs_reconciliation without a provider reference, but the reconciliation
-- claim only selected processing rows with a reference, so those refunds were
-- unclaimable while reserve v2 blocked further refunds. The claim now also
-- selects needs_reconciliation rows (resolved through the original capture
-- reference), and reconcile accepts that state.
--
-- P1 (abandoned cleanup): the unscoped-order trigger aborted the
-- mark_abandoned_orders batch on the first stale REDVAULT draft. The trigger
-- now permits exactly the service_role stale-unpaid-to-cancelled worker
-- transition; cancel_abandoned_uba_redvault_draft cancels and releases fenced
-- inventory through the protected path.
--
-- P2 (variant attributes): get_storefront_redvault_variant_pricing now also
-- returns variant.attributes so the protected quote binds the authoritative
-- storage/color snapshot instead of normalizing to {}.
CREATE OR REPLACE FUNCTION public.claim_next_uba_redvault_refund_reconciliation()
RETURNS TABLE (
  id uuid, amount_kobo bigint, state text, attempt_reference text,
  provider_reference text, provider_status text, reconciliation_claim_token uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN QUERY
  WITH candidate AS (
    SELECT refund.id FROM private.uba_redvault_refunds refund
    WHERE (refund.state = 'processing' AND refund.provider_reference IS NOT NULL
      OR refund.state = 'needs_reconciliation')
      AND (refund.reconciliation_claim_token IS NULL
        OR refund.reconciliation_claimed_at IS NULL
        OR refund.reconciliation_claimed_at <= pg_catalog.statement_timestamp() - interval '2 minutes')
    ORDER BY refund.updated_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  ), claimed AS (
    UPDATE private.uba_redvault_refunds refund
    SET reconciliation_claim_token = extensions.gen_random_uuid(),
      reconciliation_claimed_at = pg_catalog.statement_timestamp(), updated_at = pg_catalog.now()
    FROM candidate WHERE refund.id = candidate.id
    RETURNING refund.*
  )
  SELECT refund.id, refund.amount_kobo, refund.state, attempt.reference,
    refund.provider_reference, refund.provider_status, refund.reconciliation_claim_token
  FROM claimed refund
  JOIN private.uba_redvault_payment_attempts attempt ON attempt.id = refund.attempt_id;
END;
$$;
ALTER FUNCTION public.claim_next_uba_redvault_refund_reconciliation() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_next_uba_redvault_refund_reconciliation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_uba_redvault_refund_reconciliation() TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_uba_redvault_refund(
  p_refund_id uuid,
  p_reconciliation_claim_token uuid,
  p_provider_status text
)
RETURNS TABLE (
  id uuid, amount_kobo bigint, state text, attempt_reference text,
  provider_reference text, provider_status text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_refund private.uba_redvault_refunds%ROWTYPE; v_outcome text;
BEGIN
  IF p_provider_status IS NULL OR p_provider_status NOT IN ('pending', 'processed', 'failed') THEN
    RAISE EXCEPTION 'redvault_refund_provider_status_untrusted';
  END IF;
  SELECT * INTO v_refund FROM private.uba_redvault_refunds AS refund WHERE refund.id = p_refund_id FOR UPDATE;
  IF NOT FOUND OR v_refund.state NOT IN ('processing', 'needs_reconciliation')
    OR p_reconciliation_claim_token IS NULL
    OR v_refund.reconciliation_claimed_at IS NULL
    OR v_refund.reconciliation_claimed_at <= pg_catalog.statement_timestamp() - interval '2 minutes'
    OR v_refund.reconciliation_claim_token IS DISTINCT FROM p_reconciliation_claim_token THEN
    RAISE EXCEPTION 'redvault_refund_reconciliation_claim_invalid';
  END IF;
  v_outcome := CASE WHEN p_provider_status = 'pending' THEN 'processing' ELSE p_provider_status END;
  UPDATE private.uba_redvault_refunds SET state = v_outcome,
    provider_status = p_provider_status,
    failure_code = CASE WHEN p_provider_status = 'failed' THEN 'provider_rejected' ELSE failure_code END,
    processed_at = CASE WHEN p_provider_status = 'processed' THEN pg_catalog.now() ELSE processed_at END,
    reconciliation_claim_token = NULL, reconciliation_claimed_at = NULL, updated_at = pg_catalog.now()
  WHERE uba_redvault_refunds.id = p_refund_id RETURNING * INTO v_refund;
  IF p_provider_status = 'failed' THEN
    UPDATE private.uba_redvault_refund_line_allocations SET released_at = pg_catalog.now()
    WHERE refund_id = p_refund_id AND released_at IS NULL;
  END IF;
  RETURN QUERY SELECT v_refund.id, v_refund.amount_kobo, v_refund.state, attempt.reference,
    v_refund.provider_reference, v_refund.provider_status
  FROM private.uba_redvault_payment_attempts attempt WHERE attempt.id = v_refund.attempt_id;
END;
$$;
ALTER FUNCTION public.reconcile_uba_redvault_refund(uuid, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reconcile_uba_redvault_refund(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_uba_redvault_refund(uuid, uuid, text) TO service_role;

DROP FUNCTION IF EXISTS public.get_storefront_redvault_variant_pricing(uuid[]);

CREATE FUNCTION public.get_storefront_redvault_variant_pricing(p_variant_ids uuid[])
RETURNS TABLE (id uuid, product_id uuid, price_override numeric, condition text, attributes jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.jwt()->>'storefront_order_context' IS DISTINCT FROM 'route'
    OR NULLIF(auth.jwt()->>'storefront_order_merchant_id', '') IS NULL THEN
    RAISE EXCEPTION 'redvault_route_context_required';
  END IF;
  RETURN QUERY
  SELECT variant.id, variant.product_id, variant.price_override, variant.condition,
    variant.attributes
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
  -- Abandoned-order cleanup runs as a service_role batch UPDATE over every
  -- stale unpaid order. Without a carve-out, the first stale REDVAULT draft
  -- aborts the whole statement and blocks cleanup for all other orders, so
  -- permit exactly that worker transition: a stale unpaid draft flipped to
  -- cancelled with nothing else changed. Fenced inventory is released
  -- separately through cancel_abandoned_uba_redvault_draft.
  IF (SELECT auth.role()) IS NOT DISTINCT FROM 'service_role' AND TG_OP = 'UPDATE'
    AND OLD.payment_method = 'uba_redvault'
    AND OLD.payment_status = 'unpaid'
    AND NEW.payment_status = 'cancelled'
    AND OLD.created_at < pg_catalog.now() - interval '1 hour'
    AND (to_jsonb(NEW) - ARRAY['payment_status', 'updated_at'])
      IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY['payment_status', 'updated_at'])
  THEN
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

-- Protected REDVAULT abandoned-draft cancellation and inventory release for
-- the ops cleanup worker (service_role only). Cancels a stale unpaid draft
-- that never held money and releases its fenced serial reservations back to
-- available. Idempotent: an already-cancelled draft only releases leftovers.
CREATE OR REPLACE FUNCTION public.cancel_abandoned_uba_redvault_draft(
  p_order_id uuid,
  p_hours_threshold int DEFAULT 72
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_item public.order_items%ROWTYPE;
  v_unit record;
  v_units_json jsonb;
  v_released integer := 0;
  v_cancelled boolean := false;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: cancel_abandoned_uba_redvault_draft requires service_role';
  END IF;
  IF p_hours_threshold IS NULL OR p_hours_threshold < 1 OR p_hours_threshold > 720 THEN
    RAISE EXCEPTION 'redvault_abandoned_draft_threshold_invalid';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0)
  );
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND
    OR v_order.merchant_id IS DISTINCT FROM '6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid
    OR v_order.payment_method IS DISTINCT FROM 'uba_redvault' THEN
    RAISE EXCEPTION 'redvault_abandoned_draft_order_mismatch';
  END IF;
  IF v_order.payment_status NOT IN ('unpaid', 'cancelled') THEN
    RAISE EXCEPTION 'redvault_abandoned_draft_state_invalid';
  END IF;
  IF EXISTS (SELECT 1 FROM private.uba_redvault_payment_attempts AS attempt
             WHERE attempt.order_id = p_order_id
               AND attempt.state IN ('captured_held', 'approved')) THEN
    RAISE EXCEPTION 'redvault_abandoned_draft_active';
  END IF;
  IF EXISTS (SELECT 1 FROM private.uba_redvault_refunds AS refund
             JOIN private.uba_redvault_payment_attempts AS attempt ON attempt.id = refund.attempt_id
             WHERE attempt.order_id = p_order_id
               AND refund.state IN ('pending', 'processing', 'needs_reconciliation', 'processed')) THEN
    RAISE EXCEPTION 'redvault_abandoned_draft_active';
  END IF;
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  IF v_order.payment_status = 'unpaid' THEN
    IF v_order.created_at >= pg_catalog.now() - (p_hours_threshold * interval '1 hour') THEN
      RAISE EXCEPTION 'redvault_abandoned_draft_not_stale';
    END IF;
    UPDATE public.orders SET payment_status = 'cancelled', updated_at = pg_catalog.now()
    WHERE id = p_order_id;
    v_cancelled := true;
  END IF;
  FOR v_item IN SELECT * FROM public.order_items WHERE order_id = p_order_id FOR UPDATE LOOP
    FOR v_unit IN
      SELECT inventory.id, inventory.variant_id, inventory.branch_id, variant.product_id
      FROM public.variant_inventory AS inventory
      JOIN public.product_variants AS variant ON variant.id = inventory.variant_id
      WHERE inventory.order_id = p_order_id
        AND inventory.order_item_id = v_item.id
        AND inventory.status = 'reserved'
      ORDER BY inventory.id
      FOR UPDATE
    LOOP
      PERFORM private.record_variant_inventory_event(v_unit.id, v_order.merchant_id,
        v_unit.product_id, v_unit.variant_id, 'reservation_released', 'reserved',
        'available', p_order_id, v_item.id, v_unit.branch_id, NULL, NULL,
        jsonb_build_object('redvaultAbandonedCancel', true));
      UPDATE public.variant_inventory
      SET status = 'available', order_id = NULL, order_item_id = NULL,
        reserved_at = NULL, reservation_expires_at = NULL, updated_at = pg_catalog.now()
      WHERE id = v_unit.id;
      v_released := v_released + 1;
    END LOOP;
    SELECT jsonb_agg(jsonb_build_object('inventoryUnitId', inventory.id,
      'identifierType', inventory.identifier_type, 'identifierValue', inventory.identifier_value))
    INTO v_units_json FROM public.variant_inventory AS inventory WHERE inventory.order_item_id = v_item.id;
    UPDATE public.order_items
    SET fulfillment_data = jsonb_build_object('source', 'merchant_stock',
      'reservationExpiresAt', NULL,
      'inventoryUnits', COALESCE(v_units_json, '[]'::jsonb),
      'missingUnitCount', GREATEST(v_item.quantity - (SELECT count(*) FROM public.variant_inventory AS inventory
        WHERE inventory.order_item_id = v_item.id AND inventory.status = 'reserved'), 0),
      'fulfillmentQuantity', (SELECT count(*) FROM public.variant_inventory AS inventory
        WHERE inventory.order_item_id = v_item.id AND inventory.status = 'reserved'))
    WHERE id = v_item.id;
    PERFORM private.sync_serialized_stock(v_order.merchant_id, v_item.product_id);
  END LOOP;
  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();
  RETURN jsonb_build_object('cancelled', v_cancelled, 'releasedUnitCount', v_released,
    'orderId', p_order_id);
END;
$$;
ALTER FUNCTION public.cancel_abandoned_uba_redvault_draft(uuid, int) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cancel_abandoned_uba_redvault_draft(uuid, int)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_abandoned_uba_redvault_draft(uuid, int) TO service_role;
