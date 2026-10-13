-- Round-13 review fixes: cancel blocks live initialized attempts; refund
-- reconciliation reports the provider-submission timestamp instead of the
-- reservation time; REDVAULT GIGL orders settle through a wallet-free
-- direct-split variant that keeps shipping retention; the scoped capture
-- path preserves validated provider fees like the 926 wrapper did.
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
  -- rejects the cancelled order. Treat initialized as active until the
  -- authorization can no longer succeed.
  IF EXISTS (SELECT 1 FROM private.uba_redvault_payment_attempts AS attempt
             WHERE attempt.order_id = p_order_id
               AND attempt.state IN ('initialized', 'captured_held', 'capture_evidence_review', 'approved')) THEN
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

-- A refund's created_at is the operator-reservation time, not the moment
-- the worker submitted it to Paystack. Capture-reference recovery compares
-- provider records against submitted_at, so stamp the pending -> processing
-- transition and report that instead.
ALTER TABLE private.uba_redvault_refunds
  ADD COLUMN IF NOT EXISTS submitted_to_provider_at timestamptz;

CREATE OR REPLACE FUNCTION public.claim_next_uba_redvault_refund()
RETURNS TABLE (
  id uuid, amount_kobo bigint, state text, attempt_reference text,
  provider_reference text, provider_status text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN QUERY
  WITH candidate AS (
    SELECT refund.id FROM private.uba_redvault_refunds refund
    WHERE refund.state = 'pending'
    ORDER BY refund.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  ), claimed AS (
    UPDATE private.uba_redvault_refunds refund
    SET state = 'processing',
      submitted_to_provider_at = pg_catalog.statement_timestamp(),
      updated_at = pg_catalog.now()
    FROM candidate WHERE refund.id = candidate.id
    RETURNING refund.*
  )
  SELECT refund.id, refund.amount_kobo, refund.state, attempt.reference,
    refund.provider_reference, refund.provider_status
  FROM claimed refund
  JOIN private.uba_redvault_payment_attempts attempt ON attempt.id = refund.attempt_id;
END;
$$;
ALTER FUNCTION public.claim_next_uba_redvault_refund() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_next_uba_redvault_refund() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_uba_redvault_refund() TO service_role;

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
    COALESCE(refund.submitted_to_provider_at, refund.created_at),
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

-- REDVAULT split sales with GIGL shipping need both properties at once:
-- the wallet-free direct-split recording (the merchant share already went
-- to the Paystack subaccount) and the GIGL retained-shipping accounting.
-- This variant mirrors record_merchant_settlement_gigl_v1's retention
-- computation exactly, then delegates to the direct RPC instead of the
-- wallet-crediting settlement primitive.
CREATE OR REPLACE FUNCTION public.record_uba_redvault_direct_settlement_gigl_v1(
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_snapshot numeric(12,2) := 0;
  v_already_retained numeric(12,2) := 0;
  v_internal_credit numeric(12,2) := 0;
  v_remaining numeric(12,2) := 0;
  v_retained numeric(12,2) := 0;
  v_metadata jsonb;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: record_uba_redvault_direct_settlement_gigl_v1 requires service_role';
  END IF;
  IF p_source_type = 'order' THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('merchant-shipping-order:' || p_source_id::text, 0)
    );

    SELECT CASE
      WHEN o.shipping_funding_source = 'customer_checkout'
       AND pg_catalog.upper(pg_catalog.btrim(COALESCE(o.shipping_provider, ''))) = 'GIGL'
       AND o.shipping_pricing_version = 'gigl_platform_margin_v1'
      THEN GREATEST(COALESCE(o.shipping_platform_retained_amount, 0), 0)
      ELSE 0
    END
      INTO v_snapshot
      FROM public.orders o
     WHERE o.id = p_source_id
       AND o.merchant_id = p_merchant_id;

    SELECT COALESCE(SUM(
      GREATEST(
        COALESCE((settlement.metadata ->> 'retained_shipping_amount')::numeric, 0),
        0
      )
    ), 0)
      INTO v_already_retained
      FROM public.merchant_settlements AS settlement
     WHERE settlement.source_type = 'order'
       AND settlement.source_id = p_source_id
       AND settlement.merchant_id = p_merchant_id
       AND settlement.status IS DISTINCT FROM 'cancelled';

    IF v_snapshot > 0 THEN
      SELECT GREATEST(
        COALESCE((
          SELECT SUM(GREATEST(COALESCE(t.amount, 0), 0))
          FROM public.transactions AS t
          WHERE t.merchant_id = p_merchant_id
            AND t.order_id = p_source_id
            AND t.status = 'completed'
            AND lower(btrim(COALESCE(t.gateway, ''))) = ANY (
              ARRAY['wallet', 'savings', 'store_credit']::text[]
            )
        ), 0),
        COALESCE((
          SELECT SUM(GREATEST(COALESCE(w.amount, 0), 0))
          FROM public.customer_wallet_transactions AS w
          WHERE w.merchant_id = p_merchant_id
            AND w.source_type = 'order_redemption'
            AND w.source_id = p_source_id
            AND w.status = 'completed'
        ), 0)
        + COALESCE((
          SELECT SUM(GREATEST(COALESCE(s.amount, 0), 0))
          FROM public.customer_savings_redemptions AS s
          WHERE s.merchant_id = p_merchant_id
            AND s.order_id = p_source_id
            AND s.metadata->>'reversed_at' IS NULL
        ), 0)
      )
        INTO v_internal_credit;
      v_already_retained := v_already_retained
        + LEAST(
          GREATEST(v_snapshot - v_already_retained, 0),
          GREATEST(COALESCE(v_internal_credit, 0), 0)
        );
    END IF;
  END IF;

  v_remaining := GREATEST(v_snapshot - v_already_retained, 0);
  v_retained := LEAST(
    v_remaining,
    GREATEST(
      COALESCE(p_gross_amount, 0) - COALESCE(p_gateway_fee, 0)
        - COALESCE(p_platform_fee, 0),
      0
    )
  );
  v_metadata := COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
    'retained_shipping_amount', v_retained
  );
  RETURN public.record_uba_redvault_direct_settlement(
    p_merchant_id, p_source_type, p_source_id, p_gateway,
    p_gateway_reference, p_gross_amount, p_gateway_fee,
    p_platform_fee + v_retained, p_description, v_metadata
  );
