-- Round-21 review fixes: the shipment-booking claim atomically verifies
-- the order is not refunded while acquiring the booking lock (same
-- advisory-lock + row-lock order refund finalization uses), and a
-- post-submit confirm refuses the local persist when a full refund
-- finalized after the provider submission, filing a durable ops review so
-- the provider booking can be intercepted.
ALTER TABLE public.reconciliation_review
  DROP CONSTRAINT IF EXISTS reconciliation_review_issue_type_check;

ALTER TABLE public.reconciliation_review
  ADD CONSTRAINT reconciliation_review_issue_type_check CHECK (issue_type IN (
    'payment_match_ambiguous',
    'payment_match_zero_candidates',
    'manage_stock_cancellation_held',
    'tax_basis_unclassified',
    'tax_basis_inconsistent_total',
    'wallet_dva_order_alias_conflict',
    'wallet_dva_order_payment_replay',
    'customer_savings_auto_debit_allocation_failed',
    'wallet_order_funding_ambiguous',
    'wallet_order_funding_conflict',
    'wallet_order_funding_finalize_failed',
    'payment_received_after_cancellation',
    'payment_received_after_refund',
    'serialized_inventory_confirmation_failed',
    'merchant_settlement_failed',
    'gateway_payment_wedge_requires_review',
    'credit_direct_confirmation_missing',
    'order_cancellation_refund_requires_review',
    'paypal_capture_persist_failed',
    'merchant_invoice_partial_payment_conflict',
    'merchant_wallet_assignment_review',
    'gigl_wallet_shipping_charge_ambiguous',
    'shipment_booked_after_full_refund'
  )) NOT VALID;

ALTER TABLE public.reconciliation_review
  VALIDATE CONSTRAINT reconciliation_review_issue_type_check;

-- The booking lock is the serialization point refund finalization
-- respects: claiming now asserts the order is not refunded inside the
-- same lock boundary that holds the booking token, so a refund that
-- commits before the claim always blocks the booking instead of racing
-- a stale order read.
CREATE OR REPLACE FUNCTION public.claim_order_shipment_booking(
  p_order_id uuid,
  p_merchant_id uuid,
  p_lock_token uuid,
  p_lock_timeout_seconds integer DEFAULT 900
)
RETURNS TABLE(
  claimed boolean,
  shipment_id uuid,
  tracking_number text,
  shipping_status text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_payment_status text;
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT public.has_merchant_access(p_merchant_id) THEN
    RAISE EXCEPTION 'forbidden_claim_order_shipment_booking'
      USING ERRCODE = '42501';
  END IF;

  IF p_order_id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0)
    );
  END IF;
  SELECT o.payment_status INTO v_payment_status
  FROM public.orders AS o
  WHERE o.id = p_order_id
    AND o.merchant_id = p_merchant_id
  FOR UPDATE;
  IF FOUND AND lower(btrim(COALESCE(v_payment_status, ''))) = 'refunded' THEN
    RAISE EXCEPTION 'order_refunded_for_shipment';
  END IF;

  UPDATE public.orders AS target
  SET shipment_booking_lock_token = p_lock_token,
      shipment_booking_started_at = pg_catalog.now()
  WHERE target.id = p_order_id
    AND target.merchant_id = p_merchant_id
    AND target.shipment_id IS NULL
    AND target.tracking_number IS NULL
    AND (
      target.shipment_booking_lock_token IS NULL
      OR target.shipment_booking_started_at IS NULL
      OR target.shipment_booking_started_at <
        pg_catalog.now() - pg_catalog.make_interval(
          secs => greatest(coalesce(p_lock_timeout_seconds, 900), 900)
        )
    );

  IF FOUND THEN
    RETURN QUERY
    SELECT true, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT false, target.shipment_id, target.tracking_number,
    target.shipping_status
  FROM public.orders AS target
  WHERE target.id = p_order_id
    AND target.merchant_id = p_merchant_id;
END;
$function$;

