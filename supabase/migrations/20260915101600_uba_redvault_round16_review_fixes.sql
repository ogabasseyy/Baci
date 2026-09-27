-- Round-16 review fixes: the base refund-reservation aggregate counts
-- indeterminate (needs_reconciliation) refunds so a direct caller cannot
-- double-reserve the capture; abandoned cleanup acquires the order payment
-- serialization before its batch update (same lock order as payment paths,
-- so cleanup can no longer deadlock approval); guests can cancel their own
-- guest-owned orders through a tracking-token-bound dispatcher.
CREATE OR REPLACE FUNCTION public.reserve_uba_redvault_refund(
  p_attempt_id uuid,
  p_merchant_id uuid,
  p_idempotency_key text,
  p_type text,
  p_units jsonb DEFAULT NULL
)
RETURNS TABLE (
  id uuid, amount_kobo bigint, state text, attempt_reference text,
  provider_reference text, provider_status text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_attempt private.uba_redvault_payment_attempts%ROWTYPE;
  v_application private.uba_redvault_applications%ROWTYPE;
  v_refund private.uba_redvault_refunds%ROWTYPE;
  v_unit jsonb;
  v_allocation private.uba_redvault_line_allocations%ROWTYPE;
  v_capture_amount bigint;
  v_capture_currency text;
  v_capture_reference text;
  v_capture_status text;
  v_amount bigint := 0;
  v_reserved bigint := 0;
BEGIN
  IF p_attempt_id IS NULL OR p_merchant_id IS NULL OR p_idempotency_key IS NULL
    OR length(trim(p_idempotency_key)) = 0 OR length(p_idempotency_key) > 200 THEN
    RAISE EXCEPTION 'redvault_refund_request_invalid';
  END IF;
  IF p_type NOT IN ('full_capture', 'merchandise_units') THEN
    RAISE EXCEPTION 'redvault_refund_type_unsupported';
  END IF;
  SELECT * INTO v_attempt FROM private.uba_redvault_payment_attempts AS attempt
    WHERE attempt.id = p_attempt_id FOR UPDATE;
  IF NOT FOUND OR v_attempt.merchant_id IS DISTINCT FROM p_merchant_id THEN
    RAISE EXCEPTION 'redvault_refund_attempt_not_found';
  END IF;
  IF v_attempt.state NOT IN ('captured_held', 'approved') THEN
    RAISE EXCEPTION 'redvault_refund_capture_required';
  END IF;
  IF jsonb_typeof(v_attempt.provider_response) IS DISTINCT FROM 'object'
    OR COALESCE(v_attempt.provider_response->>'capture_amount_kobo', '') !~ '^[1-9][0-9]*$' THEN
    RAISE EXCEPTION 'redvault_refund_capture_evidence_missing';
  END IF;
  v_capture_amount := (v_attempt.provider_response->>'capture_amount_kobo')::bigint;
  v_capture_currency := upper(v_attempt.provider_response->>'capture_currency');
  v_capture_reference := v_attempt.provider_response->>'capture_reference';
  v_capture_status := lower(v_attempt.provider_response->>'capture_status');
  IF v_capture_reference IS DISTINCT FROM v_attempt.reference
    OR v_capture_currency IS DISTINCT FROM v_attempt.currency
    OR v_capture_status IS DISTINCT FROM 'success'
    OR v_capture_amount IS DISTINCT FROM v_attempt.amount_kobo
    OR v_attempt.provider_response->>'held_reason' IS DISTINCT FROM 'provider_eligibility_evidence_unavailable' THEN
    RAISE EXCEPTION 'redvault_refund_capture_evidence_mismatch';
  END IF;
  SELECT * INTO v_refund FROM private.uba_redvault_refunds AS refund
    WHERE refund.attempt_id = p_attempt_id AND refund.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN QUERY SELECT v_refund.id, v_refund.amount_kobo, v_refund.state, v_attempt.reference,
      v_refund.provider_reference, v_refund.provider_status;
    RETURN;
  END IF;
  SELECT * INTO v_application FROM private.uba_redvault_applications AS application
    WHERE application.id = v_attempt.application_id AND application.merchant_id = p_merchant_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'redvault_refund_application_missing'; END IF;
  -- A needs_reconciliation refund is a provider timeout that may already
  -- have completed externally: its amount stays reserved until it fails or
  -- finalizes, or a second reservation with another idempotency key could
  -- refund the same capture twice. Failed refunds stay excluded (retryable).
  SELECT COALESCE(sum(refund.amount_kobo), 0) INTO v_reserved FROM private.uba_redvault_refunds AS refund
    WHERE refund.attempt_id = p_attempt_id AND refund.state IN ('pending', 'processing', 'needs_reconciliation', 'processed');
  IF p_type = 'full_capture' THEN
    IF p_units IS NOT NULL OR v_reserved >= v_capture_amount THEN
      RAISE EXCEPTION 'redvault_full_refund_unavailable';
    END IF;
    v_amount := v_capture_amount - v_reserved;
  ELSE
    IF jsonb_typeof(p_units) IS DISTINCT FROM 'array' OR jsonb_array_length(p_units) = 0 THEN
      RAISE EXCEPTION 'redvault_refund_units_required';
    END IF;
    -- Allocation links are inserted only after the loop, so the per-unit
    -- already-reserved check cannot see a pair repeated within this same
    -- request: reject duplicates up front instead of double-counting into
    -- a primary-key violation on the bulk insert.
    IF (SELECT count(*) FROM jsonb_array_elements(p_units))
      <> (SELECT count(DISTINCT (value->>'orderItemId', value->>'unitOrdinal'))
          FROM jsonb_array_elements(p_units)) THEN
      RAISE EXCEPTION 'redvault_refund_unit_duplicate';
    END IF;
    FOR v_unit IN SELECT value FROM jsonb_array_elements(p_units) LOOP
      IF jsonb_typeof(v_unit) IS DISTINCT FROM 'object'
        OR COALESCE(v_unit->>'orderItemId', '') !~ '^[0-9a-fA-F-]{36}$'
        OR COALESCE(v_unit->>'unitOrdinal', '') !~ '^[1-9][0-9]*$' THEN
        RAISE EXCEPTION 'redvault_refund_unit_invalid';
      END IF;
      SELECT * INTO v_allocation FROM private.uba_redvault_line_allocations
        WHERE application_id = v_application.id
          AND order_item_id = (v_unit->>'orderItemId')::uuid
          AND unit_ordinal = (v_unit->>'unitOrdinal')::integer FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'redvault_refund_unit_not_found'; END IF;
      -- Refund links are released only when the refund fails, so an unreleased
      -- link with a non-failed refund covers both an in-flight reservation and
      -- an already-processed refund: neither may reserve the unit again, while
      -- failed refunds stay retryable.
      IF EXISTS (SELECT 1 FROM private.uba_redvault_refund_line_allocations AS link
        JOIN private.uba_redvault_refunds AS refund ON refund.id = link.refund_id
        WHERE link.application_id = v_application.id
          AND link.order_item_id = v_allocation.order_item_id
          AND link.unit_ordinal = v_allocation.unit_ordinal
          AND link.released_at IS NULL AND refund.state <> 'failed') THEN
        RAISE EXCEPTION 'redvault_refund_unit_already_reserved';
      END IF;
      v_amount := v_amount + (v_allocation.unit_price_kobo - v_allocation.allocation_kobo);
    END LOOP;
    IF v_amount <= 0 OR v_amount > v_capture_amount - v_reserved THEN
      RAISE EXCEPTION 'redvault_refund_amount_exceeds_capture';
    END IF;
  END IF;
  INSERT INTO private.uba_redvault_refunds(attempt_id, idempotency_key, amount_kobo, state, refund_type)
    VALUES (p_attempt_id, p_idempotency_key, v_amount, 'pending', p_type) RETURNING * INTO v_refund;
  IF p_type = 'merchandise_units' THEN
    INSERT INTO private.uba_redvault_refund_line_allocations(refund_id, application_id, order_item_id, unit_ordinal, net_amount_kobo)
    SELECT v_refund.id, v_application.id, allocation.order_item_id, allocation.unit_ordinal,
      allocation.unit_price_kobo - allocation.allocation_kobo
    FROM jsonb_array_elements(p_units) unit(value)
    JOIN private.uba_redvault_line_allocations allocation ON allocation.application_id = v_application.id
      AND allocation.order_item_id = (unit.value->>'orderItemId')::uuid
      AND allocation.unit_ordinal = (unit.value->>'unitOrdinal')::integer;
  END IF;
  RETURN QUERY SELECT v_refund.id, v_refund.amount_kobo, v_refund.state, v_attempt.reference,
    v_refund.provider_reference, v_refund.provider_status;
END;
$$;
ALTER FUNCTION public.reserve_uba_redvault_refund(uuid, uuid, text, text, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reserve_uba_redvault_refund(uuid, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_uba_redvault_refund(uuid, uuid, text, text, jsonb) TO service_role;

-- Abandoned cleanup must serialize against approval in the same lock order
-- the payment paths use (order payment advisory lock first, row lock
-- second). The row trigger cannot take the advisory lock safely: the batch
-- UPDATE already holds the row lock when the trigger fires, while approval
-- takes the advisory lock first, which deadlocks. Pre-acquire the advisory
-- lock for every stale REDVAULT candidate here, before the batch UPDATE
-- locks any row. The trigger's lock then re-enters the already-held
-- transaction lock as a no-op instead of inverting the order.
CREATE OR REPLACE FUNCTION public.mark_abandoned_orders(hours_threshold int DEFAULT 72)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_order_id uuid;
BEGIN
  IF hours_threshold IS NULL OR hours_threshold < 1 OR hours_threshold > 720 THEN
    RAISE EXCEPTION 'invalid_hours_threshold: % (expected 1-720)', hours_threshold
      USING ERRCODE = '22023';
  END IF;

  FOR v_order_id IN
    SELECT o.id
    FROM public.orders o
    WHERE o.payment_status = 'unpaid'
      AND o.created_at < (now() - (hours_threshold * interval '1 hour'))
      AND o.payment_method = 'uba_redvault'
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('baci_order_payment:' || v_order_id::text, 0)
    );
  END LOOP;

  WITH cancelled_orders AS (
    UPDATE public.orders o
    SET
      payment_status = 'cancelled',
      shipping_status = CASE
        WHEN o.payment_status IN ('pending', 'bnpl_pending')
          AND o.payment_method IN ('credit_direct', 'klump')
        THEN 'cancelled'
        ELSE o.shipping_status
      END,
      cancelled_at = CASE
        WHEN o.payment_status IN ('pending', 'bnpl_pending')
          AND o.payment_method IN ('credit_direct', 'klump')
        THEN COALESCE(o.cancelled_at, now())
        ELSE o.cancelled_at
      END,
      updated_at = now()
    WHERE (
        (
          o.payment_status = 'unpaid'
          AND o.created_at < (now() - (hours_threshold * interval '1 hour'))
        )
        OR (
          o.payment_status IN ('pending', 'bnpl_pending')
          AND o.payment_method IN ('credit_direct', 'klump')
          AND o.updated_at < (now() - (hours_threshold * interval '1 hour'))
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.reconciliation_review rr
        WHERE o.payment_method = 'credit_direct'
          AND rr.order_id = o.id
          AND rr.issue_type = 'credit_direct_confirmation_missing'
          AND rr.resolved_at IS NULL
          AND rr.metadata->>'source' = 'credit_direct_sdk_on_success'
          AND (rr.metadata->>'client_completed_at')::timestamptz
            > (clock_timestamp() - interval '14 days')
      )
    RETURNING o.id, o.payment_method
  )
  UPDATE public.reconciliation_review rr
  SET resolved_at = clock_timestamp(),
      resolution_notes = COALESCE(
        rr.resolution_notes,
        'Provider confirmation deadline expired; order was cancelled as abandoned.'
      )
  FROM cancelled_orders c
  WHERE c.payment_method = 'credit_direct'
    AND rr.order_id = c.id
    AND rr.issue_type = 'credit_direct_confirmation_missing'
    AND rr.resolved_at IS NULL;
END;
$$;

COMMENT ON FUNCTION public.mark_abandoned_orders(integer) IS
  'Cancels stale unpaid/BNPL attempts while giving explicit Credit Direct SDK-success cases a bounded reconciliation window.';

REVOKE ALL ON FUNCTION public.mark_abandoned_orders(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_abandoned_orders(integer) TO service_role;

-- Guest cancellation for guest-owned orders, authorized by the order's own
-- tracking token instead of a Supabase session. Unauthenticated shoppers can
-- create orders but neither customer cancel RPC accepts them, so without
-- this path a guest REDVAULT review (mobile) or a stale prepared order
-- (web lane switch) can never be released promptly. Guest-owned only
-- (customers.user_id IS NULL): attached shoppers keep using the account
-- route, so a token presented for someone else's attached order finds
-- nothing. REDVAULT rows run the same protected-path cancellation and
-- live-attempt guards as the customer RPC; ordinary rows mirror
-- cancel_order_as_customer including the restock.
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
    -- Mirror the customer RPC: a live hosted URL or an in-flight refund
    -- keeps the order active until the authorization can no longer succeed.
    IF EXISTS (SELECT 1 FROM private.uba_redvault_payment_attempts AS attempt
               WHERE attempt.order_id = p_order_id
                 AND attempt.state IN ('initialized', 'captured_held', 'capture_evidence_review', 'approved')) THEN
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
