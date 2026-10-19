-- Correct final installed cart writers without changing the public permission wrapper.
-- Minor units cover the full catalog numeric range; quantities/versions stay int.
ALTER TABLE public.commerce_cart_lines ALTER COLUMN last_unit_price_minor TYPE bigint;
ALTER TABLE public.commerce_cart_lines ALTER COLUMN negotiated_unit_price_minor TYPE bigint;
DROP FUNCTION public.commerce_cart_parse_input_line(jsonb);
DROP FUNCTION public.commerce_cart_offer_price_minor(uuid,uuid,uuid);
DROP FUNCTION public.commerce_cart_negotiation_auto_accepts(uuid,uuid,uuid,integer);
DROP FUNCTION public.commerce_cart_negotiation_status(uuid,uuid,uuid,integer,text);
CREATE OR REPLACE FUNCTION public.commerce_cart_parse_input_line(p_line jsonb)
RETURNS TABLE (
  pi_product uuid, pi_variant uuid, pi_condition text, pi_options jsonb,
  pi_quantity integer, pi_voucher_token text, pi_voucher_award text,
  pi_negotiated bigint, pi_neg_status text
)
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $$
DECLARE
  v_item jsonb;
  v_text text;
BEGIN
  pi_product := NULL; pi_variant := NULL; pi_condition := NULL;
  pi_options := '{}'::jsonb; pi_quantity := NULL; pi_voucher_token := NULL;
  pi_voucher_award := NULL; pi_negotiated := NULL; pi_neg_status := NULL;
  IF jsonb_typeof(p_line) <> 'object' THEN RETURN NEXT; RETURN; END IF;
  IF p_line ? 'hasAssurance' AND jsonb_typeof(p_line->'hasAssurance') <> 'boolean' THEN RETURN NEXT; RETURN; END IF;
  v_item := p_line -> 'item';
  IF jsonb_typeof(v_item) <> 'object' THEN RETURN NEXT; RETURN; END IF;
  v_text := v_item ->> 'productId';
  IF v_text IS NULL OR v_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN RETURN NEXT; RETURN; END IF;
  pi_product := v_text::uuid;
  v_text := v_item ->> 'variantId';
  IF v_text IS NOT NULL THEN
    IF v_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN pi_product := NULL; RETURN NEXT; RETURN; END IF;
    pi_variant := v_text::uuid;
  END IF;
  v_text := v_item ->> 'condition';
  IF v_text IS NOT NULL THEN
    IF v_text NOT IN ('new', 'used', 'open_box', 'refurbished') THEN pi_product := NULL; RETURN NEXT; RETURN; END IF;
    pi_condition := v_text;
  END IF;
  IF (v_item -> 'options') IS NOT NULL THEN
    IF jsonb_typeof(v_item -> 'options') <> 'object' THEN pi_product := NULL; RETURN NEXT; RETURN; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_each(v_item -> 'options') e WHERE jsonb_typeof(e.value) <> 'string') THEN
      pi_product := NULL; RETURN NEXT; RETURN;
    END IF;
    pi_options := v_item -> 'options';
  END IF;
  v_text := p_line ->> 'quantity';
  IF v_text IS NULL OR v_text !~ '^[0-9]+$' THEN pi_product := NULL; RETURN NEXT; RETURN; END IF;
  pi_quantity := v_text::integer;
  IF pi_quantity < 1 OR pi_quantity > 10 THEN pi_product := NULL; RETURN NEXT; RETURN; END IF;
  v_text := nullif(trim(coalesce(p_line ->> 'voucherToken', '')), '');
  IF (p_line ->> 'voucherToken') IS NOT NULL AND v_text IS NULL THEN pi_product := NULL; RETURN NEXT; RETURN; END IF;
  IF v_text IS NOT NULL AND length(v_text) > 512 THEN pi_product := NULL; RETURN NEXT; RETURN; END IF;
  pi_voucher_token := v_text;
  v_text := p_line ->> 'voucherAwardId';
  IF v_text IS NOT NULL THEN
    IF v_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN pi_product := NULL; RETURN NEXT; RETURN; END IF;
    pi_voucher_award := v_text;
  END IF;
  v_text := p_line ->> 'negotiatedUnitPriceMinor';
  IF v_text IS NOT NULL THEN
    IF v_text !~ '^[0-9]+$' OR v_text::bigint <= 0 THEN pi_product := NULL; RETURN NEXT; RETURN; END IF;
    pi_negotiated := v_text::bigint;
  END IF;
  v_text := p_line ->> 'negotiationStatus';
  IF v_text IS NOT NULL THEN
    IF v_text NOT IN ('pending', 'accepted', 'rejected') THEN pi_product := NULL; RETURN NEXT; RETURN; END IF;
    pi_neg_status := v_text;
  END IF;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.commerce_cart_offer_price_minor(
  p_merchant_id uuid, p_product_id uuid, p_variant_id uuid
) RETURNS bigint
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  v_price bigint;
BEGIN
  SELECT (round(coalesce(v.price_override, p.price, 0) * 100))::bigint INTO v_price
  FROM public.products p
  LEFT JOIN public.product_variants v
    ON v.id = p_variant_id AND v.product_id = p_product_id AND v.merchant_id = p_merchant_id
  WHERE p.id = p_product_id AND p.merchant_id = p_merchant_id AND p.status = 'active'
    AND (p_variant_id IS NULL OR v.id IS NOT NULL);
  RETURN coalesce(v_price, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.commerce_cart_require_offer(
  p_merchant_id uuid, p_product_id uuid, p_variant_id uuid
) RETURNS void
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  v_ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = p_product_id AND p.merchant_id = p_merchant_id AND p.status = 'active'
      AND (
        p_variant_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.product_variants v
          WHERE v.id = p_variant_id AND v.product_id = p_product_id AND v.merchant_id = p_merchant_id
            AND coalesce(v.is_active,true) AND v.status='active'
            AND v.deleted_at IS NULL AND v.archived_at IS NULL
            AND NOT coalesce((to_jsonb(v)->>'is_inventory_anchor')::boolean,false)
            AND NOT (coalesce(p.has_variants,false) AND coalesce(v.is_default,false))
        )
      )
  ) INTO v_ok;
  IF NOT coalesce(v_ok, false) THEN
    RAISE EXCEPTION 'invalid_offer' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- The current order RPC charges/decrements product or variant pools. Separate
