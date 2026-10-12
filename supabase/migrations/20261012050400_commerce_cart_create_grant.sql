-- Shared cart: return the server-minted grant id on creation outcomes.
--
-- Task 5 HTTP routes must issue a session proof after a lazy guest-cart
-- create, and session proofs bind the grant minted inside the creation
-- transaction. The grant id cannot come from client input, so the create
-- RPC now returns it alongside the snapshot. Replays converge on the
-- original grant id; failures carry none.
--
-- This redefinition is behavior-identical to 20261012050200 except for
-- the added 'grantId' key on the two success results.

CREATE OR REPLACE FUNCTION public.commerce_cart_create(
  p_operation_id text, p_lines jsonb, p_currency text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_claims jsonb := auth.jwt();
  v_merchant uuid;
  v_principal text;
  v_digest text;
  v_existing public.commerce_cart_creation_requests%ROWTYPE;
  v_cart_id uuid;
  v_grant_id uuid;
  v_state jsonb;
  v_line jsonb;
  v_product_id uuid;
  v_variant_id uuid;
  v_condition text;
  v_options jsonb;
  v_quantity integer;
  v_voucher_token text;
  v_voucher_award text;
  v_negotiated integer;
  v_neg_status text;
  v_line_count integer;
BEGIN
  IF nullif(v_claims ->> 'cart_merchant_id', '') IS NULL
    OR (v_claims ->> 'cart_merchant_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    OR nullif(v_claims ->> 'cart_principal_id', '') IS NULL
    OR (v_claims ->> 'cart_scope') <> 'bootstrap'
    OR (v_claims ->> 'cart_id') IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unauthorized', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;
  v_merchant := (v_claims ->> 'cart_merchant_id')::uuid;
  v_principal := v_claims ->> 'cart_principal_id';

  IF p_operation_id IS NULL OR length(trim(p_operation_id)) = 0 OR length(p_operation_id) > 128 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;
  IF p_currency IS NULL OR p_currency !~ '^[A-Z]{3}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) > 20 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cc-create|' || v_merchant::text || '|' || v_principal || '|' || p_operation_id, 0)
  );

  v_digest := pg_catalog.md5(p_lines::text || '|' || p_currency);
  SELECT * INTO v_existing
  FROM public.commerce_cart_creation_requests
  WHERE merchant_id = v_merchant AND principal_id = v_principal AND operation_id = p_operation_id;
  IF FOUND THEN
    IF v_existing.request_digest <> v_digest THEN
      RETURN jsonb_build_object('ok', false, 'code', 'idempotency_conflict', 'replayed', false, 'state', null, 'currentVersion', null);
    END IF;
    IF v_existing.result IS NULL OR v_existing.cart_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'idempotency_conflict', 'replayed', false, 'state', null, 'currentVersion', null);
    END IF;
    SELECT public.commerce_cart_assemble_state(v_merchant, v_existing.cart_id) INTO v_state;
    IF v_state IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'expired', 'replayed', false, 'state', null, 'currentVersion', null);
    END IF;
    RETURN jsonb_build_object('ok', true, 'code', null, 'replayed', true, 'state', v_state,
      'currentVersion', (v_state ->> 'version')::integer, 'grantId', v_existing.grant_id);
  END IF;

  v_cart_id := pg_catalog.gen_random_uuid();
  INSERT INTO public.commerce_carts (id, merchant_id, currency, version, state, expires_at)
  VALUES (v_cart_id, v_merchant, p_currency, 1, 'active', now() + interval '7 days');

  v_grant_id := pg_catalog.gen_random_uuid();
  INSERT INTO public.commerce_cart_grants (id, merchant_id, cart_id, principal_id, principal_type, expires_at)
  VALUES (v_grant_id, v_merchant, v_cart_id, v_principal, 'guest', now() + interval '7 days');

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) value LOOP
    SELECT pi_product, pi_variant, pi_condition, pi_options, pi_quantity,
      pi_voucher_token, pi_voucher_award, pi_negotiated, pi_neg_status
    INTO v_product_id, v_variant_id, v_condition, v_options, v_quantity,
      v_voucher_token, v_voucher_award, v_negotiated, v_neg_status
    FROM public.commerce_cart_parse_input_line(v_line);
    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
    END IF;
    PERFORM public.commerce_cart_require_offer(v_merchant, v_product_id, v_variant_id);
    INSERT INTO public.commerce_cart_lines (
      merchant_id, cart_id, product_id, variant_id, condition, options, quantity,
      negotiated_unit_price_minor, negotiation_status, voucher_token, voucher_award_id,
      last_unit_price_minor
    ) VALUES (
      v_merchant, v_cart_id, v_product_id, v_variant_id, v_condition, v_options,
      CASE WHEN v_voucher_token IS NOT NULL OR v_voucher_award IS NOT NULL THEN 1 ELSE v_quantity END,
      v_negotiated, CASE WHEN v_negotiated IS NOT NULL AND v_neg_status IS NULL THEN 'accepted' ELSE v_neg_status END,
      v_voucher_token, CASE WHEN v_voucher_award IS NULL THEN NULL ELSE v_voucher_award::uuid END,
      public.commerce_cart_offer_price_minor(v_merchant, v_product_id, v_variant_id)
    );
  END LOOP;

  SELECT public.commerce_cart_assemble_state(v_merchant, v_cart_id) INTO v_state;
  INSERT INTO public.commerce_cart_creation_requests
    (merchant_id, principal_id, operation_id, request_digest, cart_id, grant_id, result, expires_at)
  VALUES (v_merchant, v_principal, p_operation_id, v_digest, v_cart_id, v_grant_id, v_state, now() + interval '7 days');

  RETURN jsonb_build_object('ok', true, 'code', null, 'replayed', false, 'state', v_state, 'currentVersion', 1, 'grantId', v_grant_id);
EXCEPTION
  WHEN raise_exception THEN
    IF SQLERRM = 'invalid_line' OR SQLERRM = 'invalid_offer' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'replayed', false, 'state', null, 'currentVersion', null);
    END IF;
    RAISE;
END;
$$;
