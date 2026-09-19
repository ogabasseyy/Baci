-- Round-9 review fixes for the REDVAULT subsystem (OR REPLACE only; no base
-- files touched).
--
-- P1 (indeterminate lookup): reconcile keeps a reference-less indeterminate
-- refund in needs_reconciliation on a nonterminal lookup (lease cleared), so
-- the next worker run re-claims it for the capture-reference lookup instead
-- of stranding it in processing where the claim predicate cannot see it.
--
-- P1 (approval block): the verified-approval refund guard now also blocks
-- needs_reconciliation, which may already have refunded externally.
--
-- P1 (partial settlement): a partial refund processed before the settlement
-- row exists now reduces the incoming settlement net (and pre-debits the
-- wallet delta the settlement RPC credits) so the merchant is not
-- overcredited; full refunds keep the existing suppression.
--
-- P1 (abandoned inventory): cancellation of a stale unpaid draft atomically
-- releases its fenced serial reservations through a shared helper used by
-- both the protected cancel RPC and the cleanup-batch trigger path.
CREATE OR REPLACE FUNCTION public.reconcile_uba_redvault_refund(
  p_refund_id uuid,
  p_reconciliation_claim_token uuid,
  p_provider_status text
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
  UPDATE private.uba_redvault_refunds SET state = v_outcome,
    provider_status = p_provider_status,
    failure_code = CASE WHEN p_provider_status = 'failed' THEN 'provider_rejected' ELSE failure_code END,
    processed_at = CASE WHEN p_provider_status = 'processed' THEN pg_catalog.now() ELSE processed_at END,
    reconciliation_claim_token = NULL, reconciliation_claimed_at = NULL, updated_at = pg_catalog.now()
  WHERE uba_redvault_refunds.id = p_refund_id RETURNING * INTO v_refund;
  IF p_provider_status = 'failed' THEN
    UPDATE private.uba_redvault_refund_line_allocations SET released_at = pg_catalog.now()
    WHERE refund_id = p_refund_id AND released_at IS NULL;
  END IF;
  RETURN QUERY SELECT v_refund.id, v_refund.amount_kobo, v_refund.state, attempt.reference,
    v_refund.provider_reference, v_refund.provider_status
  FROM private.uba_redvault_payment_attempts attempt WHERE attempt.id = v_refund.attempt_id;
END;
$$;
ALTER FUNCTION public.reconcile_uba_redvault_refund(uuid, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reconcile_uba_redvault_refund(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_uba_redvault_refund(uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.approve_and_complete_uba_redvault_payment(
  p_transaction_id uuid,
  p_order_id uuid,
  p_verified_evidence jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_application private.uba_redvault_applications%ROWTYPE;
  v_attempt private.uba_redvault_payment_attempts%ROWTYPE;
  v_claims jsonb := COALESCE((SELECT auth.jwt()), '{}'::jsonb);
  v_completion jsonb;
  v_evidence jsonb;
  v_fees jsonb;
  v_gateway_evidence jsonb;
  v_inventory jsonb;
  v_inventory_reclaimed_count integer;
  v_inventory_receipt jsonb;
  v_order public.orders%ROWTYPE;
  v_transaction public.transactions%ROWTYPE;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role'
    AND NOT ((SELECT auth.role()) = 'authenticated'
      AND v_claims->>'storefront_order_context' = 'route'
      AND v_claims->>'storefront_order_merchant_id' = '6b5cb8a4-5575-456c-b936-8cdfae30db74') THEN RAISE EXCEPTION 'forbidden: approve_and_complete_uba_redvault_payment requires service_role or scoped route context'; END IF;
  IF p_transaction_id IS NULL OR p_order_id IS NULL OR jsonb_typeof(p_verified_evidence) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'redvault_verified_completion_invalid_arguments'; END IF;
  IF NOT (p_verified_evidence ?& ARRAY['acceptedFilterPolicyHash','amountKobo','cardBrand','cardChannel','contractVersion','currency','customerEmail','domain','issuerName','providerVerificationId','reference','verificationSource','verifiedAt'])
    OR (SELECT count(*) FROM jsonb_object_keys(p_verified_evidence)) <> 13
    OR jsonb_typeof(p_verified_evidence->'acceptedFilterPolicyHash') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_verified_evidence->'amountKobo') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_verified_evidence->'cardBrand') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_verified_evidence->'cardChannel') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_verified_evidence->'contractVersion') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_verified_evidence->'currency') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_verified_evidence->'customerEmail') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_verified_evidence->'domain') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_verified_evidence->'issuerName') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_verified_evidence->'providerVerificationId') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_verified_evidence->'reference') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_verified_evidence->'verificationSource') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_verified_evidence->'verifiedAt') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'redvault_verified_evidence_invalid';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0));
  SELECT * INTO v_transaction FROM public.transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND OR v_transaction.order_id IS DISTINCT FROM p_order_id OR v_transaction.merchant_id IS DISTINCT FROM '6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid OR v_transaction.gateway IS DISTINCT FROM 'paystack' THEN RAISE EXCEPTION 'redvault_verified_completion_transaction_mismatch'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.payment_method IS DISTINCT FROM 'uba_redvault' OR v_order.merchant_id IS DISTINCT FROM v_transaction.merchant_id THEN RAISE EXCEPTION 'redvault_verified_completion_order_mismatch'; END IF;
  IF v_transaction.status NOT IN ('pending', 'completed') THEN RAISE EXCEPTION 'redvault_verified_completion_transaction_state_invalid'; END IF;
  IF v_order.payment_status IN ('cancelled', 'refunded') OR v_order.shipping_status = 'cancelled' OR v_order.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'redvault_verified_completion_order_state_invalid'; END IF;
  SELECT * INTO v_attempt FROM private.uba_redvault_payment_attempts WHERE order_id = p_order_id AND reference = v_transaction.gateway_reference FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'redvault_verified_completion_attempt_not_found'; END IF;
  SELECT * INTO v_application FROM private.uba_redvault_applications WHERE id = v_attempt.application_id FOR UPDATE;
  IF NOT FOUND OR v_application.order_id IS DISTINCT FROM p_order_id OR v_application.merchant_id IS DISTINCT FROM v_order.merchant_id OR v_application.customer_email IS DISTINCT FROM lower(trim(v_order.customer_email)) OR v_application.quote_payload_hash IS DISTINCT FROM v_attempt.quote_payload_hash THEN RAISE EXCEPTION 'redvault_verified_completion_application_mismatch'; END IF;
  IF NOT private.redvault_attempt_filter_policy_valid(v_attempt.accepted_filter_policy, v_attempt.accepted_filter_policy_hash) THEN RAISE EXCEPTION 'redvault_verified_completion_policy_missing'; END IF;
  IF p_verified_evidence->>'contractVersion' IS DISTINCT FROM 'paystack_verified_card_v1'
    OR p_verified_evidence->>'verificationSource' IS DISTINCT FROM 'paystack_transaction_verify'
    OR p_verified_evidence->>'reference' IS DISTINCT FROM v_attempt.reference
    OR p_verified_evidence->>'acceptedFilterPolicyHash' IS DISTINCT FROM v_attempt.accepted_filter_policy_hash
    OR p_verified_evidence->>'currency' IS DISTINCT FROM v_attempt.currency
    OR p_verified_evidence->>'cardChannel' IS DISTINCT FROM 'card'
    OR p_verified_evidence->>'cardBrand' NOT IN ('verve', 'visa', 'mastercard')
    OR p_verified_evidence->>'issuerName' IS DISTINCT FROM v_attempt.accepted_filter_policy->>'issuerName'
    OR p_verified_evidence->>'domain' IS DISTINCT FROM v_attempt.accepted_filter_policy->>'verificationDomain'
    OR lower(trim(p_verified_evidence->>'customerEmail')) IS DISTINCT FROM v_application.customer_email
    OR NULLIF(p_verified_evidence->>'providerVerificationId', '') IS NULL OR length(p_verified_evidence->>'providerVerificationId') > 200
    OR (p_verified_evidence->>'amountKobo') !~ '^[1-9][0-9]*$'
    OR (p_verified_evidence->>'amountKobo')::bigint IS DISTINCT FROM v_attempt.amount_kobo
    OR (p_verified_evidence->>'verifiedAt')::timestamptz IS NULL THEN RAISE EXCEPTION 'redvault_verified_evidence_invalid'; END IF;
  IF v_transaction.gateway_reference IS DISTINCT FROM v_attempt.reference OR round(v_transaction.amount * 100)::bigint IS DISTINCT FROM v_attempt.amount_kobo OR upper(v_transaction.currency) IS DISTINCT FROM v_attempt.currency OR round(v_order.total * 100)::bigint IS DISTINCT FROM v_attempt.amount_kobo OR v_attempt.provider_response->>'capture_reference' IS DISTINCT FROM v_attempt.reference OR (v_attempt.provider_response->>'capture_amount_kobo')::bigint IS DISTINCT FROM v_attempt.amount_kobo OR v_attempt.provider_response->>'capture_currency' IS DISTINCT FROM v_attempt.currency OR v_attempt.provider_response->>'capture_status' IS DISTINCT FROM 'success' THEN RAISE EXCEPTION 'redvault_verified_completion_capture_mismatch'; END IF;
  v_evidence := p_verified_evidence;
  IF v_attempt.state = 'approved' THEN
    v_inventory_receipt := v_attempt.provider_response->'inventory_completion_receipt';
    IF v_attempt.provider_response->'verified_evidence' IS DISTINCT FROM v_evidence OR v_application.status IS DISTINCT FROM 'approved' OR v_order.payment_status IS DISTINCT FROM 'paid' OR v_attempt.provider_response->'completion_receipt' IS NULL OR jsonb_typeof(v_inventory_receipt) IS DISTINCT FROM 'object' OR v_inventory_receipt->>'inventoryConfirmed' IS DISTINCT FROM 'true' OR jsonb_typeof(v_inventory_receipt->'inventoryReclaimedUnitCount') IS DISTINCT FROM 'number' OR NOT EXISTS (SELECT 1 FROM private.uba_redvault_redemptions WHERE attempt_id = v_attempt.id) THEN RAISE EXCEPTION 'redvault_verified_completion_replay_conflict'; END IF;
    RETURN jsonb_build_object('duplicate', true, 'kind', 'approved', 'completion', v_attempt.provider_response->'completion_receipt', 'inventoryConfirmed', true, 'inventoryReclaimedUnitCount', (v_inventory_receipt->>'inventoryReclaimedUnitCount')::integer);
  END IF;
  IF v_attempt.state IS DISTINCT FROM 'captured_held' OR v_order.payment_status IS DISTINCT FROM 'unpaid' OR v_application.status IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'redvault_verified_completion_not_held'; END IF;
  -- needs_reconciliation included: the provider may already have refunded
  -- externally while the local row awaits lookup, so approving the capture
  -- would mark the order paid and fulfillable twice.
  IF EXISTS (SELECT 1 FROM private.uba_redvault_refunds WHERE attempt_id = v_attempt.id AND state IN ('pending','processing','processed','needs_reconciliation')) THEN RAISE EXCEPTION 'redvault_verified_completion_refund_pending'; END IF;

  UPDATE private.uba_redvault_payment_attempts
  SET state = 'approved', provider_response = provider_response || jsonb_build_object('verified_evidence', v_evidence)
  WHERE id = v_attempt.id;
  UPDATE private.uba_redvault_applications SET status = 'approved' WHERE id = v_application.id;
  INSERT INTO private.uba_redvault_redemptions(application_id,attempt_id,discount_code_id,order_id,merchant_id,customer_email,amount_kobo,provider_verification_id,accepted_filter_policy_hash)
    VALUES (v_application.id,v_attempt.id,v_application.discount_code_id,v_order.id,v_order.merchant_id,v_application.customer_email,v_application.discount_kobo,p_verified_evidence->>'providerVerificationId',v_attempt.accepted_filter_policy_hash);
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current()) ON CONFLICT DO NOTHING;
  -- Persist the full canonical gateway evidence (reference, amount, currency,
  -- status, paid_at) instead of a paid_at-only object: later verifications
  -- treat any stored object as cached provider evidence, and capture rejects
  -- partial evidence. Preserve capture-persisted fees like the 926 wrapper did.
  SELECT gateway_response->'fees' INTO v_fees FROM public.transactions WHERE id = p_transaction_id;
  v_gateway_evidence := jsonb_build_object(
    'reference', v_attempt.reference,
    'amount', to_jsonb(v_attempt.amount_kobo),
    'currency', v_attempt.currency,
    'status', 'success',
    'paid_at', p_verified_evidence->>'verifiedAt'
  ) || CASE WHEN v_fees IS NOT NULL THEN jsonb_build_object('fees', v_fees) ELSE '{}'::jsonb END;
  -- Complete through the narrowly scoped REDVAULT primitive: the shared
  -- complete_order_gateway_payment RPC only accepts service_role callers, so a
  -- nested call from this scoped route context always rolls back. The
  -- primitive re-validates the REDVAULT completion invariants under lock and
  -- performs the same transaction/order/side-effect writes for this path.
  v_completion := private.complete_uba_redvault_verified_payment(
    p_transaction_id, p_order_id, v_gateway_evidence, 'uba_redvault_verified_completion');
  IF v_completion ? 'error_code' OR COALESCE((v_completion->>'order_updated')::boolean, false) IS NOT TRUE THEN RAISE EXCEPTION 'redvault_verified_completion_standard_completion_rejected'; END IF;
  v_inventory := public.confirm_order_inventory_reservations(v_order.merchant_id, p_order_id);
  IF jsonb_typeof(v_inventory) IS DISTINCT FROM 'object'
    OR jsonb_typeof(v_inventory->'reclaimedUnitCount') IS DISTINCT FROM 'number'
    OR jsonb_typeof(v_inventory->'exceptionCodes') IS DISTINCT FROM 'array'
    OR (v_inventory->>'reclaimedUnitCount') !~ '^(0|[1-9][0-9]*)$'
    OR length(v_inventory->>'reclaimedUnitCount') > 10
    OR (v_inventory->>'reclaimedUnitCount')::bigint > 2147483647
    OR jsonb_array_length(v_inventory->'exceptionCodes') <> 0 THEN RAISE EXCEPTION 'redvault_inventory_confirmation_unavailable'; END IF;
  v_inventory_reclaimed_count := (v_inventory->>'reclaimedUnitCount')::integer;

  UPDATE private.uba_redvault_payment_attempts
  SET provider_response = provider_response || jsonb_build_object(
    'completion_receipt', v_completion,
    'inventory_completion_receipt', jsonb_build_object('inventoryConfirmed', true, 'inventoryReclaimedUnitCount', v_inventory_reclaimed_count)
  ) WHERE id = v_attempt.id;
  DELETE FROM private.uba_redvault_write_context WHERE transaction_id = pg_catalog.txid_current();
  RETURN jsonb_build_object('duplicate', false, 'kind', 'approved', 'completion', v_completion, 'inventoryConfirmed', true, 'inventoryReclaimedUnitCount', v_inventory_reclaimed_count);
