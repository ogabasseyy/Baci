-- Round-10 review fixes for the REDVAULT subsystem (OR REPLACE only; no base
-- files touched).
--
-- P1 (held-capture cleanup): the generic stale-draft batch UPDATE also
-- cancels drafts whose attempt already captured the shopper's money (or
-- which carry an active/processed refund), releasing fenced units the
-- capture path owns and stranding the order where approval rejects
-- cancelled rows. The worker transition in reject_unscoped_redvault_order
-- now reverts such cancels to a no-op (same exclusions the dedicated
-- cancel RPC enforces), so the batch keeps the draft payable without
-- aborting sibling rows.
--
-- P1 (proportional pre-settlement reduction): a partial refund processed
-- before the settlement row existed subtracted the gross refund from the
-- incoming net, unlike the post-settlement reversal which reduces the
-- proportional net share. The trigger now computes the same cumulative
-- proportional target off the original net and persists the original /
-- reversed / processed-refund ID bookkeeping the reversal path compounds
-- from, so later refunds reduce the remainder instead of the reduced net.
--
-- P1 (provider record correlation): claim_next_uba_redvault_refund_reconciliation
-- now also returns the local submission time and the sibling provider
-- references for the attempt, so the capture-reference lookup can require a
-- unique new provider record before applying a terminal result.
CREATE OR REPLACE FUNCTION private.reject_unscoped_redvault_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
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
    UPDATE public.merchant_wallets
    SET upcoming_balance = upcoming_balance - v_reduction,
        updated_at = pg_catalog.now()
    WHERE merchant_id = NEW.merchant_id;
    IF NOT FOUND THEN
      RETURN NEW;
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

-- The reconciliation claim also returns the local submission time and the
-- sibling provider references for the attempt, so the capture-reference
-- lookup can require a unique new provider record before applying a
-- terminal result instead of finalizing off a stale sibling match.
DROP FUNCTION IF EXISTS public.claim_next_uba_redvault_refund_reconciliation();
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

-- reconcile accepts the matched provider reference (capture-reference
-- lookups discover it) so later sibling recoveries exclude already-persisted
-- provider IDs instead of finalizing twice off one provider record.
DROP FUNCTION IF EXISTS public.reconcile_uba_redvault_refund(uuid, uuid, text);
CREATE OR REPLACE FUNCTION public.reconcile_uba_redvault_refund(
  p_refund_id uuid,
  p_reconciliation_claim_token uuid,
  p_provider_status text,
  p_provider_reference text DEFAULT NULL
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
  -- A nonterminal lookup on a reference-less indeterminate refund keeps the
  -- row in needs_reconciliation (lease cleared below) so the next worker run
  -- can claim it again. Moving it to processing would strand it: the claim
  -- predicate only selects processing rows carrying a provider reference.
  IF v_refund.state = 'needs_reconciliation' AND v_refund.provider_reference IS NULL
    AND p_provider_status NOT IN ('processed', 'failed') THEN
    v_outcome := 'needs_reconciliation';
  ELSE
    v_outcome := CASE WHEN p_provider_status = 'pending' THEN 'processing' ELSE p_provider_status END;
  END IF;
  UPDATE private.uba_redvault_refunds AS target SET state = v_outcome,
    provider_reference = COALESCE(p_provider_reference, target.provider_reference),
    provider_status = p_provider_status,
    failure_code = CASE WHEN p_provider_status = 'failed' THEN 'provider_rejected' ELSE failure_code END,
    processed_at = CASE WHEN p_provider_status = 'processed' THEN pg_catalog.now() ELSE processed_at END,
    reconciliation_claim_token = NULL, reconciliation_claimed_at = NULL, updated_at = pg_catalog.now()
  WHERE target.id = p_refund_id RETURNING * INTO v_refund;
  IF p_provider_status = 'failed' THEN
    UPDATE private.uba_redvault_refund_line_allocations SET released_at = pg_catalog.now()
    WHERE refund_id = p_refund_id AND released_at IS NULL;
  END IF;
  RETURN QUERY SELECT v_refund.id, v_refund.amount_kobo, v_refund.state, attempt.reference,
    v_refund.provider_reference, v_refund.provider_status
  FROM private.uba_redvault_payment_attempts attempt WHERE attempt.id = v_refund.attempt_id;
END;
$$;
ALTER FUNCTION public.reconcile_uba_redvault_refund(uuid, uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reconcile_uba_redvault_refund(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_uba_redvault_refund(uuid, uuid, text, text) TO service_role;