-- Post-submit guard: re-checks the payment state under the same
-- serialization boundary immediately before the local persist. A full
-- refund that finalized after the provider submission leaves a live
-- provider booking against refunded money, so the persist is refused and
-- a durable ops review (carrying the provider booking identity) is filed
-- for interception. A pre-submit check alone cannot cover this window:
-- its transaction ends before the external provider call. The refunded
-- outcome is a returned receipt, not a raise: raising after filing would
-- roll the review back when the caller catches the error.
CREATE OR REPLACE FUNCTION public.confirm_shippable_order_payment_for_booking_persist(
  p_order_id uuid,
  p_merchant_id uuid,
  p_provider text,
  p_provider_shipment_id text,
  p_tracking_number text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_duplicate boolean := false;
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT public.has_merchant_access(p_merchant_id) THEN
    RAISE EXCEPTION 'forbidden_confirm_shippable_order_payment'
      USING ERRCODE = '42501';
  END IF;
  IF p_order_id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0)
    );
  END IF;
  SELECT * INTO v_order
  FROM public.orders AS o
  WHERE o.id = p_order_id
    AND o.merchant_id = p_merchant_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found_for_shipment';
  END IF;
  IF lower(btrim(COALESCE(v_order.payment_status, ''))) <> 'refunded' THEN
    RETURN jsonb_build_object('persist_allowed', true, 'duplicate', false);
  END IF;
  BEGIN
    INSERT INTO public.reconciliation_review
      (issue_type, merchant_id, order_id, reason, metadata)
    VALUES
      ('shipment_booked_after_full_refund', v_order.merchant_id, v_order.id,
       'Shipment booked with provider after the order was fully refunded',
       jsonb_build_object(
         'provider', p_provider,
         'provider_shipment_id', p_provider_shipment_id,
         'tracking_number', p_tracking_number,
         'payment_status', v_order.payment_status
       ));
  EXCEPTION WHEN unique_violation THEN
    v_duplicate := true;
  END;
  RETURN jsonb_build_object('persist_allowed', false, 'duplicate', v_duplicate);
