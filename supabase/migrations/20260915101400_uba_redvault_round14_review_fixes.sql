-- Round-14 review fixes: abandoned cleanup skips live initialized
-- attempts like customer cancellation does; initialization recovery accepts
-- the scoped customer route context so checkout never mints a service-role
-- client; the initialization claim freezes the GIGL retained-shipping
-- snapshot so the Paystack split collects it.
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
  -- stale unpaid draft whose attempt is initialized, captured, held for
  -- evidence review, or approved the shopper's money, or which carries an
  -- unresolved or processed refund, still represents funds in flight. An
  -- initialized attempt holds a live hosted URL the batch cannot void, so
  -- cancelling it would release fenced units the capture path owns and
  -- strand the order where approval rejects cancelled rows. The dedicated
  -- cancel RPC enforces the same exclusions with explicit errors; the
  -- multi-row worker batch must not abort, so revert the cancel to a no-op
  -- instead of raising. Scoped to the worker shape (service_role, no write
  -- context, stale) so protected writers keep their existing behavior.
  IF (SELECT auth.role()) IS NOT DISTINCT FROM 'service_role' AND TG_OP = 'UPDATE'
    AND OLD.payment_method = 'uba_redvault'
    AND OLD.payment_status = 'unpaid'
    AND NEW.payment_status = 'cancelled'
    AND OLD.created_at < pg_catalog.now() - interval '1 hour'
    AND NOT EXISTS (SELECT 1 FROM private.uba_redvault_write_context WHERE transaction_id = pg_catalog.txid_current())
    AND (
      EXISTS (SELECT 1 FROM private.uba_redvault_payment_attempts AS attempt
              WHERE attempt.order_id = OLD.id
                AND attempt.state IN ('initialized', 'captured_held', 'capture_evidence_review', 'approved'))
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

-- Initialization recovery through the customer's own scoped route client:
-- the user-facing checkout must not mint an unrestricted service-role
-- client to reconcile its own ambiguous claim. The scoped path binds the
-- attempt to the JWT customer exactly like the record RPC does; the
-- service_role path keeps its existing behavior for ops callers.
CREATE OR REPLACE FUNCTION public.reconcile_storefront_redvault_payment_attempt_initialization(
  p_attempt_id uuid,
  p_state text,
  p_authorization_url text DEFAULT NULL
)
RETURNS TABLE (attempt_id uuid, reference text, state text, authorization_url text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_attempt private.uba_redvault_payment_attempts%ROWTYPE;
DECLARE v_application private.uba_redvault_applications%ROWTYPE;
DECLARE v_scoped boolean;
BEGIN
  v_scoped := (SELECT auth.role()) = 'authenticated'
    AND auth.jwt()->>'storefront_order_context' = 'route';
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' AND NOT v_scoped THEN
    RAISE EXCEPTION 'forbidden: REDVAULT initialization recovery requires service_role';
  END IF;
  IF p_state NOT IN ('initialized', 'indeterminate', 'void') THEN
    RAISE EXCEPTION 'redvault_attempt_recovery_state_invalid';
  END IF;
  IF p_state = 'initialized' AND (p_authorization_url IS NULL OR p_authorization_url !~ '^https://[^[:space:]]+$') THEN
    RAISE EXCEPTION 'redvault_attempt_url_invalid';
  END IF;
  IF p_state <> 'initialized' AND p_authorization_url IS NOT NULL THEN
    RAISE EXCEPTION 'redvault_attempt_url_invalid';
  END IF;
  SELECT * INTO v_attempt FROM private.uba_redvault_payment_attempts
  WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND OR v_attempt.state NOT IN ('initializing', 'indeterminate') THEN
    RAISE EXCEPTION 'redvault_attempt_not_recoverable';
  END IF;
  IF v_scoped THEN
    SELECT * INTO v_application FROM private.uba_redvault_applications
    WHERE id = v_attempt.application_id FOR SHARE;
    IF NOT FOUND OR v_application.status <> 'pending'
      OR v_application.merchant_id::text IS DISTINCT FROM auth.jwt()->>'storefront_order_merchant_id'
      OR v_application.customer_email IS DISTINCT FROM auth.jwt()->>'storefront_redvault_customer_email'
      OR v_application.user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'redvault_customer_context_required';
    END IF;
  END IF;
  UPDATE private.uba_redvault_payment_attempts
  SET state = p_state,
      authorization_url = CASE WHEN p_state = 'initialized' THEN p_authorization_url ELSE NULL END,
      initialized_at = CASE WHEN p_state = 'initialized' THEN pg_catalog.now() ELSE initialized_at END
  WHERE id = p_attempt_id
  RETURNING * INTO v_attempt;
  RETURN QUERY SELECT v_attempt.id, v_attempt.reference, v_attempt.state, v_attempt.authorization_url;
END;
$$;
ALTER FUNCTION public.reconcile_storefront_redvault_payment_attempt_initialization(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reconcile_storefront_redvault_payment_attempt_initialization(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_storefront_redvault_payment_attempt_initialization(uuid, text, text)
  TO authenticated, service_role;

-- The Paystack split must collect the GIGL retained-shipping amount, not
-- just record it in the settlement ledger afterwards. Freeze the order's
-- retained snapshot (kobo) on the attempt at claim time, under the order
-- payment lock, so initialization charges exactly what settlement books.
ALTER TABLE private.uba_redvault_payment_attempts
  ADD COLUMN IF NOT EXISTS split_retained_shipping_kobo bigint NOT NULL DEFAULT 0;

-- DROP + CREATE: the new frozen-retention output column changes the
-- return type, which CREATE OR REPLACE cannot do.
DROP FUNCTION IF EXISTS public.claim_storefront_redvault_payment_attempt_initialization_v2(uuid);
CREATE FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v2(p_attempt_id uuid)
RETURNS TABLE (
  attempt_id uuid,
  reference text,
  amount_kobo bigint,
  currency text,
  quote_payload_hash text,
  state text,
  bank_code text,
  authorization_url text,
  initialization_claimed boolean,
  paystack_subaccount_code text,
  platform_fee_kobo bigint,
  split_retained_shipping_kobo bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  application private.uba_redvault_applications%ROWTYPE;
  attempt private.uba_redvault_payment_attempts%ROWTYPE;
  attempt_order_id uuid;
  v_retained_kobo bigint;
BEGIN
  IF auth.jwt()->>'storefront_order_context' IS DISTINCT FROM 'route' THEN
    RAISE EXCEPTION 'redvault_route_context_required';
  END IF;
  SELECT order_id INTO attempt_order_id
  FROM private.uba_redvault_payment_attempts
  WHERE id = p_attempt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'redvault_attempt_not_found';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || attempt_order_id::text, 0)
  );
  SELECT * INTO attempt
  FROM private.uba_redvault_payment_attempts
  WHERE id = p_attempt_id
  FOR UPDATE;
  SELECT * INTO application
  FROM private.uba_redvault_applications
  WHERE id = attempt.application_id
  FOR SHARE;
  IF NOT FOUND
    OR application.status <> 'pending'
    OR application.merchant_id::text IS DISTINCT FROM auth.jwt()->>'storefront_order_merchant_id'
    OR application.customer_email IS DISTINCT FROM auth.jwt()->>'storefront_redvault_customer_email'
    OR application.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'redvault_customer_context_required';
  END IF;
  IF NOT private.redvault_attempt_filter_policy_valid(
    attempt.accepted_filter_policy,
    attempt.accepted_filter_policy_hash
  ) THEN
    RAISE EXCEPTION 'redvault_attempt_filter_policy_invalid';
  END IF;
  IF NULLIF(trim(attempt.paystack_subaccount_code), '') IS NULL
    OR attempt.platform_fee_kobo IS NULL
    OR attempt.platform_fee_kobo < 0
    OR attempt.platform_fee_kobo > attempt.amount_kobo THEN
    RAISE EXCEPTION 'redvault_paystack_split_missing';
  END IF;

  IF attempt.state = 'created' THEN
    SELECT COALESCE(round(GREATEST(COALESCE(o.shipping_platform_retained_amount, 0), 0) * 100), 0)::bigint
    INTO v_retained_kobo
    FROM public.orders o
    WHERE o.id = attempt.order_id
      AND o.shipping_funding_source = 'customer_checkout'
      AND pg_catalog.upper(pg_catalog.btrim(COALESCE(o.shipping_provider, ''))) = 'GIGL'
      AND o.shipping_pricing_version = 'gigl_platform_margin_v1';
    v_retained_kobo := COALESCE(v_retained_kobo, 0);
    -- Mirror the settlement retention clamp: the split charge can never
    -- exceed the margin left after the base platform fee.
    v_retained_kobo := LEAST(
      v_retained_kobo,
      GREATEST(attempt.amount_kobo - attempt.platform_fee_kobo, 0)
    );
    UPDATE private.uba_redvault_payment_attempts
    SET state = 'initializing',
      initialization_claimed_at = pg_catalog.statement_timestamp(),
      split_retained_shipping_kobo = v_retained_kobo
    WHERE id = attempt.id
    RETURNING * INTO attempt;
    RETURN QUERY SELECT
      attempt.id,
      attempt.reference,
      attempt.amount_kobo,
      attempt.currency,
      attempt.quote_payload_hash,
      attempt.state,
      attempt.accepted_filter_policy->>'bankCode',
      attempt.authorization_url,
      true,
      attempt.paystack_subaccount_code,
      attempt.platform_fee_kobo,
      attempt.split_retained_shipping_kobo;
    RETURN;
  END IF;

  -- A claim orphaned by a crash between claim and record (or a failed
  -- record call) would otherwise fence the order until abandoned-order
  -- cleanup: the row is no longer created, so every later claim returns
  -- false and the API reports reconciliation-required forever. Reclaim a
  -- stale initializing lease (2 minutes, mirroring the reconciliation
  -- lease) with a heartbeat under the row lock, so exactly one worker
  -- re-enters initialization. NULL claimed_at heals rows orphaned before
  -- this column existed.
  IF attempt.state = 'initializing'
    AND (attempt.initialization_claimed_at IS NULL
      OR attempt.initialization_claimed_at <= pg_catalog.statement_timestamp() - interval '2 minutes') THEN
    UPDATE private.uba_redvault_payment_attempts
    SET initialization_claimed_at = pg_catalog.statement_timestamp()
    WHERE id = attempt.id
    RETURNING * INTO attempt;
    RETURN QUERY SELECT
      attempt.id,
      attempt.reference,
      attempt.amount_kobo,
      attempt.currency,
      attempt.quote_payload_hash,
      attempt.state,
      attempt.accepted_filter_policy->>'bankCode',
      attempt.authorization_url,
      true,
      attempt.paystack_subaccount_code,
      attempt.platform_fee_kobo,
      attempt.split_retained_shipping_kobo;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    attempt.id,
    attempt.reference,
    attempt.amount_kobo,
    attempt.currency,
    attempt.quote_payload_hash,
    attempt.state,
    attempt.accepted_filter_policy->>'bankCode',
    attempt.authorization_url,
    false,
    attempt.paystack_subaccount_code,
    attempt.platform_fee_kobo,
    attempt.split_retained_shipping_kobo;
END;
$$;
ALTER FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v2(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v2(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v2(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.claim_storefront_redvault_payment_attempt_initialization_v3(uuid);
CREATE FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v3(
  p_attempt_id uuid
)
RETURNS TABLE (
  attempt_id uuid,
  reference text,
  amount_kobo bigint,
  currency text,
  quote_payload_hash text,
  state text,
  bank_code text,
  authorization_url text,
  initialization_claimed boolean,
  paystack_subaccount_code text,
  platform_fee_kobo bigint,
  split_retained_shipping_kobo bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_receipt record;
BEGIN
  SELECT * INTO STRICT v_receipt
  FROM public.claim_storefront_redvault_payment_attempt_initialization_v2(
    p_attempt_id
  );
  PERFORM private.ensure_redvault_attempt_transaction_v2(v_receipt.attempt_id);

  RETURN QUERY SELECT
    v_receipt.attempt_id,
    v_receipt.reference,
    v_receipt.amount_kobo,
    v_receipt.currency,
    v_receipt.quote_payload_hash,
    v_receipt.state,
    v_receipt.bank_code,
    v_receipt.authorization_url,
    v_receipt.initialization_claimed,
    v_receipt.paystack_subaccount_code,
    v_receipt.platform_fee_kobo,
    v_receipt.split_retained_shipping_kobo;
END;
$$;
ALTER FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v3(uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v3(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v3(uuid)
  TO authenticated;