END;
$$;
ALTER FUNCTION public.approve_and_complete_uba_redvault_payment(uuid, uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.approve_and_complete_uba_redvault_payment(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_and_complete_uba_redvault_payment(uuid, uuid, jsonb) TO service_role, authenticated;

CREATE OR REPLACE FUNCTION private.prevent_uba_redvault_refunded_settlement()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_attempt private.uba_redvault_payment_attempts%ROWTYPE;
  v_processed_kobo bigint := 0;
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
  SELECT COALESCE(sum(refund.amount_kobo), 0) INTO v_processed_kobo
  FROM private.uba_redvault_refunds AS refund
  WHERE refund.attempt_id = v_attempt.id AND refund.state = 'processed';
  IF v_processed_kobo >= v_attempt.amount_kobo THEN
    RETURN NULL;
  END IF;
  IF v_processed_kobo > 0 AND NEW.net_amount IS NOT NULL THEN
    -- A partial refund processed before this settlement row existed: reduce
    -- the incoming net and pre-debit the wallet delta the settlement RPC
    -- credits right after this trigger, so the merchant is not overcredited.
    -- The duplicate-row guard keeps retried inserts (which the RPC skips via
    -- ON CONFLICT DO NOTHING) from debiting twice; the order payment lock
    -- above serializes concurrent inserts against refund finalization.
    IF EXISTS (SELECT 1 FROM public.merchant_settlements AS existing
               WHERE existing.source_type = NEW.source_type
                 AND existing.source_id = NEW.source_id
                 AND existing.gateway_reference IS NOT DISTINCT FROM NEW.gateway_reference
                 AND existing.status <> 'cancelled') THEN
      RETURN NEW;
    END IF;
    v_reduction := round(v_processed_kobo / 100.0, 2);
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
      || jsonb_build_object('redvault_partial_refund_reduction_kobo', v_processed_kobo);
  END IF;

  RETURN NEW;
END;
$$;
ALTER FUNCTION private.prevent_uba_redvault_refunded_settlement() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.prevent_uba_redvault_refunded_settlement() FROM PUBLIC, anon, authenticated, service_role;



-- Shared release of fenced serial reservations for a cancelled REDVAULT
-- draft. Used by cancel_abandoned_uba_redvault_draft and by the
-- abandoned-cleanup trigger below so the base cleanup batch releases units
-- atomically in the same statement. Idempotent: only reserved units move.
CREATE OR REPLACE FUNCTION private.release_uba_redvault_abandoned_units(p_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_merchant_id uuid;
  v_item public.order_items%ROWTYPE;
  v_unit record;
  v_units_json jsonb;
  v_released integer := 0;
BEGIN
  SELECT merchant_id INTO v_merchant_id FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'redvault_abandoned_draft_order_mismatch';
  END IF;
  FOR v_item IN SELECT * FROM public.order_items WHERE order_id = p_order_id FOR UPDATE LOOP
    FOR v_unit IN
      SELECT inventory.id, inventory.variant_id, inventory.branch_id, variant.product_id
      FROM public.variant_inventory AS inventory
      JOIN public.product_variants AS variant ON variant.id = inventory.variant_id
      WHERE inventory.order_id = p_order_id
        AND inventory.order_item_id = v_item.id
        AND inventory.status = 'reserved'
      ORDER BY inventory.id
      FOR UPDATE
    LOOP
      PERFORM private.record_variant_inventory_event(v_unit.id, v_merchant_id,
        v_unit.product_id, v_unit.variant_id, 'reservation_released', 'reserved',
        'available', p_order_id, v_item.id, v_unit.branch_id, NULL, NULL,
        jsonb_build_object('redvaultAbandonedCancel', true));
      UPDATE public.variant_inventory
      SET status = 'available', order_id = NULL, order_item_id = NULL,
        reserved_at = NULL, reservation_expires_at = NULL, updated_at = pg_catalog.now()
      WHERE id = v_unit.id;
      v_released := v_released + 1;
    END LOOP;
    SELECT jsonb_agg(jsonb_build_object('inventoryUnitId', inventory.id,
      'identifierType', inventory.identifier_type, 'identifierValue', inventory.identifier_value))
    INTO v_units_json FROM public.variant_inventory AS inventory WHERE inventory.order_item_id = v_item.id;
    UPDATE public.order_items
    SET fulfillment_data = jsonb_build_object('source', 'merchant_stock',
      'reservationExpiresAt', NULL,
      'inventoryUnits', COALESCE(v_units_json, '[]'::jsonb),
      'missingUnitCount', GREATEST(v_item.quantity - (SELECT count(*) FROM public.variant_inventory AS inventory
        WHERE inventory.order_item_id = v_item.id AND inventory.status = 'reserved'), 0),
      'fulfillmentQuantity', (SELECT count(*) FROM public.variant_inventory AS inventory
        WHERE inventory.order_item_id = v_item.id AND inventory.status = 'reserved'))
    WHERE id = v_item.id;
    PERFORM private.sync_serialized_stock(v_merchant_id, v_item.product_id);
  END LOOP;
  RETURN v_released;
END;
$$;
ALTER FUNCTION private.release_uba_redvault_abandoned_units(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.release_uba_redvault_abandoned_units(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.release_uba_redvault_abandoned_draft_inventory()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.release_uba_redvault_abandoned_units(NEW.id);
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.release_uba_redvault_abandoned_draft_inventory() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.release_uba_redvault_abandoned_draft_inventory()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS release_uba_redvault_abandoned_draft_inventory ON public.orders;
CREATE TRIGGER release_uba_redvault_abandoned_draft_inventory
  AFTER UPDATE OF payment_status ON public.orders
  FOR EACH ROW
  WHEN (OLD.payment_method = 'uba_redvault' AND OLD.payment_status = 'unpaid' AND NEW.payment_status = 'cancelled')
  EXECUTE FUNCTION private.release_uba_redvault_abandoned_draft_inventory();

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
               AND attempt.state IN ('captured_held', 'approved')) THEN
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
-- Round-9 cleanup-cascade carve-out: cancelling a stale draft fires
-- release_uba_redvault_abandoned_draft_inventory, which releases fenced
-- units, rewrites order_items fulfillment_data, and through the generic
-- update_order_tax_totals trigger rewrites the parent order's tax columns
-- in the same worker transaction. That cascade runs without write_context
-- (like the real worker) and trips the protected-path guard, aborting the
-- whole cleanup batch on the first stale REDVAULT draft with fenced units.
-- Permit exactly that cascade: a service_role write to a stale draft that
-- is (or stays) cancelled, touching only cancel/tax bookkeeping columns.
-- Tax figures on a cancelled unpaid draft are financially inert (settlement
-- recording skips cancelled orders), and the stale + cancelled +
-- column-allowlist shape admits nothing else.
CREATE OR REPLACE FUNCTION private.reject_unscoped_redvault_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
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