END;
$$;
ALTER FUNCTION public.record_uba_redvault_direct_settlement_gigl_v1(
  uuid, text, uuid, text, text, numeric, numeric, numeric, text, jsonb
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_uba_redvault_direct_settlement_gigl_v1(
  uuid, text, uuid, text, text, numeric, numeric, numeric, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_uba_redvault_direct_settlement_gigl_v1(
  uuid, text, uuid, text, text, numeric, numeric, numeric, text, jsonb
) TO service_role;

-- The scoped-capture replacement dropped the 926 wrapper's fee handling:
-- capture_or_hold_uba_redvault_payment_legacy_926 is orphaned and the live
-- path never copies validated provider fees into
-- transactions.gateway_response, so approval stores a canonical response
-- without fees and the side-effect drain prices the Paystack fee at zero.
-- Restore the validated fee persistence on the live scoped path.
CREATE OR REPLACE FUNCTION public.capture_or_hold_uba_redvault_payment(
  p_transaction_id uuid, p_order_id uuid, p_gateway text, p_reference text, p_gateway_response jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_attempt private.uba_redvault_payment_attempts%ROWTYPE;
  v_claims jsonb := COALESCE((SELECT auth.jwt()), '{}'::jsonb);
  v_transaction_order_id uuid;
  v_result jsonb;
  v_existing_fees jsonb;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role'
    AND NOT ((SELECT auth.role()) = 'authenticated'
      AND v_claims->>'storefront_order_context' = 'route'
      AND v_claims->>'storefront_order_merchant_id' = '6b5cb8a4-5575-456c-b936-8cdfae30db74') THEN RAISE EXCEPTION 'forbidden: capture_or_hold_uba_redvault_payment requires service_role or scoped route context'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0));
  SELECT transaction.order_id INTO v_transaction_order_id
  FROM public.transactions AS transaction WHERE transaction.id = p_transaction_id FOR UPDATE;
  IF NOT FOUND OR v_transaction_order_id IS DISTINCT FROM p_order_id THEN
    RETURN public.capture_or_hold_uba_redvault_payment_legacy_915(p_transaction_id, p_order_id, p_gateway, p_reference, p_gateway_response);
  END IF;
  PERFORM 1 FROM public.orders WHERE id = p_order_id;
  SELECT attempt.* INTO v_attempt
  FROM private.uba_redvault_payment_attempts AS attempt
  JOIN public.transactions AS transaction ON transaction.order_id = attempt.order_id AND transaction.gateway_reference = attempt.reference
  WHERE attempt.order_id = p_order_id AND transaction.id = p_transaction_id
  FOR UPDATE OF attempt;
  IF NOT FOUND THEN RAISE EXCEPTION 'redvault_capture_attempt_not_found'; END IF;
  IF v_attempt.state = 'approved' THEN
    IF p_gateway IS DISTINCT FROM 'paystack' OR p_reference IS DISTINCT FROM v_attempt.reference
      OR p_gateway_response->>'reference' IS DISTINCT FROM v_attempt.provider_response->>'capture_reference'
      OR p_gateway_response->>'amount' IS DISTINCT FROM v_attempt.provider_response->>'capture_amount_kobo'
      OR upper(p_gateway_response->>'currency') IS DISTINCT FROM v_attempt.provider_response->>'capture_currency'
      OR lower(p_gateway_response->>'status') IS DISTINCT FROM v_attempt.provider_response->>'capture_status' THEN
      RAISE EXCEPTION 'redvault_capture_evidence_conflict';
    END IF;
    RETURN jsonb_build_object('duplicate', true, 'kind', 'captured_held', 'reason', 'provider_eligibility_evidence_unavailable');
  END IF;
  v_result := public.capture_or_hold_uba_redvault_payment_legacy_915(p_transaction_id, p_order_id, p_gateway, p_reference, p_gateway_response);
  IF v_result->>'kind' = 'captured_held' AND p_gateway_response ? 'fees' THEN
    IF jsonb_typeof(p_gateway_response->'fees') IS DISTINCT FROM 'number'
      OR (p_gateway_response->>'fees') !~ '^(0|[1-9][0-9]*)$'
      OR (p_gateway_response->>'fees')::numeric > (p_gateway_response->>'amount')::numeric THEN
      RAISE EXCEPTION 'redvault_capture_fee_invalid';
    END IF;
    SELECT gateway_response->'fees' INTO v_existing_fees FROM public.transactions WHERE id = p_transaction_id AND order_id = p_order_id;
    IF v_existing_fees IS NOT NULL AND v_existing_fees IS DISTINCT FROM p_gateway_response->'fees' THEN
      RAISE EXCEPTION 'redvault_capture_fee_conflict';
    END IF;
    UPDATE public.transactions SET gateway_response = COALESCE(gateway_response, '{}'::jsonb) || jsonb_build_object('fees', p_gateway_response->'fees')
    WHERE id = p_transaction_id AND order_id = p_order_id;
  END IF;
  RETURN v_result;
END;
$$;
ALTER FUNCTION public.capture_or_hold_uba_redvault_payment(uuid, uuid, text, text, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.capture_or_hold_uba_redvault_payment(uuid, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.capture_or_hold_uba_redvault_payment(uuid, uuid, text, text, jsonb) TO service_role, authenticated;
COMMENT ON FUNCTION public.capture_or_hold_uba_redvault_payment(uuid, uuid, text, text, jsonb) IS
  'REDVAULT capture receipt for service_role or the merchant-bound scoped route client. It validates the trusted transaction and frozen quote, records captured_held evidence, and never approves or settles the order.';
