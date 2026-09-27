-- Round-26 review fixes: guest attach is idempotent (a retry that finds
-- the checkout already owned by the caller succeeds instead of reporting
-- false and triggering guest-context recovery), and the inventory review
-- resolver dispatches full-capture refunds to the full-order release path
-- (the partial-unit helper rejects them, leaving full-refund reviews
-- permanently unresolvable).
CREATE OR REPLACE FUNCTION public.attach_redvault_guest_application_to_customer(
  p_order_id uuid,
  p_tracking_token text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid;
  v_email text;
  v_attached bigint := 0;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'forbidden: attach_redvault_guest_application_to_customer requires authenticated';
  END IF;
  v_user := (SELECT auth.uid());
  v_email := lower(btrim(COALESCE(auth.jwt() ->> 'email', '')));
  IF v_user IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'redvault_attach_identity_required';
  END IF;
  IF p_order_id IS NULL OR NULLIF(btrim(p_tracking_token), '') IS NULL THEN
    RAISE EXCEPTION 'redvault_attach_proof_required';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0)
  );

  IF NOT EXISTS (SELECT 1 FROM public.orders o
                 WHERE o.id = p_order_id AND o.payment_method = 'uba_redvault'
                   AND o.tracking_token = p_tracking_token) THEN
    RAISE EXCEPTION 'redvault_attach_order_not_found';
  END IF;

  UPDATE private.uba_redvault_applications application
  SET user_id = v_user
  WHERE application.order_id = p_order_id
    AND application.user_id IS NULL
    AND application.status = 'pending'
    AND lower(btrim(application.customer_email)) = v_email;
  GET DIAGNOSTICS v_attached = ROW_COUNT;

  UPDATE public.customers customer
  SET user_id = v_user
  FROM public.orders o
  WHERE o.id = p_order_id
    AND customer.id = o.customer_id
    AND customer.user_id IS NULL
    AND lower(btrim(customer.email)) = v_email;

  IF v_attached = 0 THEN
    -- Idempotent success: a retry after the first attach succeeded (or a
    -- resubmit racing the original call) finds the checkout already owned
    -- by this caller. Returning false here would make clients restore the
    -- guest context and strand a live checkout they legitimately own.
    PERFORM 1 FROM private.uba_redvault_applications AS attached
    WHERE attached.order_id = p_order_id
      AND attached.user_id = v_user
      AND lower(btrim(attached.customer_email)) = v_email;
    IF FOUND THEN
      RETURN TRUE;
    END IF;
  END IF;

  RETURN v_attached > 0;
END;
$$;
ALTER FUNCTION public.attach_redvault_guest_application_to_customer(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.attach_redvault_guest_application_to_customer(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.attach_redvault_guest_application_to_customer(uuid, text)
  TO authenticated;

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
