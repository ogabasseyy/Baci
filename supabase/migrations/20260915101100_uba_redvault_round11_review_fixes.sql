-- Round-11 review fixes for the REDVAULT subsystem (OR REPLACE only; no base
-- files touched).
--
-- P1 (cleanup/capture serialization): the worker cleanup transition read
-- attempt state without the order payment lock the capture path holds
-- while recording, so a capture committing mid-batch landed on a
-- cancelled row (approval rejects cancelled orders after inventory was
-- released). The guard now takes the lock for the worker cleanup shape
-- before any state check, and capture refuses cancelled orders, closing
-- both directions of the race.
--
-- P1 (customer cancellation): cancel_order_as_customer updated a REDVAULT
-- order without write context, so the guard raised and the storefront
-- cancel route failed. Customers now cancel through a dedicated
-- authenticated RPC that enforces ownership, the unpaid/unshipped
-- eligibility, and the same funds-in-flight exclusions as the
-- abandoned-draft path, then cancels under write context; the existing
-- release trigger frees the fenced units.
--
CREATE OR REPLACE FUNCTION private.reject_unscoped_redvault_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Cleanup/capture serialization: the worker batch must observe attempt
  -- state under the same order payment lock the capture path holds while
  -- recording, otherwise a capture that commits between this trigger's
  -- state check and the batch commit lands on a cancelled row (approval
  -- rejects cancelled orders after inventory was released). Taking the
  -- lock first forces the in-flight capture to commit first, so the held
  -- exclusion below sees captured_held and reverts to a no-op. Scoped to
  -- the worker cleanup shape so all other writers are unaffected.
  IF (SELECT auth.role()) IS NOT DISTINCT FROM 'service_role' AND TG_OP = 'UPDATE'
    AND OLD.payment_method = 'uba_redvault'
    AND OLD.payment_status = 'unpaid'
    AND NEW.payment_status = 'cancelled'
    AND OLD.created_at < pg_catalog.now() - interval '1 hour'
    AND NOT EXISTS (SELECT 1 FROM private.uba_redvault_write_context WHERE transaction_id = pg_catalog.txid_current())
  THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('baci_order_payment:' || OLD.id::text, 0)
    );
  END IF;
  -- Held/active drafts are excluded from the generic cleanup transition: a
  -- stale unpaid draft whose attempt already captured (or approved) the
  -- shopper's money, or which carries an unresolved or processed refund,
  -- still represents funds in flight. Cancelling it would release fenced
  -- units the capture path owns and strand the order where approval rejects
  -- cancelled rows. The dedicated cancel RPC enforces the same exclusions
  -- with explicit errors; the multi-row worker batch must not abort, so
  -- revert the cancel to a no-op instead of raising. Scoped to the worker
  -- shape (service_role, no write context, stale) so protected writers keep
  -- their existing behavior.
  IF (SELECT auth.role()) IS NOT DISTINCT FROM 'service_role' AND TG_OP = 'UPDATE'
    AND OLD.payment_method = 'uba_redvault'
    AND OLD.payment_status = 'unpaid'
    AND NEW.payment_status = 'cancelled'
    AND OLD.created_at < pg_catalog.now() - interval '1 hour'
    AND NOT EXISTS (SELECT 1 FROM private.uba_redvault_write_context WHERE transaction_id = pg_catalog.txid_current())
    AND (
      EXISTS (SELECT 1 FROM private.uba_redvault_payment_attempts AS attempt
              WHERE attempt.order_id = OLD.id
                AND attempt.state IN ('captured_held', 'approved'))
      OR EXISTS (SELECT 1 FROM private.uba_redvault_refunds AS refund
                 JOIN private.uba_redvault_payment_attempts AS attempt ON attempt.id = refund.attempt_id
                 WHERE attempt.order_id = OLD.id
                   AND refund.state IN ('pending', 'processing', 'needs_reconciliation', 'processed'))
    )
  THEN
    NEW.payment_status := OLD.payment_status;
    NEW.updated_at := OLD.updated_at;
    RETURN NEW;
  END IF;
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
  -- Cleanup release cascade (see header comment): the row trigger's
  -- unit/item/tax writes land on the same stale cancelled draft.
  IF (SELECT auth.role()) IS NOT DISTINCT FROM 'service_role' AND TG_OP = 'UPDATE'
    AND OLD.payment_method = 'uba_redvault' AND NEW.payment_method = 'uba_redvault'
    AND NEW.payment_status = 'cancelled'
    AND OLD.payment_status IN ('unpaid', 'cancelled')
    AND OLD.created_at < pg_catalog.now() - interval '1 hour'
    AND (to_jsonb(NEW) - ARRAY['payment_status', 'updated_at',
      'tax_exclusive_amount', 'tax_amount', 'tax_inclusive_amount',
      'invoice_issue_date', 'tax_point_date'])
      IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY['payment_status', 'updated_at',
      'tax_exclusive_amount', 'tax_amount', 'tax_inclusive_amount',
      'invoice_issue_date', 'tax_point_date'])
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


