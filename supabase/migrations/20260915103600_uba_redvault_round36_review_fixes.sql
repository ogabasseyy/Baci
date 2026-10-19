-- Round-36 review fixes.
-- P1 (cancel during live booking): customer cancellation ignored live
-- shipment-booking claims. A cancel that landed after
-- claim_order_shipment_booking committed but while the provider request
-- was in flight restocked inventory that the booking then shipped (or
-- sold twice). Both customer cancellation RPCs now reject while a live
-- booking claim exists. The check runs under the shared order-payment
-- advisory lock with the order row locked, so a claim that committed
-- before the lock is visible here, and a later claim observes the
-- cancelled row and rejects. Crashed bookings self-heal: claims become
-- takeable after the 900s lock floor, and this check uses the same
-- window so cancellation unblocks exactly when the claim expires.
CREATE OR REPLACE FUNCTION public.cancel_storefront_order_as_guest(
  p_order_id uuid,
  p_tracking_token text,
  p_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = '' AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_reason text;
BEGIN
  v_reason := NULLIF(btrim(p_reason), '');
  IF v_reason IS NOT NULL AND char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'reason_too_long' USING ERRCODE = '22001';
  END IF;
  IF p_order_id IS NULL OR NULLIF(btrim(p_tracking_token), '') IS NULL THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0)
  );

  SELECT o.* INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id
    AND o.tracking_token = p_tracking_token
    AND o.customer_id IN (
      SELECT c.id FROM public.customers c
      WHERE c.user_id IS NULL
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Idempotent: already cancelled -> no-op, do not re-release.
  IF v_order.shipping_status = 'cancelled' THEN
    RETURN false;
  END IF;

  -- A live shipment-booking claim means a provider request is in flight:
  -- cancelling now would restock inventory that the booking then ships.
  -- The claim window matches the booking lock floor (900s), so a
  -- crashed booking unblocks cancellation exactly when it expires.
  IF v_order.shipment_booking_lock_token IS NOT NULL
    AND v_order.shipment_booking_started_at IS NOT NULL
    AND v_order.shipment_booking_started_at >
      pg_catalog.now() - pg_catalog.make_interval(secs => 900) THEN
    RAISE EXCEPTION 'order_not_cancellable' USING ERRCODE = 'P0001';
  END IF;

  IF v_order.payment_method = 'uba_redvault' THEN
    IF v_order.payment_status IS DISTINCT FROM 'unpaid'
      OR v_order.shipping_status NOT IN ('pending', 'processing') THEN
      RAISE EXCEPTION 'order_not_cancellable' USING ERRCODE = 'P0001';
    END IF;
    -- Mirror the customer RPC: a live hosted URL, an ambiguous
    -- initialization (`initializing`/`indeterminate`), or an in-flight
    -- refund keeps the order active until the authorization can no longer
    -- succeed.
    IF EXISTS (SELECT 1 FROM private.uba_redvault_payment_attempts AS attempt
               WHERE attempt.order_id = p_order_id
                 AND attempt.state IN ('initializing', 'indeterminate', 'initialized', 'captured_held', 'capture_evidence_review', 'approved')) THEN
      RAISE EXCEPTION 'redvault_guest_cancel_active' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM private.uba_redvault_refunds AS refund
               JOIN private.uba_redvault_payment_attempts AS attempt ON attempt.id = refund.attempt_id
               WHERE attempt.order_id = p_order_id
                 AND refund.state IN ('pending', 'processing', 'needs_reconciliation', 'processed')) THEN
      RAISE EXCEPTION 'redvault_guest_cancel_active' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
    ON CONFLICT DO NOTHING;

    UPDATE public.orders o
    SET payment_status = 'cancelled',
        shipping_status = 'cancelled',
        cancelled_at = pg_catalog.now(),
        cancellation_reason = v_reason,
        cancelled_by = 'customer',
        updated_at = pg_catalog.now()
    WHERE o.id = p_order_id;

    UPDATE public.order_payment_accounts a
    SET expires_at = pg_catalog.now()
    WHERE a.order_id = p_order_id
      AND (a.expires_at IS NULL OR a.expires_at > pg_catalog.now());

    UPDATE public.order_wallet_funding_intents i
    SET status = 'cancelled', updated_at = pg_catalog.now()
    WHERE i.order_id = p_order_id
      AND i.status NOT IN ('completed', 'cancelled', 'expired', 'failed');
  -- Quantity-managed stock restocks on REDVAULT cancellation exactly as
  -- on ordinary cancellation. Serialized lines are excluded: the
  -- payment_status trigger already released their units and synced
  -- stock from the now-available units, so restocking them again
  -- would double-count the original quantities into sellable stock.
  -- The exclusion keys on the CURRENT policy to match the sync,
  -- which only touches currently-serialized products.
    PERFORM private.restock_order_items_excluding_serialized(p_order_id);

    DELETE FROM private.uba_redvault_write_context
    WHERE transaction_id = pg_catalog.txid_current();

    RETURN true;
  END IF;

  IF NOT private.order_customer_cancellable(p_order_id) THEN
    RAISE EXCEPTION 'order_not_cancellable' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.orders o
  SET shipping_status = 'cancelled',
      cancelled_at = now(),
      cancellation_reason = v_reason,
      cancelled_by = 'customer',
      updated_at = now()
  WHERE o.id = p_order_id;

  UPDATE public.order_payment_accounts a
  SET expires_at = now()
  WHERE a.order_id = p_order_id
    AND (a.expires_at IS NULL OR a.expires_at > now());

  UPDATE public.order_wallet_funding_intents i
  SET status = 'cancelled', updated_at = now()
  WHERE i.order_id = p_order_id
    AND i.status NOT IN ('completed', 'cancelled', 'expired', 'failed');

  PERFORM private.restock_order_items(p_order_id);

  RETURN true;