END;
$function$;
ALTER FUNCTION public.confirm_shippable_order_payment_for_booking_persist(uuid, uuid, text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.confirm_shippable_order_payment_for_booking_persist(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_shippable_order_payment_for_booking_persist(uuid, uuid, text, text, text) TO service_role, authenticated;

-- Idempotency replay disposition: the draft reports whether the
-- checkout key replayed an existing draft, and the atomic wrapper
-- passes it through so the route can mark replays like the
-- ordinary order path instead of emitting duplicate order_created
-- analytics. Return-shape changes require drop+create; grants below
-- restore the exact role boundaries the grant tests pin.
DROP FUNCTION IF EXISTS public.create_storefront_redvault_order_draft(jsonb, jsonb);
CREATE FUNCTION public.create_storefront_redvault_order_draft(p_order jsonb, p_quote jsonb)
RETURNS TABLE (id uuid, quote_version_id uuid, quote_payload_hash text, proof_context jsonb, idempotency_replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_existing private.uba_redvault_applications%ROWTYPE;
  v_customer_email text := lower(trim(p_order->>'customer_email'));
  v_key text := NULLIF(p_order->>'checkout_idempotency_key', '');
  v_request_hash text := private.transaction_discount_payload_hash(p_order);
  v_terms jsonb;
  v_merchant_id uuid := NULLIF(p_order ->> 'merchant_id', '')::uuid;
  v_code_id uuid;
  v_order_id uuid;
  v_quote_version_id uuid := extensions.gen_random_uuid();
  v_hash text := private.transaction_discount_payload_hash(p_quote);
  v_application_id uuid;
  v_discount_kobo bigint;
  v_eligible_subtotal_kobo bigint;
  v_proof_groups jsonb;
BEGIN
  IF COALESCE(auth.jwt() ->> 'storefront_order_context', '') <> 'route'
    OR (auth.jwt() ->> 'storefront_order_merchant_id') IS DISTINCT FROM v_merchant_id::text THEN
    RAISE EXCEPTION 'redvault_route_context_required';
  END IF;
  IF NULLIF(lower(trim(p_order ->> 'customer_email')), '') IS NULL
    OR auth.jwt()->>'storefront_redvault_customer_email' IS DISTINCT FROM v_customer_email
    OR COALESCE(NULLIF(p_order ->> 'user_id', ''), 'guest') IS DISTINCT FROM COALESCE(auth.uid()::text, 'guest') THEN
    RAISE EXCEPTION 'redvault_customer_context_required';
  END IF;
  IF v_merchant_id IS DISTINCT FROM '6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid THEN RAISE EXCEPTION 'redvault_merchant_forbidden'; END IF;
  IF v_key IS NULL OR length(v_key) > 200 THEN RAISE EXCEPTION 'redvault_idempotency_key_required'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_merchant_id::text || v_customer_email || v_key, 0));
  SELECT * INTO v_existing FROM private.uba_redvault_applications AS application
    WHERE application.merchant_id = v_merchant_id AND application.customer_email = v_customer_email AND application.checkout_key = v_key;
  IF FOUND THEN
    IF v_existing.user_id IS DISTINCT FROM auth.uid() OR v_existing.request_hash IS DISTINCT FROM v_request_hash OR v_existing.quote_payload_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'checkout_idempotency_conflict';
    END IF;
    IF v_existing.status NOT IN ('draft', 'pending') THEN RAISE EXCEPTION 'order_not_reusable'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.orders AS existing_order WHERE existing_order.id = v_existing.order_id AND existing_order.merchant_id = v_merchant_id AND lower(trim(existing_order.customer_email)) = v_customer_email AND payment_method = 'uba_redvault' AND payment_status = 'unpaid') THEN RAISE EXCEPTION 'order_not_reusable'; END IF;
    RETURN QUERY SELECT v_existing.order_id, v_existing.quote_version_id, v_existing.quote_payload_hash, v_existing.proof_context, true;
    RETURN;
  END IF;
  SELECT commercial_terms INTO v_terms FROM private.uba_redvault_runtime WHERE partnership = 'uba_redvault';
  IF NOT EXISTS (SELECT 1 FROM private.uba_redvault_runtime WHERE partnership = 'uba_redvault' AND enabled) THEN RAISE EXCEPTION 'redvault_disabled'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.uba_redvault_runtime WHERE partnership = 'uba_redvault' AND commercial_terms_confirmed) THEN RAISE EXCEPTION 'redvault_commercial_terms_missing'; END IF;
  IF jsonb_typeof(v_terms) IS DISTINCT FROM 'object' OR NOT (v_terms ?& ARRAY['campaign_dates','minimum_spend','caps','usage_limits','stacking','split_payments','funding_fees','refund_usage_restoration','operations_owner'])
    OR EXISTS (SELECT 1 FROM jsonb_each(v_terms) WHERE value = 'null'::jsonb OR value = '""'::jsonb) THEN RAISE EXCEPTION 'redvault_commercial_terms_missing'; END IF;
  SELECT discount_code_id INTO v_code_id FROM private.uba_redvault_discount_binding
    WHERE merchant_id = v_merchant_id AND partnership = 'uba_redvault';
  IF v_code_id IS NULL THEN RAISE EXCEPTION 'redvault_binding_missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.discount_codes WHERE discount_codes.id = v_code_id AND merchant_id = v_merchant_id AND discount_type = 'percentage' AND discount_value IN (5, 10) AND is_active IS TRUE) THEN RAISE EXCEPTION 'redvault_binding_invalid'; END IF;
  IF jsonb_typeof(p_quote -> 'lines') IS DISTINCT FROM 'array' OR jsonb_typeof(p_quote -> 'groups') IS DISTINCT FROM 'array'
    OR COALESCE(p_quote ->> 'discountKobo', '') !~ '^[1-9][0-9]*$'
    OR COALESCE(p_quote ->> 'eligibleSubtotalKobo', '') !~ '^[1-9][0-9]*$'
    OR COALESCE(p_quote ->> 'productSubtotalKobo', '') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'redvault_quote_invalid'; END IF;
  v_discount_kobo := (p_quote ->> 'discountKobo')::bigint;
  v_eligible_subtotal_kobo := (p_quote ->> 'eligibleSubtotalKobo')::bigint;
  PERFORM 1 FROM public.discount_codes WHERE discount_codes.id = v_code_id FOR SHARE;
  IF EXISTS (SELECT 1 FROM public.discount_codes WHERE discount_codes.id = v_code_id AND (
    starts_at > now() OR expires_at <= now() OR COALESCE(minimum_purchase_amount,0) <> 0
    OR maximum_discount_amount < v_discount_kobo::numeric / 100 OR applies_to <> 'all'
    OR COALESCE(product_ids,'[]'::jsonb) <> '[]'::jsonb OR COALESCE(category_ids,'[]'::jsonb) <> '[]'::jsonb
  )) THEN RAISE EXCEPTION 'redvault_commercial_configuration_unsupported'; END IF;
  IF COALESCE((p_order ->> 'discount_amount')::numeric, -1) <> v_discount_kobo::numeric / 100 THEN RAISE EXCEPTION 'redvault_discount_mismatch'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_quote -> 'lines')) <> (SELECT count(*) FROM jsonb_array_elements(COALESCE(p_order -> 'items', '[]'::jsonb))) THEN RAISE EXCEPTION 'redvault_line_count_mismatch'; END IF;
  IF jsonb_array_length(p_quote->'lines') > 10000 OR (SELECT sum((value->>'quantity')::numeric) FROM jsonb_array_elements(p_quote->'lines')) > 10000 THEN RAISE EXCEPTION 'redvault_allocation_limit'; END IF;
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current());
  SELECT created.id INTO v_order_id FROM public.create_storefront_order(
    p_merchant_id => v_merchant_id, p_customer_email => p_order ->> 'customer_email', p_customer_name => p_order ->> 'customer_name', p_items => COALESCE(p_order -> 'items', '[]'::jsonb), p_customer_phone => NULLIF(p_order ->> 'customer_phone', ''),
    p_shipping_fee => COALESCE((p_order ->> 'shipping_fee')::numeric, 0), p_discount_amount => v_discount_kobo::numeric / 100, p_tax_amount => COALESCE((p_order ->> 'tax_amount')::numeric, 0), p_payment_method => 'uba_redvault', p_payment_status => 'unpaid', p_shipping_status => 'pending',
    p_shipping_address => p_order -> 'shipping_address', p_source => COALESCE(NULLIF(p_order ->> 'source', ''), 'online_store'), p_notes => NULLIF(p_order ->> 'notes', ''), p_ad_tracking => p_order -> 'ad_tracking', p_selected_quote_id => NULLIF(p_order ->> 'selected_quote_id', '')::uuid,
    p_shipping_provider => NULLIF(p_order ->> 'shipping_provider', ''), p_tracking_number => NULLIF(p_order ->> 'tracking_number', ''), p_user_id => NULLIF(p_order ->> 'user_id', '')::uuid, p_tax_basis => 'exclusive', p_gift_wrapping_fee => COALESCE((p_order ->> 'gift_wrapping_fee')::numeric, 0),
    p_expected_total => NULLIF(p_order ->> 'expected_total', '')::numeric, p_checkout_idempotency_key => NULLIF(p_order ->> 'checkout_idempotency_key', ''), p_checkout_request_hash => NULLIF(p_order ->> 'checkout_request_hash', '')
  ) AS created;
  IF v_order_id IS NULL THEN RAISE EXCEPTION 'redvault_order_creation_failed'; END IF;
  v_proof_groups := private.validate_redvault_snapshot(v_order_id, p_quote);
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE orders.id = v_order_id AND orders.merchant_id = v_merchant_id AND lower(trim(customer_email)) = v_customer_email AND payment_status = 'unpaid' AND payment_method = 'uba_redvault' AND discount_amount * 100 = v_discount_kobo) THEN RAISE EXCEPTION 'redvault_order_snapshot_mismatch'; END IF;
  INSERT INTO private.uba_redvault_applications AS application (order_id, discount_code_id, merchant_id, quote_version_id, quote_payload_hash, quote_payload, discount_kobo, eligible_subtotal_kobo, pricing_policy_version, status, customer_email, user_id, checkout_key, request_hash)
  VALUES (v_order_id, v_code_id, v_merchant_id, v_quote_version_id, v_hash, p_quote, v_discount_kobo, v_eligible_subtotal_kobo, 'mou_tiered_v1', 'draft', v_customer_email, auth.uid(), v_key, v_request_hash) RETURNING application.id INTO v_application_id;
  INSERT INTO private.uba_redvault_line_allocations (application_id, order_item_id, line_id, unit_ordinal, allocation_kobo, product_id, variant_id, condition, variant_attributes, unit_price_kobo, vat_category_code, vat_rate_bp, tax_basis)
  SELECT v_application_id, oi.id, (line.value ->> 'lineId')::integer, unit.value_ordinal, unit.value::bigint, oi.product_id, oi.variant_id, oi.condition, COALESCE(oi.variant_attributes, '{}'::jsonb), round(oi.price * 100)::bigint, oi.vat_category_code, round(COALESCE(oi.vat_rate, 0) * 100)::integer, 'exclusive'
  FROM jsonb_array_elements(p_quote -> 'lines') AS line(value)
  JOIN public.order_items oi ON oi.order_id = v_order_id AND oi.line_id = (line.value ->> 'lineId')::integer
  JOIN LATERAL jsonb_array_elements_text(line.value -> 'unitDiscountsKobo') WITH ORDINALITY AS unit(value, value_ordinal) ON true;
  UPDATE private.uba_redvault_applications SET proof_context =
    jsonb_build_object('applicationId', v_application_id, 'discountKobo', v_discount_kobo, 'eligibleSubtotalKobo', v_eligible_subtotal_kobo,
      'productSubtotalKobo', (p_quote ->> 'productSubtotalKobo')::bigint, 'groups', v_proof_groups, 'taxBasis', 'exclusive') WHERE order_id = v_order_id;
  DELETE FROM private.uba_redvault_write_context WHERE transaction_id = pg_catalog.txid_current();
  RETURN QUERY SELECT v_order_id, v_quote_version_id, v_hash,
    jsonb_build_object('applicationId', v_application_id, 'discountKobo', v_discount_kobo, 'eligibleSubtotalKobo', v_eligible_subtotal_kobo,
      'productSubtotalKobo', (p_quote ->> 'productSubtotalKobo')::bigint, 'groups', v_proof_groups, 'taxBasis', 'exclusive'), false;
