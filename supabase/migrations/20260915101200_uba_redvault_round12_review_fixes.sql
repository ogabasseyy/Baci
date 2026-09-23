-- Round-12 review fixes for the REDVAULT subsystem (OR REPLACE only; no base
-- files touched).
--
-- P1 (evidence-review exclusion): capture_evidence_review means Paystack may
-- already hold the shopper's money pending operator review, but the three
-- cancellation predicates (worker skip, abandoned-draft RPC, customer RPC)
-- only excluded captured_held/approved. Cancelling released the fence and
-- blocked later approval. The state now joins every funds-in-flight list.
--
-- P1 (initialization lease): the init claim flipped created->initializing in
-- its own transaction, so a crash before record fenced the order until
-- abandoned cleanup (every later claim returned false). Stale initializing
-- leases are now reclaimable with a heartbeat under the row lock.
--
-- P1 (orphaned submission claims): a crash between refund claim and any
-- store write left processing rows with no provider reference, claimable by
-- neither worker. Stale reference-less rows now enter reconciliation, whose
-- capture-reference lookup correlates any landed record before finalizing.
--
-- P1 (direct-split settlement): Paystack-split sales pay the merchant share
-- to the subaccount, but the settlement side effect additionally credited
-- the Baci wallet. Split sales now record an informational settled row with
-- no wallet movement, and reversals adjust only the recorded net there.
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
  -- stale unpaid draft whose attempt already captured, held for evidence review, or approved the
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
                AND attempt.state IN ('captured_held', 'capture_evidence_review', 'approved'))
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
               AND attempt.state IN ('captured_held', 'capture_evidence_review', 'approved')) THEN
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
  v_released := private.release_uba_redvault_abandoned_units(p_order_id);
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

-- Authenticated customer cancellation for REDVAULT orders. Mirrors
-- cancel_order_as_customer (ownership, reason cap, idempotent no-op,
-- instrument voiding) but runs under the protected write path the guard
-- requires and marks payment_status cancelled so the abandoned-units
-- release trigger frees the fenced reservation. Funds-in-flight orders
-- (held/review/approved capture, live refund) are rejected like the
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
               AND attempt.state IN ('captured_held', 'capture_evidence_review', 'approved')) THEN
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

ALTER TABLE private.uba_redvault_payment_attempts
  ADD COLUMN IF NOT EXISTS initialization_claimed_at timestamptz;

CREATE OR REPLACE FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v2(p_attempt_id uuid)
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
  platform_fee_kobo bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  application private.uba_redvault_applications%ROWTYPE;
  attempt private.uba_redvault_payment_attempts%ROWTYPE;
  attempt_order_id uuid;
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
    UPDATE private.uba_redvault_payment_attempts
    SET state = 'initializing',
      initialization_claimed_at = pg_catalog.statement_timestamp()
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
      attempt.platform_fee_kobo;
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
      attempt.platform_fee_kobo;
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
    attempt.platform_fee_kobo;
