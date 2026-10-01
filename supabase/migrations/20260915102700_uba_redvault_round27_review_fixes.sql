-- Round-27 review fixes: full-capture inventory review resolution also
-- restocks quantity-managed stock. The serialized-unit release alone
-- reports success with zero units for manage_stock orders, which would
-- close the review while decremented stock stays unrestored; mirror the
-- merchant-cancellation sequence (release, then restock).
CREATE OR REPLACE FUNCTION public.resolve_uba_redvault_refund_inventory_review(
  p_refund_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_result jsonb;
  v_refund private.uba_redvault_refunds%ROWTYPE;
  v_lifecycle private.uba_redvault_refund_lifecycle%ROWTYPE;
  v_order public.orders%ROWTYPE;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: REDVAULT refund review resolution requires service_role';
  END IF;

  SELECT * INTO STRICT v_refund
  FROM private.uba_redvault_refunds
  WHERE id = p_refund_id;
  SELECT * INTO STRICT v_lifecycle
  FROM private.uba_redvault_refund_lifecycle
  WHERE refund_id = p_refund_id
  FOR UPDATE;

  IF v_lifecycle.inventory_state <> 'review_required' THEN
    RETURN jsonb_build_object('success', true, 'refundId', p_refund_id,
      'inventoryState', v_lifecycle.inventory_state);
  END IF;

  IF v_refund.refund_type = 'full_capture' THEN
    -- Full captures carry no unit links, so the partial-unit helper always
    -- rejects them: resolve through the same full-order release the
    -- processed-refund finalization uses. The serialized-policy gate that
    -- queued this review is operator judgment now, but the shipment-state
    -- gates are re-enforced: released inventory must never cover goods
    -- that already shipped.
    SELECT * INTO STRICT v_order FROM public.orders WHERE id = v_lifecycle.order_id FOR UPDATE;
    IF v_refund.state <> 'processed'
      OR v_order.shipping_status NOT IN ('pending', 'processing') OR v_order.cancelled_at IS NOT NULL
      OR v_order.shipment_id IS NOT NULL OR v_order.tracking_number IS NOT NULL
      OR v_order.shipped_at IS NOT NULL OR v_order.delivered_at IS NOT NULL
      OR v_order.shipment_booking_lock_token IS NOT NULL
      OR EXISTS (SELECT 1 FROM public.shipments WHERE order_id = v_order.id) THEN
      RAISE EXCEPTION 'redvault_full_refund_inventory_requires_review';
    END IF;
    -- The complete full-order path, mirroring merchant cancellation:
    -- quantity-managed stock restocks, then serialized units release.
    -- Release-only would report success with zero units for a
    -- manage_stock order while its decremented stock stays unrestored.
    PERFORM private.restock_order_items(v_order.id);
    v_result := private.release_order_inventory_units(v_order.merchant_id, v_order.id, 'available');
    IF (v_result->>'success')::boolean IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'redvault_refund_inventory_release_failed';
    END IF;
    v_result := v_result || jsonb_build_object('releasePath', 'full_order');
  ELSE
    v_result := private.release_redvault_refund_inventory_units(p_refund_id);
    v_result := v_result || jsonb_build_object('releasePath', 'refund_units');
  END IF;
  UPDATE private.uba_redvault_refund_lifecycle
  SET inventory_state = 'released', review_reason = NULL, inventory_receipt = v_result
  WHERE refund_id = p_refund_id AND inventory_state = 'review_required';
  UPDATE public.reconciliation_review
  SET resolved_at = pg_catalog.clock_timestamp(),
      resolution_notes = 'REDVAULT refund inventory safely released by protected resolver.'
  WHERE issue_type = 'serialized_inventory_confirmation_failed'
    AND order_id = v_lifecycle.order_id
    AND (metadata->>'refundId' = p_refund_id::text
      OR metadata->'refundIds' ? p_refund_id::text)
    AND resolved_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM private.uba_redvault_refund_lifecycle AS remaining
      WHERE remaining.order_id = v_lifecycle.order_id
        AND remaining.inventory_state = 'review_required'
        AND remaining.refund_id IS DISTINCT FROM p_refund_id
    );
  RETURN v_result || jsonb_build_object('inventoryState', 'released');
END;
$$;
ALTER FUNCTION public.resolve_uba_redvault_refund_inventory_review(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_uba_redvault_refund_inventory_review(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_uba_redvault_refund_inventory_review(uuid)
  TO service_role;