END;
$$;
ALTER FUNCTION public.create_storefront_redvault_order_draft(jsonb, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_storefront_redvault_order_draft(jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.create_storefront_redvault_order(jsonb, jsonb, jsonb);
CREATE FUNCTION public.create_storefront_redvault_order(
  p_order jsonb, p_quote jsonb, p_route_proof jsonb
) RETURNS TABLE (id uuid, quote_version_id uuid, quote_payload_hash text, proof_context jsonb, status text, idempotency_replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_draft record;
  v_payload jsonb;
  v_proof jsonb;
  v_secret text;
  v_issued text := pg_catalog.now()::text;
  v_hash text;
  v_signature text;
  v_status text;
  v_merchant text := p_order->>'merchant_id';
  v_user text := COALESCE(auth.uid()::text, 'guest');
  v_fulfillment jsonb := p_order->'merchant_fulfillment';
  v_rate_id uuid;
BEGIN
  IF auth.jwt()->>'storefront_order_context' IS DISTINCT FROM 'route'
    OR auth.jwt()->>'storefront_order_merchant_id' IS DISTINCT FROM v_merchant THEN
    RAISE EXCEPTION 'redvault_route_context_required';
  END IF;
  IF p_route_proof->'payload' IS DISTINCT FROM jsonb_build_object('order', p_order, 'quote', p_quote)
    OR p_route_proof->>'payload_hash' IS DISTINCT FROM private.transaction_discount_payload_hash(p_route_proof->'payload')
    OR p_route_proof->>'user_id' IS DISTINCT FROM v_user
    OR p_route_proof->>'proof_id' IS DISTINCT FROM left(p_route_proof->>'signature', 24)
    OR public.quiz_route_proof_valid(p_route_proof, 'storefront_redvault_order_create', v_merchant, auth.uid()) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'redvault_proof_rejected';
  END IF;

  SELECT * INTO STRICT v_draft FROM public.create_storefront_redvault_order_draft(p_order, p_quote);
  SELECT application.status INTO STRICT v_status FROM private.uba_redvault_applications AS application
    WHERE application.order_id = v_draft.id FOR UPDATE;
  IF v_status = 'pending' THEN
    RETURN QUERY SELECT v_draft.id, v_draft.quote_version_id, v_draft.quote_payload_hash, v_draft.proof_context, v_status, v_draft.idempotency_replayed;
    RETURN;
  END IF;

  IF v_fulfillment IS NOT NULL THEN
    IF jsonb_typeof(v_fulfillment) IS DISTINCT FROM 'object'
      OR (v_fulfillment->>'provider' IN ('MERCHANT', 'MERCHANT_PICKUP')) IS NOT TRUE
      OR NULLIF(trim(v_fulfillment->>'rate_name'), '') IS NULL
      OR NULLIF(v_fulfillment->>'rate_id', '') IS NULL THEN
      RAISE EXCEPTION 'redvault_fulfillment_invalid';
    END IF;
    SELECT rate.id INTO v_rate_id FROM public.merchant_shipping_rates AS rate
      WHERE rate.id = (v_fulfillment->>'rate_id')::uuid AND rate.merchant_id = v_merchant::uuid FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'redvault_fulfillment_rate_not_found'; END IF;
    INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current()) ON CONFLICT DO NOTHING;
    UPDATE public.orders SET
      shipping_provider = v_fulfillment->>'provider',
      shipping_rate_id = v_rate_id,
      shipping_rate_name = v_fulfillment->>'rate_name',
      shipping_pickup_details = CASE WHEN v_fulfillment->>'provider' = 'MERCHANT_PICKUP'
        THEN NULLIF(v_fulfillment->'pickup_details', 'null'::jsonb) ELSE NULL END
      WHERE orders.id = v_draft.id AND orders.merchant_id = v_merchant::uuid;
    DELETE FROM private.uba_redvault_write_context WHERE transaction_id = pg_catalog.txid_current();
  END IF;

  v_secret := NULLIF(current_setting('app.quiz_rpc_server_secret_current', true), '');
  IF v_secret IS NULL THEN
    SELECT secret INTO v_secret FROM private.quiz_rpc_server_secrets
      WHERE secret_name = 'current' AND (expires_at IS NULL OR expires_at > pg_catalog.now());
  END IF;
  IF NULLIF(v_secret, '') IS NULL THEN RAISE EXCEPTION 'redvault_proof_signing_unavailable'; END IF;
  v_payload := (v_draft.proof_context - 'applicationId') || jsonb_build_object(
    'version', 1, 'partnership', 'uba_redvault', 'merchantId', v_merchant,
    'customerEmail', lower(trim(p_order->>'customer_email')), 'orderId', v_draft.id,
    'quoteVersionId', v_draft.quote_version_id, 'quotePayloadHash', v_draft.quote_payload_hash,
    'nonce', extensions.gen_random_uuid());
  v_hash := private.transaction_discount_payload_hash(v_payload);
  v_signature := pg_catalog.encode(extensions.hmac(
    'quiz-rpc-proof:v1' || E'\nquiz_phase1a\nstorefront_redvault_discount\n' || v_merchant || E'\n' || v_user || E'\n' || v_issued || E'\n' || v_hash,
    v_secret, 'sha256'), 'hex');
  v_proof := jsonb_build_object('version', 'quiz-rpc-proof:v1', 'scope', 'quiz_phase1a',
    'action', 'storefront_redvault_discount', 'subject_id', v_merchant, 'user_id', v_user,
    'issued_at', v_issued, 'payload', v_payload, 'payload_hash', v_hash,
    'signature', v_signature, 'proof_id', left(v_signature, 24));
  SELECT attached.status INTO STRICT v_status FROM public.attach_storefront_redvault_discount_proof(
    v_draft.id, v_draft.quote_version_id, v_draft.quote_payload_hash, v_proof) AS attached;
  IF v_status IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'redvault_attachment_not_pending'; END IF;
  RETURN QUERY SELECT v_draft.id, v_draft.quote_version_id, v_draft.quote_payload_hash, v_draft.proof_context, v_status, v_draft.idempotency_replayed;
END;
$$;
ALTER FUNCTION public.create_storefront_redvault_order(jsonb, jsonb, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_storefront_redvault_order(jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_storefront_redvault_order(jsonb, jsonb, jsonb) TO authenticated;