END;
$$;
ALTER FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v2(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v2(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v2(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_next_uba_redvault_refund_reconciliation()
RETURNS TABLE (
  id uuid, amount_kobo bigint, state text, attempt_reference text,
  provider_reference text, provider_status text, reconciliation_claim_token uuid,
  submitted_at timestamptz, sibling_provider_references text[]
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN QUERY
  WITH candidate AS (
    SELECT refund.id FROM private.uba_redvault_refunds refund
    WHERE (refund.state = 'processing' AND refund.provider_reference IS NOT NULL
      OR refund.state = 'needs_reconciliation'
      -- A submission claim orphaned by a crash (processing, no provider
      -- reference) is claimable by neither the submission worker (pending
      -- only) nor reconciliation (reference required). Lease it into the
      -- reconciliation lookup, which correlates any landed provider record
      -- before finalizing instead of resubmitting blindly.
      OR (refund.state = 'processing' AND refund.provider_reference IS NULL
        AND refund.updated_at <= pg_catalog.statement_timestamp() - interval '2 minutes'))
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
    refund.provider_reference, refund.provider_status, refund.reconciliation_claim_token,
    refund.created_at,
    (SELECT COALESCE(array_agg(sibling.provider_reference), '{}'::text[])
     FROM private.uba_redvault_refunds AS sibling
     WHERE sibling.attempt_id = refund.attempt_id
       AND sibling.id <> refund.id
       AND sibling.provider_reference IS NOT NULL)
  FROM claimed refund
  JOIN private.uba_redvault_payment_attempts attempt ON attempt.id = refund.attempt_id;
END;
$$;
ALTER FUNCTION public.claim_next_uba_redvault_refund_reconciliation() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_next_uba_redvault_refund_reconciliation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_uba_redvault_refund_reconciliation() TO service_role;

-- REDVAULT split sales pay the merchant share straight to the merchant's
-- Paystack subaccount (transaction_charge to Baci, bearer account), so the
-- standard settlement primitive would double-pay by additionally crediting
-- the Baci wallet. This informational variant records the same row (status
-- settled, so the due-settlement cron, which only promotes pending rows,
-- never moves it into available balance) without any wallet movement, and
-- flags the row so refund reversals adjust only the recorded net. The
-- order-method guard fails closed against misrouted (non-split) calls.
CREATE OR REPLACE FUNCTION public.record_uba_redvault_direct_settlement(
  p_merchant_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_gateway text,
  p_gateway_reference text,
  p_gross_amount numeric,
  p_gateway_fee numeric,
  p_platform_fee numeric,
  p_description text,
  p_metadata jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_wallet_id uuid;
  v_net_amount numeric;
  v_expected_date date;
  v_settlement_id uuid;
  v_method text;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: record_uba_redvault_direct_settlement requires service_role';
  END IF;
  IF p_source_type = 'order' THEN
    SELECT o.payment_method INTO v_method FROM public.orders AS o WHERE o.id = p_source_id;
    IF v_method IS DISTINCT FROM 'uba_redvault' THEN
      RAISE EXCEPTION 'redvault_direct_settlement_order_mismatch';
    END IF;
  END IF;

  v_wallet_id := public.get_or_create_merchant_wallet(p_merchant_id);
  v_net_amount := p_gross_amount - p_gateway_fee - p_platform_fee;
  v_expected_date := public.calculate_settlement_date(p_gateway);

  INSERT INTO public.merchant_settlements (
    merchant_id, wallet_id, source_type, source_id, gateway,
    gateway_reference, gross_amount, gateway_fee, platform_fee, net_amount,
    payment_date, expected_settlement_date, description, status, metadata,
    settlement_notified
  ) VALUES (
    p_merchant_id, v_wallet_id, p_source_type, p_source_id, p_gateway,
    p_gateway_reference, p_gross_amount, p_gateway_fee, p_platform_fee,
    v_net_amount, pg_catalog.now(), v_expected_date,
    COALESCE(p_description, 'Payment received'),
    'settled',
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('redvault_direct_split', true),
    true
  )
  ON CONFLICT (source_type, source_id, gateway_reference)
    WHERE gateway_reference IS NOT NULL AND status != 'cancelled'
    DO NOTHING
  RETURNING id INTO v_settlement_id;

  RETURN v_settlement_id;
END;
$$;
ALTER FUNCTION public.record_uba_redvault_direct_settlement(uuid, text, uuid, text, text, numeric, numeric, numeric, text, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_uba_redvault_direct_settlement(uuid, text, uuid, text, text, numeric, numeric, numeric, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_uba_redvault_direct_settlement(uuid, text, uuid, text, text, numeric, numeric, numeric, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION private.prevent_uba_redvault_refunded_settlement()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_attempt private.uba_redvault_payment_attempts%ROWTYPE;
  v_processed_kobo bigint := 0;
  v_processed_ids jsonb := '[]'::jsonb;
  v_original_net numeric;
  v_target_net numeric;
  v_reduction numeric := 0;
BEGIN
  IF NEW.source_type IS DISTINCT FROM 'order'
    OR NEW.gateway IS DISTINCT FROM 'paystack'
    OR NULLIF(trim(NEW.gateway_reference), '') IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_attempt
  FROM private.uba_redvault_payment_attempts AS attempt
  WHERE attempt.order_id = NEW.source_id
    AND attempt.merchant_id = NEW.merchant_id
    AND attempt.reference = NEW.gateway_reference;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || v_attempt.order_id::text, 0)
  );
  SELECT COALESCE(sum(refund.amount_kobo), 0),
    COALESCE(jsonb_agg(refund.id::text), '[]'::jsonb)
  INTO v_processed_kobo, v_processed_ids
  FROM private.uba_redvault_refunds AS refund
  WHERE refund.attempt_id = v_attempt.id AND refund.state = 'processed';
  IF v_processed_kobo >= v_attempt.amount_kobo THEN
    RETURN NULL;
  END IF;
  IF v_processed_kobo > 0 AND NEW.net_amount IS NOT NULL
    AND v_attempt.amount_kobo IS NOT NULL AND v_attempt.amount_kobo > 0 THEN
    -- A partial refund processed before this settlement row existed: reduce
    -- the incoming net by the same cumulative proportional target the
    -- post-settlement reversal compounds from (net share of the refunded
    -- fraction), and pre-debit the wallet delta the settlement RPC credits
    -- right after this trigger, so the merchant is neither overcredited
    -- (gross subtraction with fees present) nor undercredited, and a later
    -- refund reverses the remainder off the persisted original/reversed
    -- bookkeeping instead of the already-reduced net. The duplicate-row
    -- guard keeps retried inserts (which the RPC skips via ON CONFLICT DO
    -- NOTHING) from debiting twice; the order payment lock above serializes
    -- concurrent inserts against refund finalization.
    IF EXISTS (SELECT 1 FROM public.merchant_settlements AS existing
               WHERE existing.source_type = NEW.source_type
                 AND existing.source_id = NEW.source_id
                 AND existing.gateway_reference IS NOT DISTINCT FROM NEW.gateway_reference
                 AND existing.status <> 'cancelled') THEN
      RETURN NEW;
    END IF;
    v_original_net := NEW.net_amount;
    v_target_net := LEAST(v_original_net,
      round(v_original_net * v_processed_kobo / v_attempt.amount_kobo, 2));
    v_reduction := greatest(0, v_target_net);
    IF NEW.net_amount - v_reduction <= 0 THEN
      RETURN NULL;
    END IF;
    -- Direct-split sales never credited the wallet (the merchant share
    -- settled to the Paystack subaccount), so a pre-existing refund reduces
    -- only the recorded net, never a wallet balance.
    IF COALESCE((NEW.metadata ->> 'redvault_direct_split')::boolean, false) IS NOT TRUE THEN
          UPDATE public.merchant_wallets
          SET upcoming_balance = upcoming_balance - v_reduction,
              updated_at = pg_catalog.now()
          WHERE merchant_id = NEW.merchant_id;
          IF NOT FOUND THEN
            RETURN NEW;
          END IF;
    END IF;
    NEW.net_amount := NEW.net_amount - v_reduction;
    NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb)
      || jsonb_build_object(
        'redvault_original_net_amount', v_original_net,
        'redvault_reversed_net_amount', v_reduction,
        'redvault_processed_refund_ids', v_processed_ids,
        'redvault_partial_refund_reduction_kobo', v_processed_kobo);
  END IF;

  RETURN NEW;
END;
$$;
ALTER FUNCTION private.prevent_uba_redvault_refunded_settlement() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.prevent_uba_redvault_refunded_settlement()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.reverse_uba_redvault_partial_settlement(
  p_attempt_id uuid,
  p_refund_id uuid,
  p_refunded_kobo bigint
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_attempt private.uba_redvault_payment_attempts%ROWTYPE;
  v_settlement public.merchant_settlements%ROWTYPE;
  v_original_net numeric;
  v_reversed_net numeric;
  v_target_net numeric;
  v_delta numeric;
  v_balance numeric;
  v_processed_ids jsonb;
BEGIN
  SELECT * INTO STRICT v_attempt
  FROM private.uba_redvault_payment_attempts
  WHERE id = p_attempt_id;

  FOR v_settlement IN
    SELECT settlement.*
    FROM public.merchant_settlements AS settlement
    WHERE settlement.merchant_id = v_attempt.merchant_id
      AND settlement.source_type = 'order'
      AND settlement.source_id = v_attempt.order_id
      AND settlement.gateway = 'paystack'
      AND settlement.gateway_reference = v_attempt.reference
      AND settlement.status IN ('pending', 'processing', 'settled')
    FOR UPDATE
  LOOP
    v_processed_ids := COALESCE(
      v_settlement.metadata -> 'redvault_processed_refund_ids',
      '[]'::jsonb
    );
    IF v_processed_ids ? p_refund_id::text THEN
      CONTINUE;
    END IF;

    v_original_net := COALESCE(
      NULLIF(v_settlement.metadata ->> 'redvault_original_net_amount', '')::numeric,
      v_settlement.net_amount
    );
    v_reversed_net := COALESCE(
      NULLIF(v_settlement.metadata ->> 'redvault_reversed_net_amount', '')::numeric,
      0
    );
    v_target_net := LEAST(
      v_original_net,
      round(v_original_net * p_refunded_kobo / v_attempt.amount_kobo, 2)
    );
    v_delta := greatest(0, v_target_net - v_reversed_net);

    IF v_delta > 0 THEN
      IF COALESCE((v_settlement.metadata ->> 'redvault_direct_split')::boolean, false) THEN
        -- Direct-split informational row: track the reduced net below
        -- without moving wallet balances that were never credited.
        NULL;
      ELSIF v_settlement.status IN ('pending', 'processing') THEN
        UPDATE public.merchant_wallets
        SET upcoming_balance = upcoming_balance - v_delta,
            updated_at = pg_catalog.now()
        WHERE id = v_settlement.wallet_id;
      ELSE
        UPDATE public.merchant_wallets
        SET available_balance = available_balance - v_delta,
            total_earned = total_earned - v_delta,
            updated_at = pg_catalog.now()
        WHERE id = v_settlement.wallet_id
        RETURNING available_balance INTO v_balance;

        IF v_balance IS NULL THEN
          RAISE EXCEPTION 'redvault_settlement_wallet_missing';
        END IF;

        INSERT INTO public.wallet_transactions (
          wallet_id, merchant_id, type, amount, balance_after,
          source_type, source_id, description, status, metadata
        ) VALUES (
          v_settlement.wallet_id, v_settlement.merchant_id, 'debit',
          v_delta, v_balance, 'refund', p_refund_id,
          'UBA REDVAULT partial capture refund settlement reversal', 'completed',
          jsonb_build_object(
            'settlement_id', v_settlement.id,
            'attempt_id', p_attempt_id,
            'refund_id', p_refund_id,
            'partial', true
          )
        );
      END IF;

      UPDATE public.merchant_settlements
      SET net_amount = net_amount - v_delta,
          metadata = metadata
            || jsonb_build_object(
              'redvault_original_net_amount', v_original_net,
              'redvault_reversed_net_amount', v_reversed_net + v_delta
            )
            || jsonb_build_object(
              'redvault_processed_refund_ids', v_processed_ids || to_jsonb(p_refund_id::text)
            ),
          updated_at = pg_catalog.now()
      WHERE id = v_settlement.id;
    ELSE
      UPDATE public.merchant_settlements
      SET metadata = metadata
        || jsonb_build_object(
          'redvault_original_net_amount', v_original_net,
          'redvault_reversed_net_amount', v_reversed_net,
          'redvault_processed_refund_ids', v_processed_ids || to_jsonb(p_refund_id::text)
        ),
        updated_at = pg_catalog.now()
      WHERE id = v_settlement.id;
    END IF;
  END LOOP;
END;
$$;
ALTER FUNCTION private.reverse_uba_redvault_partial_settlement(uuid, uuid, bigint) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.reverse_uba_redvault_partial_settlement(uuid, uuid, bigint) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.reverse_uba_redvault_merchant_settlement(
  p_attempt_id uuid,
  p_refund_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_attempt private.uba_redvault_payment_attempts%ROWTYPE;
  v_settlement public.merchant_settlements%ROWTYPE;
  v_balance numeric;
BEGIN
  SELECT * INTO STRICT v_attempt
  FROM private.uba_redvault_payment_attempts
  WHERE id = p_attempt_id;

  FOR v_settlement IN
    SELECT settlement.*
    FROM public.merchant_settlements AS settlement
    WHERE settlement.merchant_id = v_attempt.merchant_id
      AND settlement.source_type = 'order'
      AND settlement.source_id = v_attempt.order_id
      AND settlement.gateway = 'paystack'
      AND settlement.gateway_reference = v_attempt.reference
      AND settlement.status IN ('pending', 'processing', 'settled')
    FOR UPDATE
  LOOP
    IF COALESCE((v_settlement.metadata ->> 'redvault_direct_split')::boolean, false) THEN
      -- Direct-split informational row: cancel the row below without
      -- moving wallet balances that were never credited.
      NULL;
    ELSIF v_settlement.status IN ('pending', 'processing') THEN
      UPDATE public.merchant_wallets
      SET upcoming_balance = upcoming_balance - v_settlement.net_amount,
          upcoming_count = greatest(0, upcoming_count - 1),
          updated_at = pg_catalog.now()
      WHERE id = v_settlement.wallet_id;
    ELSE
      UPDATE public.merchant_wallets
      SET available_balance = available_balance - v_settlement.net_amount,
          total_earned = total_earned - v_settlement.net_amount,
          updated_at = pg_catalog.now()
      WHERE id = v_settlement.wallet_id
      RETURNING available_balance INTO v_balance;

      IF v_balance IS NULL THEN
        RAISE EXCEPTION 'redvault_settlement_wallet_missing';
      END IF;

      INSERT INTO public.wallet_transactions (
        wallet_id, merchant_id, type, amount, balance_after,
        source_type, source_id, description, status, metadata
      ) VALUES (
        v_settlement.wallet_id, v_settlement.merchant_id, 'refund',
        v_settlement.net_amount, v_balance, 'refund', p_refund_id,
        'UBA REDVAULT capture refund settlement reversal', 'completed',
        jsonb_build_object('settlement_id', v_settlement.id, 'attempt_id', p_attempt_id)
      );
    END IF;

    UPDATE public.merchant_settlements
    SET status = 'cancelled', updated_at = pg_catalog.now()
    WHERE id = v_settlement.id;
  END LOOP;
END;
$$;
ALTER FUNCTION private.reverse_uba_redvault_merchant_settlement(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.reverse_uba_redvault_merchant_settlement(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