CREATE OR REPLACE FUNCTION public.capture_or_hold_uba_redvault_payment_legacy_915(
  p_transaction_id uuid,
  p_order_id uuid,
  p_gateway text,
  p_reference text,
  p_gateway_response jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_application private.uba_redvault_applications%ROWTYPE;
  v_claims jsonb := COALESCE((SELECT auth.jwt()), '{}'::jsonb);
  v_attempt private.uba_redvault_payment_attempts%ROWTYPE;
  v_capture_amount bigint;
  v_capture_currency text;
  v_capture_reference text;
  v_capture_status text;
  v_duplicate boolean := false;
  v_capture_evidence_verified boolean := false;
  v_order_merchant_id uuid;
  v_order_payment_method text;
  v_order_payment_status text;
  v_order_total numeric;
  v_reason text := 'provider_eligibility_evidence_unavailable';
  v_transaction_amount numeric;
  v_transaction_currency text;
  v_transaction_gateway text;
  v_transaction_merchant_id uuid;
  v_transaction_order_id uuid;
  v_transaction_reference text;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role'
    AND NOT ((SELECT auth.role()) = 'authenticated'
      AND v_claims->>'storefront_order_context' = 'route'
      AND v_claims->>'storefront_order_merchant_id' = '6b5cb8a4-5575-456c-b936-8cdfae30db74') THEN
    RAISE EXCEPTION 'forbidden: capture_or_hold_uba_redvault_payment_legacy_915 requires service_role or scoped route context';
  END IF;

  IF p_transaction_id IS NULL OR p_order_id IS NULL OR p_gateway_response IS NULL THEN
    RAISE EXCEPTION 'redvault_capture_hold_invalid_arguments';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0)
  );

  SELECT t.order_id, t.merchant_id, t.gateway, t.gateway_reference,
    COALESCE(t.amount, 0), t.currency
  INTO v_transaction_order_id, v_transaction_merchant_id, v_transaction_gateway,
    v_transaction_reference, v_transaction_amount, v_transaction_currency
  FROM public.transactions AS t
  WHERE t.id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND OR v_transaction_order_id IS DISTINCT FROM p_order_id THEN
    RAISE EXCEPTION 'redvault_capture_transaction_order_mismatch';
  END IF;

  SELECT o.merchant_id, o.payment_method, o.payment_status, COALESCE(o.total, 0)
  INTO v_order_merchant_id, v_order_payment_method, v_order_payment_status, v_order_total
  FROM public.orders AS o
  WHERE o.id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'redvault_capture_order_not_found';
  END IF;

  IF v_order_payment_method IS DISTINCT FROM 'uba_redvault' THEN
    RETURN jsonb_build_object('kind', 'not_redvault');
  END IF;

  -- A capture that loses the serialization race against cancellation must
  -- not record held funds on a dead order: approval rejects cancelled
  -- rows, so recording here would strand the money with released
  -- inventory. The lock above guarantees this read sees the winner.
  IF v_order_payment_status = 'cancelled' THEN
    RAISE EXCEPTION 'redvault_capture_order_cancelled';
  END IF;

  IF v_order_merchant_id <> '6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid
    OR v_transaction_merchant_id IS DISTINCT FROM v_order_merchant_id
    OR v_transaction_gateway IS DISTINCT FROM 'paystack'
    OR p_gateway IS DISTINCT FROM 'paystack' THEN
    RAISE EXCEPTION 'redvault_capture_transaction_mismatch';
  END IF;

  SELECT attempt.* INTO v_attempt
  FROM private.uba_redvault_payment_attempts AS attempt
  JOIN private.uba_redvault_applications AS application
    ON application.id = attempt.application_id
  WHERE attempt.order_id = p_order_id
    AND application.order_id = p_order_id
    AND attempt.reference = v_transaction_reference
  ORDER BY attempt.created_at DESC
  LIMIT 1
  FOR UPDATE OF attempt;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'redvault_capture_attempt_not_found';
  END IF;

  SELECT * INTO v_application
  FROM private.uba_redvault_applications AS application
  WHERE application.id = v_attempt.application_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'redvault_capture_application_not_found';
  END IF;

  v_capture_reference := p_gateway_response ->> 'reference';
  v_capture_currency := upper(p_gateway_response ->> 'currency');
  v_capture_status := lower(p_gateway_response ->> 'status');
  IF jsonb_typeof(p_gateway_response -> 'amount') = 'number'
    AND p_gateway_response ->> 'amount' ~ '^[0-9]+$' THEN
    v_capture_amount := (p_gateway_response ->> 'amount')::bigint;
  END IF;

  IF p_reference IS DISTINCT FROM v_transaction_reference
    OR v_capture_reference IS DISTINCT FROM v_transaction_reference
    OR v_capture_reference IS DISTINCT FROM v_attempt.reference THEN
    v_reason := 'capture_reference_mismatch';
  ELSIF v_capture_amount IS NULL
    OR v_capture_amount <> v_attempt.amount_kobo
    OR v_capture_amount <> round(v_transaction_amount * 100)::bigint
    OR v_capture_amount <> round(v_order_total * 100)::bigint THEN
    v_reason := 'capture_amount_mismatch';
  ELSIF v_capture_currency IS DISTINCT FROM v_attempt.currency
    OR v_capture_currency IS DISTINCT FROM upper(v_transaction_currency) THEN
    v_reason := 'capture_currency_mismatch';
  ELSIF v_capture_status IS DISTINCT FROM 'success' THEN
    v_reason := 'capture_status_not_success';
  ELSIF v_attempt.merchant_id IS DISTINCT FROM v_order_merchant_id
    OR v_application.order_id IS DISTINCT FROM p_order_id
    OR v_application.merchant_id IS DISTINCT FROM v_order_merchant_id
    OR v_application.quote_payload_hash IS DISTINCT FROM v_attempt.quote_payload_hash
    OR v_attempt.quote_payload_hash !~ '^[0-9a-f]{64}$' THEN
    v_reason := 'capture_quote_mismatch';
  END IF;

  v_capture_evidence_verified :=
    v_reason = 'provider_eligibility_evidence_unavailable';

  IF v_attempt.state = 'captured_held'
    AND v_attempt.provider_response IS NOT NULL THEN
    IF v_attempt.provider_response ->> 'capture_reference' IS DISTINCT FROM v_capture_reference
      OR v_attempt.provider_response ->> 'capture_amount_kobo' IS DISTINCT FROM v_capture_amount::text
      OR v_attempt.provider_response ->> 'capture_currency' IS DISTINCT FROM v_capture_currency
      OR v_attempt.provider_response ->> 'capture_status' IS DISTINCT FROM v_capture_status
      OR NOT v_capture_evidence_verified THEN
      RAISE EXCEPTION 'redvault_capture_evidence_conflict';
    END IF;
    v_duplicate := true;
  ELSE
    UPDATE private.uba_redvault_payment_attempts
    SET state = CASE
        WHEN v_capture_evidence_verified THEN 'captured_held'
        ELSE 'capture_evidence_review'
      END,
      captured_at = CASE
        WHEN v_capture_evidence_verified THEN COALESCE(captured_at, now())
        ELSE NULL
      END,
      provider_response = jsonb_build_object(
        'capture_amount_kobo', v_capture_amount,
        'capture_currency', v_capture_currency,
        'capture_reference', v_capture_reference,
        'capture_status', v_capture_status,
        'capture_evidence_status', CASE
          WHEN v_capture_evidence_verified THEN 'verified_success'
          ELSE 'requires_review'
        END,
        'held_reason', v_reason,
        'quote_payload_hash', v_attempt.quote_payload_hash,
        'transaction_id', p_transaction_id
      )
    WHERE id = v_attempt.id;
  END IF;

  RETURN jsonb_build_object(
    'duplicate', v_duplicate,
    'kind', CASE
      WHEN v_capture_evidence_verified THEN 'captured_held'
      ELSE 'capture_evidence_review'
    END,
    'reason', v_reason
  );
END;
$$;
ALTER FUNCTION public.capture_or_hold_uba_redvault_payment_legacy_915(uuid, uuid, text, text, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.capture_or_hold_uba_redvault_payment_legacy_915(uuid, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.capture_or_hold_uba_redvault_payment_legacy_915(uuid, uuid, text, text, jsonb) TO service_role, authenticated;

-- Authenticated customer cancellation for REDVAULT orders. Mirrors
-- cancel_order_as_customer (ownership, reason cap, idempotent no-op,
-- instrument voiding) but runs under the protected write path the guard
-- requires and marks payment_status cancelled so the abandoned-units
-- release trigger frees the fenced reservation. Funds-in-flight orders
-- (held/approved capture, live refund) are rejected like the
-- abandoned-draft path instead of stranding money.
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

  IF EXISTS (SELECT 1 FROM private.uba_redvault_payment_attempts AS attempt
             WHERE attempt.order_id = p_order_id
               AND attempt.state IN ('captured_held', 'approved')) THEN
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
