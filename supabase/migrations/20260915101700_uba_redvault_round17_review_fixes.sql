-- Round-17 review fixes: customer and guest REDVAULT cancellation block while
-- a payment attempt is in an ambiguous initialization state. `initializing`
-- means the provider POST is in flight after the claim transaction released
-- its advisory lock; `indeterminate` means the provider call timed out while
-- Paystack may already hold an unpaid or paid transaction. Cancelling (and
-- releasing inventory) in either state lets the external transaction
-- subsequently succeed, leaving captured funds that approval cannot fulfill.
-- Both stay blocked until provider reconciliation moves the attempt to a
-- terminal state (or back to a live state that the initialized guard covers).
CREATE OR REPLACE FUNCTION public.cancel_uba_redvault_order_as_customer(
  p_order_id uuid,
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
  IF (SELECT auth.role()) IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'forbidden: cancel_uba_redvault_order_as_customer requires authenticated';
  END IF;
  v_reason := NULLIF(btrim(p_reason), '');
  IF v_reason IS NOT NULL AND char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'reason_too_long' USING ERRCODE = '22001';
  END IF;

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

  -- Idempotent: already cancelled -> no-op, do not re-release.
  IF v_order.shipping_status = 'cancelled' THEN
    RETURN false;
  END IF;

  IF v_order.payment_method IS DISTINCT FROM 'uba_redvault'
    OR v_order.payment_status IS DISTINCT FROM 'unpaid'
    OR v_order.shipping_status NOT IN ('pending', 'processing') THEN
    RAISE EXCEPTION 'order_not_cancellable' USING ERRCODE = 'P0001';
  END IF;

  -- An initialized attempt holds a live hosted Paystack URL: expiring local
  -- payment-account rows cannot invalidate the already-open checkout page,
  -- so a completed payment would be captured and held while approval
  -- rejects the cancelled order. `initializing` and `indeterminate` are
  -- equally ambiguous (provider POST in flight / timed out while Paystack
  -- may hold a transaction), so they stay blocked until reconciliation
  -- proves the authorization can no longer succeed.
  IF EXISTS (SELECT 1 FROM private.uba_redvault_payment_attempts AS attempt
             WHERE attempt.order_id = p_order_id
               AND attempt.state IN ('initializing', 'indeterminate', 'initialized', 'captured_held', 'capture_evidence_review', 'approved')) THEN
    RAISE EXCEPTION 'redvault_customer_cancel_active' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM private.uba_redvault_refunds AS refund
             JOIN private.uba_redvault_payment_attempts AS attempt ON attempt.id = refund.attempt_id
             WHERE attempt.order_id = p_order_id
               AND refund.state IN ('pending', 'processing', 'needs_reconciliation', 'processed')) THEN
    RAISE EXCEPTION 'redvault_customer_cancel_active' USING ERRCODE = 'P0001';
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

  -- Void already-issued payment instruments so a later inbound payment
  -- cannot be matched back to this cancelled order.
  UPDATE public.order_payment_accounts a
  SET expires_at = pg_catalog.now()
  WHERE a.order_id = p_order_id
    AND (a.expires_at IS NULL OR a.expires_at > pg_catalog.now());

  UPDATE public.order_wallet_funding_intents i
  SET status = 'cancelled', updated_at = pg_catalog.now()
  WHERE i.order_id = p_order_id
    AND i.status NOT IN ('completed', 'cancelled', 'expired', 'failed');

  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();

  RETURN true;
END;
$$;
ALTER FUNCTION public.cancel_uba_redvault_order_as_customer(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cancel_uba_redvault_order_as_customer(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.cancel_uba_redvault_order_as_customer(uuid, text)
  TO authenticated;

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