-- condition offers cannot be purchased safely through that contract yet.
CREATE OR REPLACE FUNCTION public.commerce_cart_condition_supported(
 p_merchant_id uuid,p_product_id uuid,p_variant_id uuid,p_condition text
) RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT p_variant_id IS NOT NULL OR p_condition IS NULL OR EXISTS(
  SELECT 1 FROM public.products p
  WHERE p.id=p_product_id AND p.merchant_id=p_merchant_id
   AND discovery.canonical_product_condition(coalesce(to_jsonb(p)->>'condition','new'))=discovery.canonical_product_condition(p_condition)
   AND NOT EXISTS(SELECT 1 FROM public.product_offers offer WHERE offer.product_id=p.id AND offer.merchant_id=p.merchant_id
    AND discovery.canonical_product_condition(offer.condition)=discovery.canonical_product_condition(p_condition))
 );
$$;
REVOKE ALL ON FUNCTION public.commerce_cart_condition_supported(uuid,uuid,uuid,text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.commerce_cart_require_offer(
 p_merchant_id uuid,p_product_id uuid,p_variant_id uuid,p_condition text
) RETURNS void LANGUAGE plpgsql STABLE SET search_path='' AS $$
BEGIN
 PERFORM public.commerce_cart_require_offer(p_merchant_id,p_product_id,p_variant_id);
 IF NOT public.commerce_cart_condition_supported(p_merchant_id,p_product_id,p_variant_id,p_condition) THEN RAISE EXCEPTION 'invalid_offer' USING ERRCODE='P0001'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.commerce_cart_require_offer(uuid,uuid,uuid,text) FROM PUBLIC;


CREATE OR REPLACE FUNCTION public.commerce_cart_negotiation_auto_accepts(
  p_merchant_id uuid, p_product_id uuid, p_variant_id uuid, p_negotiated bigint
) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  v_catalog bigint;
BEGIN
  IF p_negotiated IS NULL THEN RETURN false; END IF;
  v_catalog := public.commerce_cart_offer_price_minor(p_merchant_id, p_product_id, p_variant_id);
  IF v_catalog <= 0 OR p_negotiated < 1 OR p_negotiated >= v_catalog THEN
    RETURN false;
  END IF;
  IF NOT public.commerce_cart_product_negotiable(p_merchant_id, p_product_id) THEN
    RETURN false;
  END IF;
  RETURN (v_catalog - p_negotiated)::bigint * 100 <= v_catalog::bigint * 2;
END;
$$;

CREATE OR REPLACE FUNCTION public.commerce_cart_negotiation_status(
  p_merchant_id uuid, p_product_id uuid, p_variant_id uuid,
  p_negotiated bigint, p_requested text
) RETURNS text
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
BEGIN
  IF p_negotiated IS NULL THEN RETURN p_requested; END IF;
  IF NOT public.commerce_cart_negotiation_auto_accepts(
    p_merchant_id, p_product_id, p_variant_id, p_negotiated
  ) THEN
    RETURN 'pending';
  END IF;
  RETURN coalesce(p_requested, 'accepted');
END;
$$;

CREATE OR REPLACE FUNCTION public.commerce_cart_assemble_state(
  p_merchant_id uuid, p_cart_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_cart public.commerce_carts%ROWTYPE;
  v_lines jsonb;
BEGIN
  SELECT * INTO v_cart
  FROM public.commerce_carts
  WHERE id = p_cart_id AND merchant_id = p_merchant_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(jsonb_agg(line ORDER BY line_created, line_id), '[]'::jsonb)
  INTO v_lines
  FROM (
    SELECT
      l.id AS line_id,
      l.created_at AS line_created,
      jsonb_build_object(
        'id', l.id,
        'productId', l.product_id,
        'variantId', l.variant_id,
        'condition', l.condition,
        'options', coalesce(l.options, '{}'::jsonb),
        'quantity', l.quantity,
        'negotiatedUnitPriceMinor', l.negotiated_unit_price_minor,
        'negotiationStatus', l.negotiation_status,
        'negotiationInvalidated',
          l.negotiated_unit_price_minor IS NOT NULL
          AND (
            NOT (
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
            )
            OR l.negotiated_unit_price_minor <= 0
            OR l.negotiated_unit_price_minor >= (
              SELECT (round(coalesce(v2.price_override, p2.price, 0) * 100))::bigint
              FROM public.products p2
              LEFT JOIN public.product_variants v2 ON v2.id = l.variant_id
              WHERE p2.id = l.product_id
            )
          ),
        'voucherToken', l.voucher_token,
        'voucherAwardId', l.voucher_award_id,
        'hasAssurance', l.has_assurance,
        'assuranceRate', l.assurance_rate,
        'unitPriceMinor',
          CASE
            WHEN p.id IS NOT NULL
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
            THEN (round(coalesce(v.price_override, p.price, 0) * 100))::bigint
            ELSE coalesce(l.last_unit_price_minor, 0)
          END,
        'available',
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
          ),
        'stockQty',
          CASE
            WHEN p.stock_quantity IS NULL THEN greatest(coalesce(p.stock, 0), 0)
            WHEN p.stock_quantity = 0 AND coalesce(p.stock, 0) > 0 THEN p.stock
            ELSE greatest(p.stock_quantity, 0)
          END,
        'manageStock', coalesce(p.manage_stock, true)
      ) AS line
    FROM public.commerce_cart_lines l
    LEFT JOIN public.products p ON p.id = l.product_id
    LEFT JOIN public.product_variants v ON v.id = l.variant_id
    WHERE l.merchant_id = p_merchant_id AND l.cart_id = p_cart_id
  ) s;

  RETURN jsonb_build_object(
    'cartId', v_cart.id,
    'merchantId', v_cart.merchant_id,
    'state', v_cart.state,
    'version', v_cart.version,
    'lines', v_lines,
    'currency', v_cart.currency,
    'expiresAt', to_char(v_cart.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'checkoutSessionId', v_cart.checkout_session_id,
    'replayed', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.commerce_cart_mutate_authorized_impl(
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
  v_negotiated bigint;
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
    PERFORM public.commerce_cart_require_offer(v_merchant, v_product_id, v_variant_id, v_condition);
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
        last_unit_price_minor, has_assurance, assurance_rate
      ) VALUES (
        v_merchant, p_cart_id, v_product_id, v_variant_id, v_condition, v_options,
        CASE WHEN v_voucher_token IS NOT NULL OR v_voucher_award IS NOT NULL THEN 1 ELSE v_quantity END,
        v_negotiated, public.commerce_cart_negotiation_status(v_merchant, v_product_id, v_variant_id, v_negotiated, v_neg_status),
        v_voucher_token, v_voucher_award::uuid,
        public.commerce_cart_offer_price_minor(v_merchant, v_product_id, v_variant_id), coalesce((p_command->>'hasAssurance')::boolean,false), CASE WHEN coalesce((p_command->>'hasAssurance')::boolean,false) THEN 0.05 ELSE NULL END
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
        PERFORM public.commerce_cart_require_offer(v_merchant, v_line.product_id, v_line.variant_id, v_line.condition);
      END IF;
      UPDATE public.commerce_cart_lines
      SET quantity = v_quantity,
        last_unit_price_minor = CASE WHEN v_quantity > v_line.quantity THEN public.commerce_cart_offer_price_minor(v_merchant, v_line.product_id, v_line.variant_id) ELSE v_line.last_unit_price_minor END,
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
    v_negotiated := (p_command ->> 'negotiatedUnitPriceMinor')::bigint;
    IF v_negotiated IS NOT NULL THEN
      -- A negotiated price is a live-offer discount in place: the line,
      -- its quantity and its identity never move, so a failed or
      -- interrupted reprice cannot lose the item.
      PERFORM public.commerce_cart_require_offer(v_merchant, v_line.product_id, v_line.variant_id, v_line.condition);
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
        negotiation_status = CASE WHEN v_negotiated IS NULL THEN NULL
        WHEN public.commerce_cart_negotiation_auto_accepts(v_merchant, v_line.product_id, v_line.variant_id, v_negotiated) THEN 'accepted'
        ELSE 'pending' END,
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
      negotiated bigint, neg_status text, assurance boolean
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
      PERFORM public.commerce_cart_require_offer(v_merchant, v_product_id, v_variant_id, v_condition);
      IF EXISTS (
        SELECT 1 FROM cart_replace_want w
        WHERE w.product_id = v_product_id
          AND w.variant_id IS NOT DISTINCT FROM v_variant_id
          AND w.condition IS NOT DISTINCT FROM v_condition
          AND w.options = v_options
          AND w.voucher_token IS NOT DISTINCT FROM v_voucher_token
          AND w.voucher_award IS NOT DISTINCT FROM v_voucher_award::uuid
      ) THEN
        IF v_voucher_token IS NOT NULL OR v_voucher_award IS NOT NULL THEN
          RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
        END IF;
        UPDATE cart_replace_want w
        SET quantity = w.quantity + v_quantity, assurance=w.assurance OR coalesce((v_entry->>'hasAssurance')::boolean,false)
        WHERE w.product_id = v_product_id
          AND w.variant_id IS NOT DISTINCT FROM v_variant_id
          AND w.condition IS NOT DISTINCT FROM v_condition
          AND w.options = v_options
          AND w.voucher_token IS NOT DISTINCT FROM v_voucher_token
          AND w.voucher_award IS NOT DISTINCT FROM v_voucher_award::uuid;
        IF EXISTS (SELECT 1 FROM cart_replace_want w WHERE w.quantity > 10) THEN
          RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
        END IF;
      ELSE
        INSERT INTO cart_replace_want VALUES (
          v_product_id, v_variant_id, v_condition, v_options,
          CASE WHEN v_voucher_token IS NOT NULL OR v_voucher_award IS NOT NULL THEN 1 ELSE v_quantity END,
          v_voucher_token, v_voucher_award::uuid, v_negotiated,
          public.commerce_cart_negotiation_status(v_merchant, v_product_id, v_variant_id, v_negotiated, v_neg_status), coalesce((v_entry->>'hasAssurance')::boolean,false)
        );
      END IF;
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
    SET quantity = w.quantity, has_assurance=w.assurance, assurance_rate=CASE WHEN w.assurance THEN 0.05 ELSE NULL END,
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
        OR l.has_assurance IS DISTINCT FROM w.assurance
        OR l.negotiation_status IS DISTINCT FROM w.neg_status
      );
    IF FOUND THEN v_changed := true; END IF;
    INSERT INTO public.commerce_cart_lines (
      merchant_id, cart_id, product_id, variant_id, condition, options, quantity,
      negotiated_unit_price_minor, negotiation_status, voucher_token, voucher_award_id,
      last_unit_price_minor, has_assurance, assurance_rate
    )
    SELECT v_merchant, p_cart_id, w.product_id, w.variant_id, w.condition, w.options,
      w.quantity, w.negotiated, w.neg_status, w.voucher_token, w.voucher_award,
      public.commerce_cart_offer_price_minor(v_merchant, w.product_id, w.variant_id), w.assurance, CASE WHEN w.assurance THEN 0.05 ELSE NULL END
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
    -- Sliding renewal is capped at the absolute 7-day lifetime from
    -- creation, matching checkout preparation: mutations must not keep
    -- a guest cart (and its stored voucher credentials) alive forever.
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

CREATE OR REPLACE FUNCTION public.commerce_cart_create_device_impl(
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
  v_negotiated bigint;
  v_neg_status text;
  v_line_count integer;
  v_staged public.commerce_cart_lines%ROWTYPE;
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
  SELECT CASE WHEN upper(trim(to_jsonb(m)->>'payout_currency')) ~ '^[A-Z]{3}$' THEN upper(trim(to_jsonb(m)->>'payout_currency')) ELSE CASE upper(trim(to_jsonb(m)->>'country')) WHEN 'US' THEN 'USD' WHEN 'NG' THEN 'NGN' WHEN 'GB' THEN 'GBP' WHEN 'CA' THEN 'CAD' WHEN 'AU' THEN 'AUD' WHEN 'DE' THEN 'EUR' WHEN 'FR' THEN 'EUR' WHEN 'JP' THEN 'JPY' WHEN 'IN' THEN 'INR' WHEN 'BR' THEN 'BRL' WHEN 'ZA' THEN 'ZAR' WHEN 'AE' THEN 'AED' WHEN 'KE' THEN 'KES' WHEN 'GH' THEN 'GHS' WHEN 'EG' THEN 'EGP' WHEN 'CM' THEN 'XAF' WHEN 'CI' THEN 'XOF' WHEN 'SN' THEN 'XOF' WHEN 'BF' THEN 'XOF' WHEN 'RW' THEN 'RWF' WHEN 'TZ' THEN 'TZS' WHEN 'UG' THEN 'UGX' WHEN 'UNITED STATES' THEN 'USD' WHEN 'NIGERIA' THEN 'NGN' WHEN 'UNITED KINGDOM' THEN 'GBP' WHEN 'CANADA' THEN 'CAD' WHEN 'AUSTRALIA' THEN 'AUD' WHEN 'GERMANY' THEN 'EUR' WHEN 'FRANCE' THEN 'EUR' WHEN 'JAPAN' THEN 'JPY' WHEN 'INDIA' THEN 'INR' WHEN 'BRAZIL' THEN 'BRL' WHEN 'SOUTH AFRICA' THEN 'ZAR' WHEN 'UNITED ARAB EMIRATES' THEN 'AED' WHEN 'KENYA' THEN 'KES' WHEN 'GHANA' THEN 'GHS' WHEN 'EGYPT' THEN 'EGP' WHEN 'CAMEROON' THEN 'XAF' WHEN 'SENEGAL' THEN 'XOF' WHEN 'BURKINA FASO' THEN 'XOF' WHEN 'RWANDA' THEN 'RWF' WHEN 'TANZANIA' THEN 'TZS' WHEN 'UGANDA' THEN 'UGX' ELSE 'NGN' END END INTO p_currency FROM public.merchants m WHERE m.id=v_merchant;
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
    PERFORM public.commerce_cart_require_offer(v_merchant, v_product_id, v_variant_id, v_condition);
    -- Repeated identities merge exactly like `add`: one logical line,
    -- summed quantity within the per-line cap; voucher lines never merge.
    SELECT * INTO v_staged
    FROM public.commerce_cart_lines
    WHERE merchant_id = v_merchant AND cart_id = v_cart_id
      AND product_id = v_product_id
      AND variant_id IS NOT DISTINCT FROM v_variant_id
      AND condition IS NOT DISTINCT FROM v_condition
      AND options = v_options
      AND voucher_token IS NOT DISTINCT FROM v_voucher_token
      AND voucher_award_id IS NOT DISTINCT FROM
        (CASE WHEN v_voucher_award IS NULL THEN NULL ELSE v_voucher_award::uuid END);
    IF FOUND THEN
      IF v_staged.voucher_token IS NOT NULL OR v_staged.voucher_award_id IS NOT NULL
        OR v_staged.quantity + v_quantity > 10 THEN
        RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
      END IF;
      UPDATE public.commerce_cart_lines
      SET quantity = quantity + v_quantity, has_assurance=has_assurance OR coalesce((v_line->>'hasAssurance')::boolean,false), assurance_rate=CASE WHEN has_assurance OR coalesce((v_line->>'hasAssurance')::boolean,false) THEN 0.05 ELSE NULL END, updated_at = now()
      WHERE id = v_staged.id;
    ELSE
      INSERT INTO public.commerce_cart_lines (
        merchant_id, cart_id, product_id, variant_id, condition, options, quantity,
        negotiated_unit_price_minor, negotiation_status, voucher_token, voucher_award_id,
        last_unit_price_minor, has_assurance, assurance_rate
      ) VALUES (
        v_merchant, v_cart_id, v_product_id, v_variant_id, v_condition, v_options,
        CASE WHEN v_voucher_token IS NOT NULL OR v_voucher_award IS NOT NULL THEN 1 ELSE v_quantity END,
        v_negotiated, public.commerce_cart_negotiation_status(v_merchant, v_product_id, v_variant_id, v_negotiated, v_neg_status),
        v_voucher_token, CASE WHEN v_voucher_award IS NULL THEN NULL ELSE v_voucher_award::uuid END,
        public.commerce_cart_offer_price_minor(v_merchant, v_product_id, v_variant_id), coalesce((v_line->>'hasAssurance')::boolean,false), CASE WHEN coalesce((v_line->>'hasAssurance')::boolean,false) THEN 0.05 ELSE NULL END
      );
    END IF;
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

CREATE OR REPLACE FUNCTION public.commerce_cart_migrate_legacy(
  p_provider text, p_legacy_token_hash text, p_operation_id text,
  p_lines jsonb, p_legacy_version text, p_currency text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_claims jsonb := auth.jwt();
  v_merchant uuid;
  v_principal text;
  v_digest text;
  v_ref public.commerce_cart_legacy_refs%ROWTYPE;
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
  v_negotiated bigint;
  v_neg_status text;
  v_grant_live boolean;
  v_grant_known boolean;
  v_other_cart uuid;
  v_legacy_version_int bigint;
  v_legacy_updated timestamptz;
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

  SELECT CASE WHEN upper(trim(to_jsonb(m)->>'payout_currency')) ~ '^[A-Z]{3}$' THEN upper(trim(to_jsonb(m)->>'payout_currency')) ELSE CASE upper(trim(to_jsonb(m)->>'country')) WHEN 'US' THEN 'USD' WHEN 'NG' THEN 'NGN' WHEN 'GB' THEN 'GBP' WHEN 'CA' THEN 'CAD' WHEN 'AU' THEN 'AUD' WHEN 'DE' THEN 'EUR' WHEN 'FR' THEN 'EUR' WHEN 'JP' THEN 'JPY' WHEN 'IN' THEN 'INR' WHEN 'BR' THEN 'BRL' WHEN 'ZA' THEN 'ZAR' WHEN 'AE' THEN 'AED' WHEN 'KE' THEN 'KES' WHEN 'GH' THEN 'GHS' WHEN 'EG' THEN 'EGP' WHEN 'CM' THEN 'XAF' WHEN 'CI' THEN 'XOF' WHEN 'SN' THEN 'XOF' WHEN 'BF' THEN 'XOF' WHEN 'RW' THEN 'RWF' WHEN 'TZ' THEN 'TZS' WHEN 'UG' THEN 'UGX' WHEN 'UNITED STATES' THEN 'USD' WHEN 'NIGERIA' THEN 'NGN' WHEN 'UNITED KINGDOM' THEN 'GBP' WHEN 'CANADA' THEN 'CAD' WHEN 'AUSTRALIA' THEN 'AUD' WHEN 'GERMANY' THEN 'EUR' WHEN 'FRANCE' THEN 'EUR' WHEN 'JAPAN' THEN 'JPY' WHEN 'INDIA' THEN 'INR' WHEN 'BRAZIL' THEN 'BRL' WHEN 'SOUTH AFRICA' THEN 'ZAR' WHEN 'UNITED ARAB EMIRATES' THEN 'AED' WHEN 'KENYA' THEN 'KES' WHEN 'GHANA' THEN 'GHS' WHEN 'EGYPT' THEN 'EGP' WHEN 'CAMEROON' THEN 'XAF' WHEN 'SENEGAL' THEN 'XOF' WHEN 'BURKINA FASO' THEN 'XOF' WHEN 'RWANDA' THEN 'RWF' WHEN 'TANZANIA' THEN 'TZS' WHEN 'UGANDA' THEN 'UGX' ELSE 'NGN' END END INTO p_currency FROM public.merchants m WHERE m.id=v_merchant;
  -- Pilot gate (defense in depth with the route-level check): the
  -- shared-cart RPCs refuse merchants without the shared_cart feature,
  -- mirroring the broadcast/account predicates.
  IF NOT EXISTS (
    SELECT 1 FROM public.merchants m
    WHERE m.id = v_merchant AND m.premium_features @> '["shared_cart"]'::jsonb
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'merchant_unavailable', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;

  IF p_provider NOT IN ('mcp', 'ucp')
    OR p_legacy_token_hash IS NULL
    OR p_legacy_token_hash !~ '^[a-f0-9]{64}$'
    OR p_operation_id IS NULL OR length(trim(p_operation_id)) = 0 OR length(p_operation_id) > 128
    OR p_currency IS NULL OR p_currency !~ '^[A-Z]{3}$'
    OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) > 20
    OR p_legacy_version IS NULL OR length(trim(p_legacy_version)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cc-legacy|' || v_merchant::text || '|' || p_provider || '|' || p_legacy_token_hash, 0)
  );

  SELECT * INTO v_ref
  FROM public.commerce_cart_legacy_refs
  WHERE merchant_id = v_merchant AND provider = p_provider AND legacy_hash = p_legacy_token_hash;
  IF FOUND THEN
    SELECT EXISTS (
      SELECT 1 FROM public.commerce_cart_grants g
      WHERE g.cart_id = v_ref.cart_id AND g.merchant_id = v_merchant
        AND g.principal_id = v_principal AND g.expires_at > now() AND g.revoked_at IS NULL
    ) INTO v_grant_live;
    IF NOT coalesce(v_grant_live, false) THEN
      SELECT EXISTS (
        SELECT 1 FROM public.commerce_cart_grants g
        WHERE g.cart_id = v_ref.cart_id AND g.principal_id = v_principal
      ) INTO v_grant_known;
      IF coalesce(v_grant_known, false) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'expired', 'replayed', false, 'state', null, 'currentVersion', null);
      END IF;
      RETURN jsonb_build_object('ok', false, 'code', 'unauthorized', 'replayed', false, 'state', null, 'currentVersion', null);
    END IF;
    SELECT public.commerce_cart_assemble_state(v_merchant, v_ref.cart_id) INTO v_state;
    IF v_state IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'expired', 'replayed', false, 'state', null, 'currentVersion', null);
    END IF;
    RETURN jsonb_build_object('ok', true, 'code', null, 'replayed', true, 'state', v_state,
      'currentVersion', (v_state ->> 'version')::integer);
  END IF;

  SELECT r.cart_id INTO v_other_cart
  FROM public.commerce_cart_legacy_refs r
  JOIN public.commerce_cart_grants g
    ON g.cart_id = r.cart_id AND g.merchant_id = r.merchant_id
  WHERE r.merchant_id = v_merchant
    AND g.principal_id = v_principal
    AND g.expires_at > now() AND g.revoked_at IS NULL
    AND (r.provider, r.legacy_hash) <> (p_provider, p_legacy_token_hash)
  LIMIT 1;
  IF v_other_cart IS NOT NULL THEN
    SELECT public.commerce_cart_assemble_state(v_merchant, v_other_cart) INTO v_state;
    RETURN jsonb_build_object('ok', false, 'code', 'refresh_required', 'replayed', false,
      'state', v_state, 'currentVersion',
      CASE WHEN v_state IS NULL THEN NULL ELSE (v_state ->> 'version')::integer END);
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'cart_migrate_want' AND n.nspname LIKE 'pg_temp%'
  ) THEN
    DROP TABLE cart_migrate_want;
  END IF;
  CREATE TEMPORARY TABLE cart_migrate_want (
    product_id uuid, variant_id uuid, condition text, options jsonb,
    quantity integer, voucher_token text, voucher_award uuid,
    negotiated bigint, neg_status text, assurance boolean
  ) ON COMMIT DROP;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) value LOOP
    SELECT pi_product, pi_variant, pi_condition, pi_options, pi_quantity,
      pi_voucher_token, pi_voucher_award, pi_negotiated, pi_neg_status
    INTO v_product_id, v_variant_id, v_condition, v_options, v_quantity,
      v_voucher_token, v_voucher_award, v_negotiated, v_neg_status
    FROM public.commerce_cart_parse_input_line(v_line);
    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
    END IF;
    PERFORM public.commerce_cart_require_offer(v_merchant, v_product_id, v_variant_id, v_condition);
    UPDATE cart_migrate_want w
    SET quantity = w.quantity + v_quantity, assurance=w.assurance OR coalesce((v_line->>'hasAssurance')::boolean,false)
    WHERE w.product_id = v_product_id
      AND w.variant_id IS NOT DISTINCT FROM v_variant_id
      AND w.condition IS NOT DISTINCT FROM v_condition
      AND w.options = v_options
      AND w.voucher_token IS NOT DISTINCT FROM v_voucher_token
      AND w.voucher_award IS NOT DISTINCT FROM v_voucher_award::uuid;
    IF NOT FOUND THEN
      INSERT INTO cart_migrate_want VALUES (
        v_product_id, v_variant_id, v_condition, v_options, v_quantity,
        v_voucher_token, v_voucher_award::uuid, v_negotiated,
        public.commerce_cart_negotiation_status(v_merchant, v_product_id, v_variant_id, v_negotiated, v_neg_status), coalesce((v_line->>'hasAssurance')::boolean,false)
      );
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM cart_migrate_want WHERE quantity > 10) THEN
    RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_legacy_version_int FROM cart_migrate_want;
  IF v_legacy_version_int > 20 THEN
    RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
  END IF;

  v_cart_id := pg_catalog.gen_random_uuid();
  IF p_provider = 'mcp' THEN
    IF p_legacy_version !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.mcp_guest_carts
    SET migrated_to_cart_id = v_cart_id
    WHERE token_hash = p_legacy_token_hash
      AND migrated_to_cart_id IS NULL
      AND version = p_legacy_version::bigint;
    IF NOT FOUND THEN
      PERFORM 1 FROM public.mcp_guest_carts WHERE token_hash = p_legacy_token_hash;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'not_found', 'replayed', false, 'state', null, 'currentVersion', null);
      END IF;
      RETURN jsonb_build_object('ok', false, 'code', 'refresh_required', 'replayed', false, 'state', null, 'currentVersion', null);
    END IF;
  ELSE
    BEGIN
      v_legacy_updated := p_legacy_version::timestamptz;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
    END;
    UPDATE public.agentic_cart_sessions
    SET migrated_to_cart_id = v_cart_id
    WHERE cart_id_hash = p_legacy_token_hash
      AND migrated_to_cart_id IS NULL
      AND updated_at = v_legacy_updated;
    IF NOT FOUND THEN
      PERFORM 1 FROM public.agentic_cart_sessions WHERE cart_id_hash = p_legacy_token_hash;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'not_found', 'replayed', false, 'state', null, 'currentVersion', null);
      END IF;
      RETURN jsonb_build_object('ok', false, 'code', 'refresh_required', 'replayed', false, 'state', null, 'currentVersion', null);
    END IF;
  END IF;

  INSERT INTO public.commerce_carts (id, merchant_id, currency, version, state, expires_at)
  VALUES (v_cart_id, v_merchant, p_currency, 1, 'active', now() + interval '7 days');

  v_grant_id := pg_catalog.gen_random_uuid();
  INSERT INTO public.commerce_cart_grants (id, merchant_id, cart_id, principal_id, principal_type, expires_at)
  VALUES (v_grant_id, v_merchant, v_cart_id, v_principal, 'guest', now() + interval '7 days');

  INSERT INTO public.commerce_cart_lines (
    merchant_id, cart_id, product_id, variant_id, condition, options, quantity,
    negotiated_unit_price_minor, negotiation_status, voucher_token, voucher_award_id,
    last_unit_price_minor, has_assurance, assurance_rate
  )
  SELECT v_merchant, v_cart_id, w.product_id, w.variant_id, w.condition, w.options,
    CASE WHEN w.voucher_token IS NOT NULL OR w.voucher_award IS NOT NULL THEN 1 ELSE w.quantity END,
    w.negotiated, w.neg_status, w.voucher_token, w.voucher_award,
    public.commerce_cart_offer_price_minor(v_merchant, w.product_id, w.variant_id), w.assurance, CASE WHEN w.assurance THEN 0.05 ELSE NULL END
  FROM cart_migrate_want w;
  DROP TABLE cart_migrate_want;

  v_digest := pg_catalog.md5(p_provider || '|' || p_legacy_token_hash || '|' || p_lines::text || '|' || p_currency);
  INSERT INTO public.commerce_cart_legacy_refs (merchant_id, provider, legacy_hash, cart_id, receipt)
  VALUES (v_merchant, p_provider, p_legacy_token_hash, v_cart_id,
    jsonb_build_object('operation_id', p_operation_id, 'digest', v_digest,
      'legacy_version', p_legacy_version, 'migrated_at', now()));

  SELECT public.commerce_cart_assemble_state(v_merchant, v_cart_id) INTO v_state;
  RETURN jsonb_build_object('ok', true, 'code', null, 'replayed', false, 'state', v_state, 'currentVersion', 1);
EXCEPTION
  WHEN raise_exception THEN
    IF SQLERRM = 'invalid_line' OR SQLERRM = 'invalid_offer' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'replayed', false, 'state', null, 'currentVersion', null);
    END IF;
    RAISE;
END;
$$;
REVOKE ALL ON FUNCTION public.commerce_cart_parse_input_line(jsonb),public.commerce_cart_offer_price_minor(uuid,uuid,uuid),public.commerce_cart_negotiation_auto_accepts(uuid,uuid,uuid,bigint),public.commerce_cart_negotiation_status(uuid,uuid,uuid,bigint,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.commerce_cart_create(p_operation_id text,p_lines jsonb,p_currency text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.commerce_cart_device_is_active() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','state',null,'replayed',false); END IF;
 RETURN public.commerce_cart_create_device_impl(p_operation_id,p_lines,p_currency);
END $$;
