-- Review correction: bind final order items to the exact reviewed cart,
-- and reject expired carts before prepare/finalization. Prior migrations
-- remain unchanged. Existing EXECUTE grants survive function replacement.

CREATE OR REPLACE FUNCTION public.commerce_cart_prepare_checkout(
  p_cart_id uuid, p_expected_version integer, p_operation_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_claims jsonb := auth.jwt();
  v_merchant uuid;
  v_principal text;
  v_grant uuid;
  v_digest text;
  v_existing public.commerce_cart_operations%ROWTYPE;
  v_cart public.commerce_carts%ROWTYPE;
  v_grant_live boolean;
  v_grant_known boolean;
  v_session public.commerce_cart_checkout_sessions%ROWTYPE;
  v_gen integer;
  v_reused boolean := false;
  v_snapshot jsonb;
  v_result jsonb;
  v_new_version integer;
BEGIN
  IF nullif(v_claims ->> 'cart_merchant_id', '') IS NULL
    OR (v_claims ->> 'cart_merchant_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    OR nullif(v_claims ->> 'cart_principal_id', '') IS NULL
    OR (v_claims ->> 'cart_scope') <> 'session'
    OR nullif(v_claims ->> 'cart_id', '') IS NULL
    OR (v_claims ->> 'cart_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    OR (v_claims ->> 'cart_id')::uuid <> p_cart_id
    OR nullif(v_claims ->> 'cart_grant_id', '') IS NULL
    OR (v_claims ->> 'cart_grant_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unauthorized', 'replayed', false, 'snapshot', null, 'currentVersion', null);
  END IF;
  v_merchant := (v_claims ->> 'cart_merchant_id')::uuid;
  v_principal := v_claims ->> 'cart_principal_id';
  v_grant := (v_claims ->> 'cart_grant_id')::uuid;

  IF p_operation_id IS NULL OR length(trim(p_operation_id)) = 0 OR length(p_operation_id) > 128 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'replayed', false, 'snapshot', null, 'currentVersion', null);
  END IF;
  IF p_expected_version IS NULL OR p_expected_version < 1 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'replayed', false, 'snapshot', null, 'currentVersion', null);
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cc-prep-op|' || v_merchant::text || '|' || p_cart_id::text || '|' || v_principal || '|' || p_operation_id, 0)
  );

  SELECT EXISTS (
    SELECT 1 FROM public.commerce_cart_grants g
    WHERE g.id = v_grant AND g.merchant_id = v_merchant AND g.cart_id = p_cart_id
      AND g.principal_id = v_principal AND g.expires_at > now() AND g.revoked_at IS NULL
  ) INTO v_grant_live;
  IF NOT coalesce(v_grant_live, false) THEN
    SELECT EXISTS (SELECT 1 FROM public.commerce_cart_grants g WHERE g.id = v_grant) INTO v_grant_known;
    IF coalesce(v_grant_known, false) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'expired', 'replayed', false, 'snapshot', null, 'currentVersion', null);
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'unauthorized', 'replayed', false, 'snapshot', null, 'currentVersion', null);
  END IF;

  v_digest := pg_catalog.md5('prepare|' || p_cart_id::text || '|' || p_expected_version::text);
  SELECT * INTO v_existing
  FROM public.commerce_cart_operations
  WHERE merchant_id = v_merchant AND cart_id = p_cart_id
    AND principal_id = v_principal AND operation_id = p_operation_id;
  IF FOUND THEN
    SELECT version INTO v_new_version FROM public.commerce_carts WHERE id = p_cart_id;
    IF v_existing.request_digest <> v_digest OR v_existing.result IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'idempotency_conflict', 'replayed', false,
        'snapshot', null, 'currentVersion', v_new_version);
    END IF;
    RETURN pg_catalog.jsonb_set(v_existing.result, '{replayed}', 'true', true);
  END IF;

  SELECT * INTO v_cart
  FROM public.commerce_carts
  WHERE id = p_cart_id AND merchant_id = v_merchant
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found', 'replayed', false, 'snapshot', null, 'currentVersion', null);
  END IF;
  IF v_cart.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'expired', 'replayed', false,
      'snapshot', null, 'currentVersion', v_cart.version);
  END IF;
  IF v_cart.state <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'refresh_required', 'replayed', false,
      'snapshot', null, 'currentVersion', v_cart.version);
  END IF;
  IF v_cart.version <> p_expected_version THEN
    RETURN jsonb_build_object('ok', false, 'code', 'refresh_required', 'replayed', false,
      'snapshot', null, 'currentVersion', v_cart.version);
  END IF;

  SELECT * INTO v_session
  FROM public.commerce_cart_checkout_sessions
  WHERE merchant_id = v_merchant AND cart_id = p_cart_id
    AND principal_id = v_principal
    AND status = 'active' AND expires_at > now()
    AND cart_version_reviewed = v_cart.version
  ORDER BY checkout_generation DESC, created_at DESC
  LIMIT 1;
  IF FOUND THEN
    v_reused := true;
  ELSE
    SELECT coalesce(max(checkout_generation), 0) + 1 INTO v_gen
    FROM public.commerce_cart_checkout_sessions
    WHERE merchant_id = v_merchant AND cart_id = p_cart_id;
    INSERT INTO public.commerce_cart_checkout_sessions (
      merchant_id, cart_id, checkout_generation, cart_version_reviewed,
      principal_id, status, expires_at
    ) VALUES (
      v_merchant, p_cart_id, v_gen, v_cart.version,
      v_principal, 'active', now() + interval '30 minutes'
    ) RETURNING * INTO v_session;
  END IF;

  UPDATE public.commerce_carts
  SET checkout_session_id = v_session.id, updated_at = now()
  WHERE id = p_cart_id;

  SELECT public.commerce_cart_build_checkout_snapshot(v_merchant, p_cart_id) INTO v_snapshot;
  v_result := jsonb_build_object('ok', true, 'code', null, 'replayed', false,
    'sessionReused', v_reused,
    'snapshot', v_snapshot || jsonb_build_object(
      'checkoutSessionId', v_session.id,
      'generation', v_session.checkout_generation,
      'cartVersion', v_session.cart_version_reviewed,
      'cartId', p_cart_id,
      'merchantId', v_merchant
    ));
  INSERT INTO public.commerce_cart_operations
    (merchant_id, cart_id, principal_id, operation_id, request_digest, result, expires_at)
  VALUES
    (v_merchant, p_cart_id, v_principal, p_operation_id, v_digest, v_result, now() + interval '7 days');
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_storefront_order_with_cart_binding(
  p_variant text, p_session_id uuid, p_generation integer, p_args jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_claims jsonb := auth.jwt();
  v_role text := v_claims ->> 'role';
  v_context text := v_claims ->> 'storefront_order_context';
  v_claim_merchant uuid;
  v_agentic_context text := v_claims ->> 'agentic_context';
  v_agentic_merchant uuid;
  v_session public.commerce_cart_checkout_sessions%ROWTYPE;
  v_cart public.commerce_carts%ROWTYPE;
  v_merchant uuid;
  v_email text;
  v_name text;
  v_items jsonb;
  v_phone text;
  v_ship_fee numeric;
  v_discount numeric;
  v_tax numeric;
  v_pay_method text;
  v_pay_status text;
  v_ship_status text;
  v_ship_addr jsonb;
  v_source text;
  v_notes text;
  v_ad jsonb;
  v_quote uuid;
  v_provider text;
  v_tracking text;
  v_user uuid;
  v_tax_basis text;
  v_gift numeric;
  v_expected numeric;
  v_key text;
  v_hash text;
  v_route_proof jsonb;
  v_snapshot jsonb;
  v_items_derived boolean := false;
  v_save_goal uuid;
  v_save_amount numeric;
  v_save_key text;
  v_code uuid;
  -- All four order variants share the same 20-column row prefix; the
  -- record adapts per call and the receipt below keeps that prefix.
  v_order record;
  v_result jsonb;
BEGIN
  IF nullif(v_claims ->> 'storefront_order_merchant_id', '') IS NOT NULL
    AND (v_claims ->> 'storefront_order_merchant_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    v_claim_merchant := (v_claims ->> 'storefront_order_merchant_id')::uuid;
  END IF;
  IF nullif(v_claims ->> 'agentic_merchant_id', '') IS NOT NULL
    AND (v_claims ->> 'agentic_merchant_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    v_agentic_merchant := (v_claims ->> 'agentic_merchant_id')::uuid;
  END IF;
  -- Guest checkouts ride the same scoped token with `sub` omitted, so the
  -- context check is role + context + merchant, never auth.uid(). The
  -- coalesce keeps missing claims fail-closed instead of NULL-skipping.
  -- The server-minted agentic checkout context is a second trusted
  -- internal context alongside the storefront route context.
  -- Only the two scoped caller contexts may submit: the storefront
  -- route context and the server-minted agentic checkout context. The
  -- broad service_role key is deliberately not a caller here; both
  -- legitimate submitters use scoped clients with short-lived claims.
  IF NOT coalesce(
    (v_role = 'authenticated' AND v_context = 'route' AND v_claim_merchant IS NOT NULL)
    OR (v_role = 'authenticated' AND v_agentic_context = 'checkout' AND v_agentic_merchant IS NOT NULL),
    false
  ) THEN
    RAISE EXCEPTION 'cart_order_unauthorized' USING ERRCODE = 'P0001';
  END IF;

  IF p_variant NOT IN ('base', 'savings', 'quiz_voucher', 'discount_code') THEN
    RAISE EXCEPTION 'cart_order_invalid_variant' USING ERRCODE = 'P0001';
  END IF;

  v_merchant := nullif(p_args ->> 'p_merchant_id', '')::uuid;

  SELECT * INTO v_session
  FROM public.commerce_cart_checkout_sessions
  WHERE id = p_session_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cart_checkout_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- Every presented context must agree with the session merchant;
  -- conflicting contexts fail closed.
  IF v_session.merchant_id IS DISTINCT FROM v_merchant
    OR (v_context = 'route'
      AND v_claim_merchant IS DISTINCT FROM v_session.merchant_id)
    OR (v_agentic_context = 'checkout'
      AND v_agentic_merchant IS DISTINCT FROM v_session.merchant_id) THEN
    RAISE EXCEPTION 'cart_order_merchant_mismatch' USING ERRCODE = 'P0001';
  END IF;
  -- The body binding must name the reviewed cart and version. This RPC
  -- is reachable only with a server-minted context JWT, and both server
  -- callers forward the submitted cart identity on every bound submit;
  -- a supplied value that disagrees with the session is stale, never
  -- silently ignored.
  IF nullif(p_args ->> 'p_cart_id', '') IS NOT NULL
    AND (
      (p_args ->> 'p_cart_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      OR (p_args ->> 'p_cart_id')::uuid IS DISTINCT FROM v_session.cart_id
    ) THEN
    RAISE EXCEPTION 'cart_checkout_stale' USING ERRCODE = 'P0001';
  END IF;
  IF nullif(p_args ->> 'p_cart_version', '') IS NOT NULL
    AND (
      (p_args ->> 'p_cart_version') !~ '^[0-9]+$'
      OR (p_args ->> 'p_cart_version')::integer IS DISTINCT FROM v_session.cart_version_reviewed
    ) THEN
    RAISE EXCEPTION 'cart_checkout_stale' USING ERRCODE = 'P0001';
  END IF;
  -- Every submission must prove the preparing principal: the orders
  -- route forwards only its proof-verified principal, and the
  -- platform-delegated agentic caller forwards the session principal
  -- from its server-side session record. Absence fails closed (a NULL
  -- principal never matches), so omitting the field cannot skip the
  -- owner check. This precedes the submitted-replay return so a leaked
  -- session id cannot replay another principal's order receipt.
  IF (p_args ->> 'p_cart_principal_id') IS DISTINCT FROM v_session.principal_id THEN
    RAISE EXCEPTION 'cart_order_unauthorized' USING ERRCODE = 'P0001';
  END IF;
  IF p_generation IS DISTINCT FROM v_session.checkout_generation THEN
    RAISE EXCEPTION 'cart_checkout_stale' USING ERRCODE = 'P0001';
  END IF;
  IF v_session.status = 'submitted' THEN
    IF v_session.result IS NULL THEN
      RAISE EXCEPTION 'cart_checkout_stale' USING ERRCODE = 'P0001';
    END IF;
    RETURN pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(v_session.result, '{replayed}', 'true', true),
      '{order,idempotency_replayed}', 'true', true
    );
  END IF;
  IF v_session.status <> 'active' THEN
    RAISE EXCEPTION 'cart_checkout_stale' USING ERRCODE = 'P0001';
  END IF;
  IF v_session.expires_at <= now() THEN
    RAISE EXCEPTION 'cart_checkout_expired' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_cart
  FROM public.commerce_carts
  WHERE id = v_session.cart_id AND merchant_id = v_session.merchant_id
  FOR UPDATE;
  IF NOT FOUND OR v_cart.state <> 'active' OR v_cart.version <> v_session.cart_version_reviewed THEN
    RAISE EXCEPTION 'cart_checkout_stale' USING ERRCODE = 'P0001';
  END IF;

  IF v_cart.expires_at <= now() THEN
    RAISE EXCEPTION 'cart_checkout_expired' USING ERRCODE = 'P0001';
  END IF;

  -- The reviewed version alone does not bind browser-supplied items.
  -- Match the complete multiset by stable line identity and reviewed
  -- value, rejecting missing, extra, duplicate or changed items before
  -- the inner order RPC executes. Reviewed values come from the same
  -- snapshot builder that priced the prepare review, so the effective
  -- price (accepted negotiation, else validated catalog price) is the
  -- single source of truth; the submitted price is in major units.
  v_snapshot := public.commerce_cart_build_checkout_snapshot(v_merchant, v_cart.id);
  -- A reviewed line that is no longer purchasable (inactive/deleted
  -- offer or insufficient stock) must never reach the inner order RPC:
  -- its validated price falls back to the last cart price, so the
  -- multiset check below cannot distinguish it from a healthy line.
  IF coalesce((v_snapshot -> 'estimates' ->> 'unavailableCount')::integer, 0) > 0 THEN
    RAISE EXCEPTION 'cart_checkout_stale' USING ERRCODE = 'P0001';
  END IF;
  v_items := p_args -> 'p_items';
  IF jsonb_typeof(v_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'cart_checkout_stale' USING ERRCODE = 'P0001';
  END IF;
  -- Platform-delegated (agentic) submits are server-side calls, not
  -- browser echoes: their items are derived from the reviewed snapshot
  -- so line identity, quantities and effective prices are the reviewed
  -- ones by construction, and caller items contribute only display
  -- fields matched by product identity. The multiset check below still
  -- runs against the derived items, so any derivation drift fails
  -- closed. Shopper (route-context) submits keep strict echo matching.
  IF v_agentic_context = 'checkout' AND v_context IS DISTINCT FROM 'route' THEN
    v_items_derived := true;
    SELECT coalesce(jsonb_agg(derived.item ORDER BY derived.ord), '[]'::jsonb)
    INTO v_items
    FROM (
      SELECT s.ord,
        jsonb_build_object(
          'cart_line_id', s.sl ->> 'id',
          'product_id', s.sl ->> 'productId',
          'variant_id', s.sl -> 'variantId',
          'condition', s.sl -> 'condition',
          'variant_attributes', coalesce(s.sl -> 'options', '{}'::jsonb),
          'quantity', (s.sl ->> 'quantity')::integer,
          'price', (s.sl ->> 'effectiveUnitPriceMinor')::numeric / 100,
          'voucher_award_id', s.sl -> 'voucherAwardId',
          'has_assurance', coalesce((s.sl ->> 'hasAssurance')::boolean, false),
          'assurance_fee', CASE
            WHEN coalesce((s.sl ->> 'hasAssurance')::boolean, false)
            THEN round(
              (s.sl ->> 'effectiveUnitPriceMinor')::numeric
              * (s.sl ->> 'quantity')::numeric
              * coalesce((s.sl ->> 'assuranceRate')::numeric, 0)
            ) / 100
            ELSE 0
          END,
          'name', caller.item ->> 'name',
          'image_url', coalesce(caller.item ->> 'image_url', caller.item ->> 'image')
        ) AS item
      FROM jsonb_array_elements(coalesce(v_snapshot -> 'lines', '[]'::jsonb))
        WITH ORDINALITY AS s(sl, ord)
      LEFT JOIN LATERAL (
        SELECT i.item
        FROM jsonb_array_elements(p_args -> 'p_items') AS i(item)
        WHERE lower(i.item ->> 'product_id') = lower(s.sl ->> 'productId')
          AND nullif(lower(i.item ->> 'variant_id'), '')
            IS NOT DISTINCT FROM (s.sl ->> 'variantId')
          AND nullif(i.item ->> 'condition', '')
            IS NOT DISTINCT FROM (s.sl ->> 'condition')
        LIMIT 1
      ) caller ON true
    ) derived;
  END IF;
  IF jsonb_array_length(v_items) = 0
    OR jsonb_array_length(v_items) <> (
      SELECT count(*) FROM public.commerce_cart_lines
      WHERE cart_id = v_cart.id AND merchant_id = v_merchant
    )
    OR EXISTS (
      SELECT 1 FROM public.commerce_cart_lines l
      WHERE l.cart_id = v_cart.id AND l.merchant_id = v_merchant
        AND 1 <> (
          SELECT count(*) FROM jsonb_array_elements(v_items) AS i(item)
          WHERE lower(item ->> 'cart_line_id') = l.id::text
            AND lower(item ->> 'product_id') = l.product_id::text
            AND nullif(lower(item ->> 'variant_id'), '') IS NOT DISTINCT FROM l.variant_id::text
            AND nullif(item ->> 'condition', '') IS NOT DISTINCT FROM l.condition
            AND coalesce(item -> 'variant_attributes', '{}'::jsonb) = coalesce(l.options, '{}'::jsonb)
            AND item -> 'quantity' = to_jsonb(l.quantity)
            AND nullif(item ->> 'voucher_award_id', '') IS NOT DISTINCT FROM l.voucher_award_id::text
            AND nullif(item ->> 'price', '') IS NOT NULL
            AND (item ->> 'price') ~ '^[0-9]+(\.[0-9]+)?$'
            AND round((item ->> 'price')::numeric * 100) = (
              SELECT (sl ->> 'effectiveUnitPriceMinor')::numeric
              FROM jsonb_array_elements(coalesce(v_snapshot -> 'lines', '[]'::jsonb)) AS sl
              WHERE sl ->> 'id' = l.id::text
            )
            AND coalesce((item ->> 'has_assurance')::boolean, false) = l.has_assurance
            AND (
              NOT l.has_assurance
              OR l.assurance_rate IS NULL
              OR round(coalesce((item ->> 'assurance_fee')::numeric, -1) * 100) = round(
                (
                  SELECT (sl ->> 'effectiveUnitPriceMinor')::numeric
                  FROM jsonb_array_elements(coalesce(v_snapshot -> 'lines', '[]'::jsonb)) AS sl
                  WHERE sl ->> 'id' = l.id::text
                ) * l.quantity * l.assurance_rate
              )
            )
        )
    ) THEN
    RAISE EXCEPTION 'cart_checkout_stale' USING ERRCODE = 'P0001';
  END IF;

  v_email := p_args ->> 'p_customer_email';
  v_name := p_args ->> 'p_customer_name';
  IF NOT v_items_derived THEN
    v_items := p_args -> 'p_items';
  END IF;
  v_phone := p_args ->> 'p_customer_phone';
  v_ship_fee := coalesce((p_args ->> 'p_shipping_fee')::numeric, 0);
  v_discount := coalesce((p_args ->> 'p_discount_amount')::numeric, 0);
  v_tax := coalesce((p_args ->> 'p_tax_amount')::numeric, 0);
  v_pay_method := coalesce(p_args ->> 'p_payment_method', 'card');
  v_pay_status := coalesce(p_args ->> 'p_payment_status', 'unpaid');
  v_ship_status := coalesce(p_args ->> 'p_shipping_status', 'pending');
  v_ship_addr := p_args -> 'p_shipping_address';
  v_source := coalesce(p_args ->> 'p_source', 'online_store');
  v_notes := p_args ->> 'p_notes';
  v_ad := p_args -> 'p_ad_tracking';
  v_quote := nullif(p_args ->> 'p_selected_quote_id', '')::uuid;
  v_provider := p_args ->> 'p_shipping_provider';
  v_tracking := p_args ->> 'p_tracking_number';
  v_user := nullif(p_args ->> 'p_user_id', '')::uuid;
  v_tax_basis := coalesce(p_args ->> 'p_tax_basis', 'exclusive');
  v_gift := coalesce((p_args ->> 'p_gift_wrapping_fee')::numeric, 0);
  v_expected := (p_args ->> 'p_expected_total')::numeric;
  v_key := p_args ->> 'p_checkout_idempotency_key';
  v_hash := p_args ->> 'p_checkout_request_hash';

  IF p_variant = 'base' THEN
    SELECT * INTO v_order
    FROM public.create_storefront_order(
      p_merchant_id := v_merchant, p_customer_email := v_email, p_customer_name := v_name,
      p_items := v_items, p_customer_phone := v_phone, p_shipping_fee := v_ship_fee,
      p_discount_amount := v_discount, p_tax_amount := v_tax, p_payment_method := v_pay_method,
      p_payment_status := v_pay_status, p_shipping_status := v_ship_status,
      p_shipping_address := v_ship_addr, p_source := v_source, p_notes := v_notes,
      p_ad_tracking := v_ad, p_selected_quote_id := v_quote, p_shipping_provider := v_provider,
      p_tracking_number := v_tracking, p_user_id := v_user, p_tax_basis := v_tax_basis,
      p_gift_wrapping_fee := v_gift, p_expected_total := v_expected,
      p_checkout_idempotency_key := v_key, p_checkout_request_hash := v_hash
    ) AS r;
  ELSIF p_variant = 'savings' THEN
    v_save_goal := nullif(p_args ->> 'p_savings_goal_id', '')::uuid;
    v_save_amount := (p_args ->> 'p_savings_amount')::numeric;
    v_save_key := p_args ->> 'p_savings_idempotency_key';
    SELECT * INTO v_order
    FROM public.create_storefront_order_with_savings(
      p_merchant_id := v_merchant, p_customer_email := v_email, p_customer_name := v_name,
      p_items := v_items, p_customer_phone := v_phone, p_shipping_fee := v_ship_fee,
      p_discount_amount := v_discount, p_tax_amount := v_tax, p_payment_method := v_pay_method,
      p_payment_status := v_pay_status, p_shipping_status := v_ship_status,
      p_shipping_address := v_ship_addr, p_source := v_source, p_notes := v_notes,
      p_ad_tracking := v_ad, p_selected_quote_id := v_quote, p_shipping_provider := v_provider,
      p_tracking_number := v_tracking, p_user_id := v_user, p_tax_basis := v_tax_basis,
      p_gift_wrapping_fee := v_gift, p_expected_total := v_expected,
      p_savings_goal_id := v_save_goal, p_savings_amount := v_save_amount,
      p_savings_idempotency_key := v_save_key,
      p_checkout_idempotency_key := v_key, p_checkout_request_hash := v_hash
    ) AS r;
  ELSIF p_variant = 'quiz_voucher' THEN
    v_route_proof := coalesce(p_args -> 'p_route_proof', '{}'::jsonb);
    SELECT * INTO v_order
    FROM public.create_storefront_order_with_quiz_voucher(
      p_merchant_id := v_merchant, p_customer_email := v_email, p_customer_name := v_name,
      p_items := v_items, p_customer_phone := v_phone, p_shipping_fee := v_ship_fee,
      p_discount_amount := v_discount, p_tax_amount := v_tax, p_payment_method := v_pay_method,
      p_payment_status := v_pay_status, p_shipping_status := v_ship_status,
      p_shipping_address := v_ship_addr, p_source := v_source, p_notes := v_notes,
      p_ad_tracking := v_ad, p_selected_quote_id := v_quote, p_shipping_provider := v_provider,
      p_tracking_number := v_tracking, p_user_id := v_user, p_tax_basis := v_tax_basis,
      p_gift_wrapping_fee := v_gift, p_expected_total := v_expected,
      p_route_proof := v_route_proof
    ) AS r;
  ELSE
    v_code := nullif(p_args ->> 'p_discount_code_id', '')::uuid;
    SELECT * INTO v_order
    FROM public.create_storefront_order_with_discount_code(
      p_merchant_id := v_merchant, p_customer_email := v_email, p_customer_name := v_name,
      p_items := v_items, p_customer_phone := v_phone, p_shipping_fee := v_ship_fee,
      p_discount_amount := v_discount, p_tax_amount := v_tax, p_payment_method := v_pay_method,
      p_payment_status := v_pay_status, p_shipping_status := v_ship_status,
      p_shipping_address := v_ship_addr, p_source := v_source, p_notes := v_notes,
      p_ad_tracking := v_ad, p_selected_quote_id := v_quote, p_shipping_provider := v_provider,
      p_tracking_number := v_tracking, p_user_id := v_user, p_tax_basis := v_tax_basis,
      p_gift_wrapping_fee := v_gift, p_expected_total := v_expected,
      p_checkout_idempotency_key := v_key, p_checkout_request_hash := v_hash,
      p_discount_code_id := v_code
    ) AS r;
  END IF;

  -- The receipt order mirrors the full inner row so route and dispatch
  -- continuations read it like a direct RPC row, including
  -- variant-specific columns (e.g. the savings redemption fields).
  -- `idempotency_replayed` tracks the binding: a replayed binding never
  -- created a new order, whatever the inner RPC reported.
  v_result := jsonb_build_object('ok', true, 'code', null, 'replayed', false,
    'order', pg_catalog.to_jsonb(v_order)
      || jsonb_build_object('idempotency_replayed', false),
    'binding', jsonb_build_object('sessionId', v_session.id, 'cartId', v_cart.id,
      'merchantId', v_session.merchant_id, 'checkout_generation', v_session.checkout_generation,
      'cartVersionReviewed', v_session.cart_version_reviewed, 'variant', p_variant));
  UPDATE public.commerce_cart_checkout_sessions
  SET status = 'submitted', order_id = v_order.id, result = v_result, submitted_at = now()
  WHERE id = v_session.id;
  UPDATE public.commerce_carts
  SET state = 'completed', updated_at = now()
  WHERE id = v_cart.id;
  RETURN v_result;
END;
$$;

-- The broad service_role key must not invoke the user-facing binding;
-- both legitimate submitters use scoped clients with short-lived claims.
REVOKE EXECUTE ON FUNCTION public.create_storefront_order_with_cart_binding(text, uuid, integer, jsonb)
  FROM service_role;

CREATE OR REPLACE FUNCTION public.cleanup_commerce_carts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Account operations arrive in a later migration; purge them once present.
  IF to_regclass('public.commerce_cart_account_operations') IS NOT NULL THEN
    DELETE FROM public.commerce_cart_account_operations WHERE expires_at < now();
  END IF;
  DELETE FROM public.commerce_cart_operations WHERE expires_at < now();
  DELETE FROM public.commerce_cart_creation_requests WHERE expires_at < now();
  DELETE FROM public.commerce_cart_events WHERE expires_at < now();
  DELETE FROM public.commerce_cart_handoffs WHERE expires_at < now() - interval '1 day';
  DELETE FROM public.commerce_cart_checkout_sessions
  WHERE (status = 'submitted' AND submitted_at < now() - interval '90 days')
    OR (status <> 'submitted' AND expires_at < now() - interval '1 day');
  UPDATE public.commerce_carts c
  SET state = 'expired', updated_at = now()
  WHERE c.state = 'active' AND c.expires_at < now()
    AND NOT EXISTS (
      SELECT 1 FROM public.commerce_cart_checkout_sessions s
      WHERE s.merchant_id = c.merchant_id AND s.cart_id = c.id
        AND s.status = 'active' AND s.expires_at > now()
    );
END;
$$;

-- Support cart/grant FK deletes without scanning tenant retry tables.
CREATE INDEX IF NOT EXISTS commerce_cart_creation_requests_cart_idx
  ON public.commerce_cart_creation_requests (merchant_id, cart_id);
CREATE INDEX IF NOT EXISTS commerce_cart_creation_requests_grant_idx
  ON public.commerce_cart_creation_requests (grant_id);
CREATE INDEX IF NOT EXISTS commerce_cart_legacy_refs_cart_idx
  ON public.commerce_cart_legacy_refs (merchant_id, cart_id);

-- Preserve the documented sliding lifetime on version-changing activity.
CREATE OR REPLACE FUNCTION public.commerce_cart_mutate(
  p_cart_id uuid, p_operation_id text, p_expected_version integer, p_command jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_claims jsonb := auth.jwt();
  v_merchant uuid;
  v_principal text;
  v_grant uuid;
  v_digest text;
  v_existing public.commerce_cart_operations%ROWTYPE;
  v_cart public.commerce_carts%ROWTYPE;
  v_grant_live boolean;
  v_grant_known boolean;
  v_state jsonb;
  v_type text;
  v_changed boolean := false;
  v_product_id uuid;
  v_variant_id uuid;
  v_condition text;
  v_options jsonb;
  v_quantity integer;
  v_voucher_token text;
  v_voucher_award text;
  v_negotiated integer;
  v_neg_status text;
  v_line_id uuid;
  v_line public.commerce_cart_lines%ROWTYPE;
  v_entry jsonb;
  v_count integer;
  v_new_version integer;
BEGIN
  IF nullif(v_claims ->> 'cart_merchant_id', '') IS NULL
    OR (v_claims ->> 'cart_merchant_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    OR nullif(v_claims ->> 'cart_principal_id', '') IS NULL
    OR (v_claims ->> 'cart_scope') <> 'session'
    OR nullif(v_claims ->> 'cart_id', '') IS NULL
    OR (v_claims ->> 'cart_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    OR (v_claims ->> 'cart_id')::uuid <> p_cart_id
    OR nullif(v_claims ->> 'cart_grant_id', '') IS NULL
    OR (v_claims ->> 'cart_grant_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unauthorized', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;
  v_merchant := (v_claims ->> 'cart_merchant_id')::uuid;
  v_principal := v_claims ->> 'cart_principal_id';
  v_grant := (v_claims ->> 'cart_grant_id')::uuid;

  -- Pilot gate (defense in depth with the route-level check): the
  -- shared-cart RPCs refuse merchants without the shared_cart feature,
  -- mirroring the broadcast/account predicates.
  IF NOT EXISTS (
    SELECT 1 FROM public.merchants m
    WHERE m.id = v_merchant AND m.premium_features @> '["shared_cart"]'::jsonb
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'merchant_unavailable', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;

  IF p_operation_id IS NULL OR length(trim(p_operation_id)) = 0 OR length(p_operation_id) > 128 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;
  IF p_expected_version IS NULL OR p_expected_version < 1 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cc-op|' || v_merchant::text || '|' || p_cart_id::text || '|' || v_principal || '|' || p_operation_id, 0)
  );

  SELECT EXISTS (
    SELECT 1 FROM public.commerce_cart_grants g
    WHERE g.id = v_grant AND g.merchant_id = v_merchant AND g.cart_id = p_cart_id
      AND g.principal_id = v_principal AND g.expires_at > now() AND g.revoked_at IS NULL
  ) INTO v_grant_live;
  IF NOT coalesce(v_grant_live, false) THEN
    SELECT EXISTS (SELECT 1 FROM public.commerce_cart_grants g WHERE g.id = v_grant) INTO v_grant_known;
    IF coalesce(v_grant_known, false) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'expired', 'replayed', false, 'state', null, 'currentVersion', null);
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'unauthorized', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;

  v_digest := pg_catalog.md5(p_command::text);
  SELECT * INTO v_existing
  FROM public.commerce_cart_operations
  WHERE merchant_id = v_merchant AND cart_id = p_cart_id
    AND principal_id = v_principal AND operation_id = p_operation_id;
  IF FOUND THEN
    SELECT version INTO v_new_version FROM public.commerce_carts WHERE id = p_cart_id;
    IF v_existing.request_digest <> v_digest OR v_existing.result IS NULL THEN
      SELECT public.commerce_cart_assemble_state(v_merchant, p_cart_id) INTO v_state;
      RETURN jsonb_build_object('ok', false, 'code', 'idempotency_conflict', 'replayed', false,
        'state', v_state, 'currentVersion', v_new_version);
    END IF;
    RETURN jsonb_build_object('ok', true, 'code', null, 'replayed', true,
      'state', v_existing.result, 'currentVersion', v_new_version);
  END IF;

  SELECT * INTO v_cart
  FROM public.commerce_carts
  WHERE id = p_cart_id AND merchant_id = v_merchant
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;
  IF v_cart.state <> 'active' THEN
    SELECT public.commerce_cart_assemble_state(v_merchant, p_cart_id) INTO v_state;
    RETURN jsonb_build_object('ok', false, 'code', 'cart_locked', 'replayed', false,
      'state', v_state, 'currentVersion', v_cart.version);
  END IF;
  IF v_cart.version <> p_expected_version THEN
    SELECT public.commerce_cart_assemble_state(v_merchant, p_cart_id) INTO v_state;
    RETURN jsonb_build_object('ok', false, 'code', 'version_conflict', 'replayed', false,
      'state', v_state, 'currentVersion', v_cart.version);
  END IF;

  IF jsonb_typeof(p_command) <> 'object' THEN
    RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
  END IF;
  v_type := p_command ->> 'type';

  IF v_type = 'add' THEN
    SELECT pi_product, pi_variant, pi_condition, pi_options, pi_quantity,
      pi_voucher_token, pi_voucher_award, pi_negotiated, pi_neg_status
    INTO v_product_id, v_variant_id, v_condition, v_options, v_quantity,
      v_voucher_token, v_voucher_award, v_negotiated, v_neg_status
    FROM public.commerce_cart_parse_input_line(p_command);
    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
    END IF;
    PERFORM public.commerce_cart_require_offer(v_merchant, v_product_id, v_variant_id);
    SELECT * INTO v_line
    FROM public.commerce_cart_lines
    WHERE merchant_id = v_merchant AND cart_id = p_cart_id
      AND product_id = v_product_id
      AND variant_id IS NOT DISTINCT FROM v_variant_id
      AND condition IS NOT DISTINCT FROM v_condition
      AND options = v_options
      AND voucher_token IS NOT DISTINCT FROM v_voucher_token
      AND voucher_award_id IS NOT DISTINCT FROM v_voucher_award::uuid;
    IF FOUND THEN
      IF v_line.voucher_token IS NOT NULL OR v_line.voucher_award_id IS NOT NULL THEN
        RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
      END IF;
      IF v_line.quantity + v_quantity > 10 THEN
        RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
      END IF;
      UPDATE public.commerce_cart_lines
      SET quantity = quantity + v_quantity,
        last_unit_price_minor = public.commerce_cart_offer_price_minor(v_merchant, v_product_id, v_variant_id),
        updated_at = now()
      WHERE id = v_line.id;
    ELSE
      SELECT count(*) INTO v_count
      FROM public.commerce_cart_lines
      WHERE merchant_id = v_merchant AND cart_id = p_cart_id;
      IF v_count >= 20 THEN
        RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
      END IF;
      INSERT INTO public.commerce_cart_lines (
        merchant_id, cart_id, product_id, variant_id, condition, options, quantity,
        negotiated_unit_price_minor, negotiation_status, voucher_token, voucher_award_id,
        last_unit_price_minor
      ) VALUES (
        v_merchant, p_cart_id, v_product_id, v_variant_id, v_condition, v_options,
        CASE WHEN v_voucher_token IS NOT NULL OR v_voucher_award IS NOT NULL THEN 1 ELSE v_quantity END,
        v_negotiated, CASE WHEN v_negotiated IS NOT NULL AND v_neg_status IS NULL THEN 'accepted' ELSE v_neg_status END,
        v_voucher_token, v_voucher_award::uuid,
        public.commerce_cart_offer_price_minor(v_merchant, v_product_id, v_variant_id)
      );
    END IF;
    v_changed := true;

  ELSIF v_type = 'set_quantity' THEN
    IF (p_command ->> 'lineId') IS NULL
      OR (p_command ->> 'lineId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      OR (p_command ->> 'quantity') IS NULL
      OR (p_command ->> 'quantity') !~ '^[0-9]+$'
      OR (p_command ->> 'quantity')::integer < 1
      OR (p_command ->> 'quantity')::integer > 10 THEN
      RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
    END IF;
    v_line_id := (p_command ->> 'lineId')::uuid;
    v_quantity := (p_command ->> 'quantity')::integer;
    SELECT * INTO v_line
    FROM public.commerce_cart_lines
    WHERE id = v_line_id AND merchant_id = v_merchant AND cart_id = p_cart_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
    END IF;
    -- Voucher-backed lines are pinned to quantity one at creation and
    -- import; quantity controls must never unpin them, or the orders
    -- route would reject the cart at checkout.
    IF (v_line.voucher_token IS NOT NULL OR v_line.voucher_award_id IS NOT NULL)
      AND v_quantity <> 1 THEN
      RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
    END IF;
    IF v_quantity = v_line.quantity THEN
      v_changed := false;
    ELSE
      IF v_quantity > v_line.quantity THEN
        PERFORM public.commerce_cart_require_offer(v_merchant, v_line.product_id, v_line.variant_id);
      END IF;
      UPDATE public.commerce_cart_lines
      SET quantity = v_quantity,
        last_unit_price_minor = public.commerce_cart_offer_price_minor(v_merchant, v_line.product_id, v_line.variant_id),
        updated_at = now()
      WHERE id = v_line.id;
      v_changed := true;
    END IF;

  ELSIF v_type = 'remove' THEN
    IF (p_command ->> 'lineId') IS NULL
      OR (p_command ->> 'lineId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
      RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
    END IF;
    v_line_id := (p_command ->> 'lineId')::uuid;
    DELETE FROM public.commerce_cart_lines
    WHERE id = v_line_id AND merchant_id = v_merchant AND cart_id = p_cart_id;
    v_changed := FOUND;

  ELSIF v_type = 'clear' THEN
    DELETE FROM public.commerce_cart_lines
    WHERE merchant_id = v_merchant AND cart_id = p_cart_id;
    v_changed := FOUND;

  ELSIF v_type = 'set_assurance' THEN
    IF (p_command ->> 'lineId') IS NULL
      OR (p_command ->> 'lineId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      OR (p_command ->> 'hasAssurance') NOT IN ('true', 'false') THEN
      RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
    END IF;
    v_line_id := (p_command ->> 'lineId')::uuid;
    SELECT * INTO v_line
    FROM public.commerce_cart_lines
    WHERE id = v_line_id AND merchant_id = v_merchant AND cart_id = p_cart_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
    END IF;
    IF (p_command ->> 'hasAssurance')::boolean = v_line.has_assurance THEN
      v_changed := false;
    ELSE
      -- The coverage rate is server-owned; shoppers choose coverage only.
      UPDATE public.commerce_cart_lines
      SET has_assurance = (p_command ->> 'hasAssurance')::boolean,
        assurance_rate = CASE
          WHEN (p_command ->> 'hasAssurance')::boolean THEN 0.05
          ELSE NULL
        END,
        updated_at = now()
      WHERE id = v_line.id;
      v_changed := true;
    END IF;

  ELSIF v_type = 'set_negotiated_price' THEN
    IF (p_command ->> 'lineId') IS NULL
      OR (p_command ->> 'lineId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      OR ((p_command ->> 'negotiatedUnitPriceMinor') IS NOT NULL
        AND (p_command ->> 'negotiatedUnitPriceMinor') !~ '^[0-9]+$') THEN
      RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
    END IF;
    v_line_id := (p_command ->> 'lineId')::uuid;
    SELECT * INTO v_line
    FROM public.commerce_cart_lines
    WHERE id = v_line_id AND merchant_id = v_merchant AND cart_id = p_cart_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
    END IF;
    v_negotiated := (p_command ->> 'negotiatedUnitPriceMinor')::integer;
    IF v_negotiated IS NOT NULL THEN
      -- A negotiated price is a live-offer discount in place: the line,
      -- its quantity and its identity never move, so a failed or
      -- interrupted reprice cannot lose the item.
      PERFORM public.commerce_cart_require_offer(v_merchant, v_line.product_id, v_line.variant_id);
      IF v_negotiated < 1
        OR v_negotiated >= public.commerce_cart_offer_price_minor(v_merchant, v_line.product_id, v_line.variant_id) THEN
        RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
      END IF;
    END IF;
    IF v_negotiated IS NOT DISTINCT FROM v_line.negotiated_unit_price_minor THEN
      v_changed := false;
    ELSE
      UPDATE public.commerce_cart_lines
      SET negotiated_unit_price_minor = v_negotiated,
        negotiation_status = CASE WHEN v_negotiated IS NULL THEN NULL ELSE 'accepted' END,
        updated_at = now()
      WHERE id = v_line.id;
      v_changed := true;
    END IF;

  ELSIF v_type = 'replace' THEN
    IF jsonb_typeof(p_command -> 'lines') <> 'array'
      OR jsonb_array_length(p_command -> 'lines') > 20 THEN
      RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = 'cart_replace_want' AND n.nspname LIKE 'pg_temp%'
    ) THEN
      DROP TABLE cart_replace_want;
    END IF;
    CREATE TEMPORARY TABLE cart_replace_want (
      product_id uuid, variant_id uuid, condition text, options jsonb,
      quantity integer, voucher_token text, voucher_award uuid,
      negotiated integer, neg_status text
    ) ON COMMIT DROP;
    FOR v_entry IN SELECT value FROM jsonb_array_elements(p_command -> 'lines') value LOOP
      SELECT pi_product, pi_variant, pi_condition, pi_options, pi_quantity,
        pi_voucher_token, pi_voucher_award, pi_negotiated, pi_neg_status
      INTO v_product_id, v_variant_id, v_condition, v_options, v_quantity,
        v_voucher_token, v_voucher_award, v_negotiated, v_neg_status
      FROM public.commerce_cart_parse_input_line(v_entry);
      IF v_product_id IS NULL THEN
        RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
      END IF;
      PERFORM public.commerce_cart_require_offer(v_merchant, v_product_id, v_variant_id);
      INSERT INTO cart_replace_want VALUES (
        v_product_id, v_variant_id, v_condition, v_options,
        CASE WHEN v_voucher_token IS NOT NULL OR v_voucher_award IS NOT NULL THEN 1 ELSE v_quantity END,
        v_voucher_token, v_voucher_award::uuid, v_negotiated,
        CASE WHEN v_negotiated IS NOT NULL AND v_neg_status IS NULL THEN 'accepted' ELSE v_neg_status END
      );
    END LOOP;
    -- Delete lines with no matching wanted identity; update matched ones.
    DELETE FROM public.commerce_cart_lines l
    WHERE l.merchant_id = v_merchant AND l.cart_id = p_cart_id
      AND NOT EXISTS (
        SELECT 1 FROM cart_replace_want w
        WHERE w.product_id = l.product_id
          AND w.variant_id IS NOT DISTINCT FROM l.variant_id
          AND w.condition IS NOT DISTINCT FROM l.condition
          AND w.options = l.options
          AND w.voucher_token IS NOT DISTINCT FROM l.voucher_token
          AND w.voucher_award IS NOT DISTINCT FROM l.voucher_award_id
      );
    IF FOUND THEN v_changed := true; END IF;
    UPDATE public.commerce_cart_lines l
    SET quantity = w.quantity,
      negotiated_unit_price_minor = w.negotiated,
      negotiation_status = w.neg_status,
      last_unit_price_minor = public.commerce_cart_offer_price_minor(v_merchant, l.product_id, l.variant_id),
      updated_at = now()
    FROM cart_replace_want w
    WHERE l.merchant_id = v_merchant AND l.cart_id = p_cart_id
      AND w.product_id = l.product_id
      AND w.variant_id IS NOT DISTINCT FROM l.variant_id
      AND w.condition IS NOT DISTINCT FROM l.condition
      AND w.options = l.options
      AND w.voucher_token IS NOT DISTINCT FROM l.voucher_token
      AND w.voucher_award IS NOT DISTINCT FROM l.voucher_award_id
      AND (
        l.quantity IS DISTINCT FROM w.quantity
        OR l.negotiated_unit_price_minor IS DISTINCT FROM w.negotiated
        OR l.negotiation_status IS DISTINCT FROM w.neg_status
      );
    IF FOUND THEN v_changed := true; END IF;
    INSERT INTO public.commerce_cart_lines (
      merchant_id, cart_id, product_id, variant_id, condition, options, quantity,
      negotiated_unit_price_minor, negotiation_status, voucher_token, voucher_award_id,
      last_unit_price_minor
    )
    SELECT v_merchant, p_cart_id, w.product_id, w.variant_id, w.condition, w.options,
      w.quantity, w.negotiated, w.neg_status, w.voucher_token, w.voucher_award,
      public.commerce_cart_offer_price_minor(v_merchant, w.product_id, w.variant_id)
    FROM cart_replace_want w
    WHERE NOT EXISTS (
      SELECT 1 FROM public.commerce_cart_lines l
      WHERE l.merchant_id = v_merchant AND l.cart_id = p_cart_id
        AND w.product_id = l.product_id
        AND w.variant_id IS NOT DISTINCT FROM l.variant_id
        AND w.condition IS NOT DISTINCT FROM l.condition
        AND w.options = l.options
        AND w.voucher_token IS NOT DISTINCT FROM l.voucher_token
        AND w.voucher_award IS NOT DISTINCT FROM l.voucher_award_id
    );
    IF FOUND THEN v_changed := true; END IF;
    DROP TABLE cart_replace_want;

  ELSE
    RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
  END IF;

  IF v_changed THEN
    UPDATE public.commerce_carts
    SET version = version + 1, updated_at = now(),
      expires_at = greatest(expires_at, now() + interval '7 days')
    WHERE id = p_cart_id;
    UPDATE public.commerce_cart_grants
    SET expires_at = greatest(expires_at, now() + interval '7 days')
    WHERE id = v_grant AND merchant_id = v_merchant AND cart_id = p_cart_id
      AND principal_id = v_principal AND revoked_at IS NULL;
    SELECT public.commerce_cart_assemble_state(v_merchant, p_cart_id) INTO v_state;
    v_new_version := (v_state ->> 'version')::integer;
    INSERT INTO public.commerce_cart_events
      (merchant_id, cart_id, version, operation_id, payload, expires_at)
    VALUES (
      v_merchant, p_cart_id, v_new_version, p_operation_id,
      jsonb_build_object(
        'cartId', p_cart_id, 'version', v_new_version, 'operationId', p_operation_id
      ),
      now() + interval '7 days'
    );
  ELSE
    SELECT public.commerce_cart_assemble_state(v_merchant, p_cart_id) INTO v_state;
    v_new_version := (v_state ->> 'version')::integer;
  END IF;

  INSERT INTO public.commerce_cart_operations
    (merchant_id, cart_id, principal_id, operation_id, request_digest, result, expires_at)
  VALUES (v_merchant, p_cart_id, v_principal, p_operation_id, v_digest, v_state, now() + interval '7 days');

  RETURN jsonb_build_object('ok', true, 'code', null, 'replayed', false,
    'state', v_state, 'currentVersion', v_new_version);
EXCEPTION
  WHEN raise_exception THEN
    IF SQLERRM = 'invalid_line' OR SQLERRM = 'invalid_offer' THEN
      SELECT public.commerce_cart_assemble_state(v_merchant, p_cart_id) INTO v_state;
      SELECT version INTO v_new_version FROM public.commerce_carts WHERE id = p_cart_id;
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'replayed', false,
        'state', v_state, 'currentVersion', v_new_version);
    END IF;
    RAISE;
END;
$$;


-- Checkout totals can exceed int32 even within quantity and line caps.
CREATE OR REPLACE FUNCTION public.commerce_cart_build_checkout_snapshot(
  p_merchant_id uuid, p_cart_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_cart public.commerce_carts%ROWTYPE;
  v_lines jsonb;
  v_subtotal bigint;
  v_unavailable integer;
BEGIN
  SELECT * INTO v_cart
  FROM public.commerce_carts
  WHERE id = p_cart_id AND merchant_id = p_merchant_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  WITH line_checks AS (
    SELECT
      l.id AS line_id,
      l.created_at AS line_created,
      l.product_id AS product_id,
      l.variant_id AS variant_id,
      l.condition AS condition,
      l.options AS options,
      l.quantity AS quantity,
      l.negotiated_unit_price_minor AS negotiated,
      l.negotiation_status AS neg_status,
      l.voucher_token AS voucher_token,
      l.voucher_award_id AS voucher_award_id,
      l.has_assurance AS has_assurance,
      l.assurance_rate AS assurance_rate,
      l.last_unit_price_minor AS last_price,
      (
        p.id IS NOT NULL
        AND p.merchant_id = p_merchant_id
        AND p.status = 'active'
        AND (
          l.variant_id IS NULL
          OR (
            v.id IS NOT NULL
            AND v.product_id = l.product_id
            AND v.merchant_id = p_merchant_id
            -- Match the storefront public-variant predicate: a variant
            -- deactivated, archived or soft-deleted after being added
            -- is no longer reviewed as available, and the inventory
            -- anchor is not purchasable when the product has variants.
            AND coalesce(v.is_active, true)
            AND v.status = 'active'
            AND v.deleted_at IS NULL
            AND v.archived_at IS NULL
            AND NOT (coalesce(p.has_variants, false) AND coalesce(v.is_default, false))
          )
        )
      ) AS offer_ok,
      (round(coalesce(v.price_override, p.price, 0) * 100))::integer AS catalog_minor,
      CASE
        WHEN l.variant_id IS NULL THEN
          CASE
            WHEN p.stock_quantity IS NULL THEN greatest(coalesce(p.stock, 0), 0)
            WHEN p.stock_quantity = 0 AND coalesce(p.stock, 0) > 0 THEN p.stock
            ELSE greatest(p.stock_quantity, 0)
          END
        ELSE greatest(coalesce(v.stock_quantity, 0), 0)
      END AS stock_qty,
      coalesce(p.manage_stock, true) AS manage_stock
    FROM public.commerce_cart_lines l
    LEFT JOIN public.products p ON p.id = l.product_id
    LEFT JOIN public.product_variants v ON v.id = l.variant_id
    WHERE l.merchant_id = p_merchant_id AND l.cart_id = p_cart_id
  ),
  enriched AS (
    SELECT
      line_id,
      line_created,
      product_id,
      variant_id,
      condition,
      options,
      quantity,
      negotiated,
      neg_status,
      voucher_token,
      voucher_award_id,
      has_assurance,
      assurance_rate,
      last_price,
      offer_ok,
      stock_qty,
      manage_stock,
      CASE WHEN offer_ok THEN catalog_minor ELSE coalesce(last_price, 0) END AS validated,
      (
        negotiated IS NOT NULL
        AND (
          NOT offer_ok
          OR negotiated <= 0
          OR negotiated >= catalog_minor
        )
      ) AS neg_invalid
    FROM line_checks
  )
  SELECT
    coalesce(jsonb_agg(line ORDER BY line_created, line_id), '[]'::jsonb),
    coalesce(sum(effective::bigint * quantity), 0),
    coalesce(sum(CASE WHEN available THEN 0 ELSE 1 END), 0)
  INTO v_lines, v_subtotal, v_unavailable
  FROM (
    SELECT
      line_created,
      line_id,
      quantity,
      CASE
        WHEN negotiated IS NOT NULL AND neg_status = 'accepted' AND NOT neg_invalid
        THEN negotiated
        ELSE validated
      END AS effective,
      (
        offer_ok
        AND (NOT manage_stock OR stock_qty >= quantity)
      ) AS available,
      jsonb_build_object(
        'id', line_id,
        'productId', product_id,
        'variantId', variant_id,
        'condition', condition,
        'options', coalesce(options, '{}'::jsonb),
        'quantity', quantity,
        'negotiatedUnitPriceMinor', negotiated,
        'negotiationStatus', neg_status,
        'negotiationInvalidated', neg_invalid,
        'voucherToken', voucher_token,
        'voucherAwardId', voucher_award_id,
        'hasAssurance', has_assurance,
        'assuranceRate', assurance_rate,
        'lastUnitPriceMinor', last_price,
        'validatedUnitPriceMinor', validated,
        'effectiveUnitPriceMinor',
          CASE
            WHEN negotiated IS NOT NULL AND neg_status = 'accepted' AND NOT neg_invalid
            THEN negotiated
            ELSE validated
          END,
        'priceChanged', validated IS DISTINCT FROM last_price,
        'available', offer_ok AND (NOT manage_stock OR stock_qty >= quantity),
        'unavailableReason',
          CASE
            WHEN NOT offer_ok THEN 'offer_invalid'
            WHEN manage_stock AND stock_qty <= 0 THEN 'out_of_stock'
            WHEN manage_stock AND stock_qty < quantity THEN 'insufficient_stock'
            ELSE NULL
          END,
        'stockQty', stock_qty,
        'manageStock', manage_stock
      ) AS line
    FROM enriched
  ) s;

  RETURN jsonb_build_object(
    'lines', v_lines,
    'estimates', jsonb_build_object(
      'subtotalMinor', v_subtotal,
      'currency', v_cart.currency,
      'lineCount', jsonb_array_length(v_lines),
      'unavailableCount', v_unavailable
    )
  );
END;
$$;