END;
$$;
ALTER FUNCTION public.cancel_storefront_order_as_guest(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cancel_storefront_order_as_guest(uuid, text, text)
  FROM PUBLIC, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.cancel_storefront_order_as_guest(uuid, text, text)
  TO anon, authenticated;
CREATE OR REPLACE FUNCTION public.cancel_order_as_customer(
  p_order_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_reason text;
BEGIN
  v_reason := NULLIF(btrim(p_reason), '');
  IF v_reason IS NOT NULL AND char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'reason_too_long' USING ERRCODE = '22001';
  END IF;

  -- Serialize with the shipment-booking claim (advisory lock first, then
  -- the row lock, matching the claim's order): without this, the
  -- live-claim check below could read "no claim" just before a claim
  -- commits and restock inventory the booking then ships.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0)
  );

  SELECT o.* INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id
    AND o.customer_id IN (
      SELECT c.id FROM public.customers c
      WHERE c.user_id = (SELECT auth.uid())
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Idempotent: already cancelled -> no-op, do not re-restock.
  IF v_order.shipping_status = 'cancelled' THEN
    RETURN false;
  END IF;

  -- A live shipment-booking claim means a provider request is in flight:
  -- cancelling now would restock inventory that the booking then ships.
  -- The claim window matches the booking lock floor (900s), so a
  -- crashed booking unblocks cancellation exactly when it expires.
  IF v_order.shipment_booking_lock_token IS NOT NULL
    AND v_order.shipment_booking_started_at IS NOT NULL
    AND v_order.shipment_booking_started_at >
      pg_catalog.now() - pg_catalog.make_interval(secs => 900) THEN
    RAISE EXCEPTION 'order_not_cancellable' USING ERRCODE = 'P0001';
  END IF;

  IF NOT private.order_customer_cancellable(p_order_id) THEN
    RAISE EXCEPTION 'order_not_cancellable' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.orders o
  SET shipping_status = 'cancelled',
      cancelled_at = now(),
      cancellation_reason = v_reason,
      cancelled_by = 'customer',
      updated_at = now()
  WHERE o.id = p_order_id;

  -- Void already-issued payment instruments so a later inbound payment cannot be
  -- matched back to this cancelled order (these can exist before any transaction).
  UPDATE public.order_payment_accounts a
  SET expires_at = now()
  WHERE a.order_id = p_order_id
    AND (a.expires_at IS NULL OR a.expires_at > now());

  UPDATE public.order_wallet_funding_intents i
  SET status = 'cancelled', updated_at = now()
  WHERE i.order_id = p_order_id
    AND i.status NOT IN ('completed', 'cancelled', 'expired', 'failed');

  PERFORM private.restock_order_items(p_order_id);

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_order_as_customer(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.cancel_order_as_customer(uuid, text)
  TO authenticated;
