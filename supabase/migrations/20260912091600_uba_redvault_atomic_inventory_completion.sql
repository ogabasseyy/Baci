CREATE OR REPLACE FUNCTION private.reject_redvault_item_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM private.uba_redvault_applications WHERE order_id IN (OLD.order_id, NEW.order_id)) THEN
    IF TG_OP = 'UPDATE'
      AND (to_jsonb(NEW) - 'fulfillment_data') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'fulfillment_data')
      AND EXISTS (SELECT 1 FROM private.uba_redvault_write_context WHERE transaction_id = pg_catalog.txid_current()) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'redvault_order_snapshot_immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
ALTER FUNCTION private.reject_redvault_item_mutation() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.reject_redvault_item_mutation() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.approve_and_complete_uba_redvault_payment(
  p_transaction_id uuid,
  p_order_id uuid,
  p_verified_evidence jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_application private.uba_redvault_applications%ROWTYPE;
  v_attempt private.uba_redvault_payment_attempts%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_transaction public.transactions%ROWTYPE;
  v_completion jsonb;
  v_evidence jsonb;
  v_inventory jsonb;
  v_inventory_reclaimed_count integer;
  v_inventory_receipt jsonb;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden: approve_and_complete_uba_redvault_payment requires service_role'; END IF;
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
  IF EXISTS (SELECT 1 FROM private.uba_redvault_refunds WHERE attempt_id = v_attempt.id AND state IN ('pending','processing','processed')) THEN RAISE EXCEPTION 'redvault_verified_completion_refund_pending'; END IF;

  UPDATE private.uba_redvault_payment_attempts
  SET state = 'approved', provider_response = provider_response || jsonb_build_object('verified_evidence', v_evidence)
  WHERE id = v_attempt.id;
  UPDATE private.uba_redvault_applications SET status = 'approved' WHERE id = v_application.id;
  INSERT INTO private.uba_redvault_redemptions(application_id,attempt_id,discount_code_id,order_id,merchant_id,customer_email,amount_kobo,provider_verification_id,accepted_filter_policy_hash)
    VALUES (v_application.id,v_attempt.id,v_application.discount_code_id,v_order.id,v_order.merchant_id,v_application.customer_email,v_application.discount_kobo,p_verified_evidence->>'providerVerificationId',v_attempt.accepted_filter_policy_hash);
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current()) ON CONFLICT DO NOTHING;
  v_completion := public.complete_order_gateway_payment(p_transaction_id, p_order_id, jsonb_build_object('paid_at', p_verified_evidence->>'verifiedAt'), 'uba_redvault_verified_completion');
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
GRANT EXECUTE ON FUNCTION public.approve_and_complete_uba_redvault_payment(uuid, uuid, jsonb) TO service_role;
