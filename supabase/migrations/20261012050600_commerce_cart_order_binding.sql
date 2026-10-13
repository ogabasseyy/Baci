-- Checkout preparation and order binding for the shared server cart.
--
-- Two RPCs close the loop between review and order placement:
--
-- * commerce_cart_prepare_checkout mints (or reuses) a checkout session that
--   pins the reviewed cart version plus live validated prices, stock and
--   negotiation flags. The cart stays active and editable; the version pin
--   is what makes a later submit go stale.
-- * create_storefront_order_with_cart_binding submits one session exactly
--   once: it verifies the route order context, replays the stored receipt
--   for an already-submitted session, then calls the matching public
--   create_storefront_order* RPC and flips the cart to completed in the
--   same transaction.
--
-- Locking: prepare serializes on the operation advisory key plus the cart
-- row; submit serializes on the session row plus the cart row. Neither
-- path takes those locks in the opposite order, so concurrent prepares,
-- submits and line mutations cannot deadlock; concurrent submits on one
-- session collapse into a single inner order call with receipt replay.
-- Sessions are never superseded: an older generation simply goes stale
-- when the cart version moves, and expiry bounds the retry window.
-- Additive only.

CREATE TABLE IF NOT EXISTS public.commerce_cart_checkout_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL,
  cart_id uuid NOT NULL,
  checkout_generation integer NOT NULL CHECK (checkout_generation >= 1),
  cart_version_reviewed integer NOT NULL CHECK (cart_version_reviewed >= 1),
  principal_id text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'submitted')),
  order_id uuid NULL,
  result jsonb NULL,
  expires_at timestamptz NOT NULL,
  submitted_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cart_id, checkout_generation),
  FOREIGN KEY (merchant_id, cart_id)
    REFERENCES public.commerce_carts (merchant_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS commerce_cart_checkout_sessions_cart_status_idx
  ON public.commerce_cart_checkout_sessions (merchant_id, cart_id, status);

ALTER TABLE public.commerce_cart_checkout_sessions ENABLE ROW LEVEL SECURITY;

-- Checkout snapshot builder: live validated offers per line plus review
-- estimates. Owner-context helper with no EXECUTE grants; callable only
-- from the definer RPCs below, never via the API.
CREATE OR REPLACE FUNCTION public.commerce_cart_build_checkout_snapshot(
  p_merchant_id uuid, p_cart_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_cart public.commerce_carts%ROWTYPE;
  v_lines jsonb;
  v_subtotal integer;
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
    coalesce(sum(effective * quantity), 0),
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

REVOKE ALL ON FUNCTION public.commerce_cart_build_checkout_snapshot(uuid, uuid) FROM PUBLIC;

-- Review preparation: idempotent session mint-or-reuse plus a validated
-- checkout snapshot. Same claims, grant and idempotency envelope as
-- commerce_cart_mutate; version drift answers refresh_required.
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

-- Bound submission: exactly one order per checkout session. Verifies the
-- signed route order context (or a trusted service caller), replays the
-- stored receipt for an already-submitted session, then runs the matching
-- public order RPC and closes the cart in the same transaction. Stale,
-- expired and cross-merchant submits fail before any order side effect.
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
  IF NOT coalesce(
    v_role = 'service_role'
    OR (v_role = 'authenticated' AND v_context = 'route' AND v_claim_merchant IS NOT NULL)
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
  -- conflicting contexts fail closed. Service callers present no
  -- context, so only the args merchant binds them.
  IF v_session.merchant_id IS DISTINCT FROM v_merchant
    OR (v_role <> 'service_role' AND v_context = 'route'
      AND v_claim_merchant IS DISTINCT FROM v_session.merchant_id)
    OR (v_role <> 'service_role' AND v_agentic_context = 'checkout'
      AND v_agentic_merchant IS DISTINCT FROM v_session.merchant_id) THEN
    RAISE EXCEPTION 'cart_order_merchant_mismatch' USING ERRCODE = 'P0001';
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

  v_email := p_args ->> 'p_customer_email';
  v_name := p_args ->> 'p_customer_name';
  v_items := p_args -> 'p_items';
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

  -- The receipt order mirrors the inner row in snake_case so route and
  -- dispatch continuations read it like a direct RPC row.
  -- `idempotency_replayed` tracks the binding: a replayed binding never
  -- created a new order, whatever the inner RPC reported.
  v_result := jsonb_build_object('ok', true, 'code', null, 'replayed', false,
    'order', jsonb_build_object(
      'id', v_order.id,
      'order_number', v_order.order_number,
      'tracking_token', v_order.tracking_token,
      'subtotal', v_order.subtotal,
      'shipping_fee', v_order.shipping_fee,
      'discount_amount', v_order.discount_amount,
      'tax_amount', v_order.tax_amount,
      'total', v_order.total,
      'customer_id', v_order.customer_id,
      'customer_email', v_order.customer_email,
      'customer_name', v_order.customer_name,
      'customer_phone', v_order.customer_phone,
      'payment_status', v_order.payment_status,
      'shipping_status', v_order.shipping_status,
      'payment_method', v_order.payment_method,
      'shipping_address', v_order.shipping_address,
      'merchant_id', v_order.merchant_id,
      'tax_basis', v_order.tax_basis,
      'gift_wrapping_fee', v_order.gift_wrapping_fee,
      'idempotency_replayed', false
    ),
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

REVOKE ALL ON FUNCTION public.commerce_cart_prepare_checkout(uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commerce_cart_prepare_checkout(uuid, integer, text)
  TO commerce_cart_shopper, service_role;

-- The binding is callable where the order RPCs are; the signed route
-- context (or a trusted service caller) is enforced inside.
REVOKE ALL ON FUNCTION public.create_storefront_order_with_cart_binding(text, uuid, integer, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_storefront_order_with_cart_binding(text, uuid, integer, jsonb)
  TO anon, authenticated, service_role;

-- Bounded retention for checkout sessions: unsubmitted sessions go one
-- day after expiry, submitted receipts after 90 days.
CREATE OR REPLACE FUNCTION public.cleanup_commerce_carts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.commerce_cart_operations WHERE expires_at < now();
  DELETE FROM public.commerce_cart_creation_requests WHERE expires_at < now();
  DELETE FROM public.commerce_cart_events WHERE expires_at < now();
  DELETE FROM public.commerce_cart_handoffs WHERE expires_at < now() - interval '1 day';
  DELETE FROM public.commerce_cart_checkout_sessions
  WHERE (status = 'submitted' AND submitted_at < now() - interval '90 days')
    OR (status <> 'submitted' AND expires_at < now() - interval '1 day');
  UPDATE public.commerce_carts
  SET state = 'expired', updated_at = now()
  WHERE state = 'active' AND expires_at < now() AND checkout_session_id IS NULL;
END;
$$;
