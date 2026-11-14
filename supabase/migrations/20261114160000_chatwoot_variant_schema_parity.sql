-- product_variants has no active/status/deleted/archive columns. The live PDP
-- snapshot returns tenant-owned variants (excluding inventory anchors), so the
-- add RPC must bind to that snapshot and actual row ownership without querying
-- columns the canonical table does not have.
CREATE OR REPLACE FUNCTION public.commerce_cart_add_chatwoot(
  p_cart_id uuid,
  p_operation_id text,
  p_expected_version integer,
  p_product_slug text,
  p_variant_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_claims jsonb := auth.jwt();
  v_merchant uuid;
  v_principal text;
  v_grant_id uuid;
  v_cart_version integer;
  v_cart_state text;
  v_identity jsonb;
  v_existing public.commerce_cart_operations%ROWTYPE;
  v_product jsonb;
  v_variant jsonb;
  v_item jsonb;
  v_options jsonb;
  v_condition text;
  v_variant_row public.product_variants%ROWTYPE;
  v_command jsonb;
  v_stock numeric;
  v_manage_stock boolean;
  v_policy text;
  v_result jsonb;
BEGIN
  IF v_claims->>'role' IS DISTINCT FROM 'commerce_cart_shopper'
    OR v_claims->>'cart_scope' IS DISTINCT FROM 'session'
    OR jsonb_typeof(v_claims->'exp') IS DISTINCT FROM 'number'
    OR coalesce((v_claims->>'exp')::numeric, 0) <= extract(epoch FROM now())
    OR lower(v_claims->>'cart_id') IS DISTINCT FROM p_cart_id::text
    OR coalesce(v_claims->>'cart_merchant_id', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    OR nullif(v_claims->>'cart_principal_id', '') IS NULL
    OR coalesce(v_claims->>'cart_grant_id', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    OR p_operation_id IS NULL OR length(trim(p_operation_id)) = 0 OR length(p_operation_id) > 128
    OR p_expected_version IS NULL OR p_expected_version < 1
    OR p_product_slug IS NULL OR length(trim(p_product_slug)) = 0
    OR octet_length(p_product_slug) > 512 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unauthorized', 'state', null, 'currentVersion', null, 'replayed', false);
  END IF;

  v_merchant := (v_claims->>'cart_merchant_id')::uuid;
  v_principal := v_claims->>'cart_principal_id';
  v_grant_id := (v_claims->>'cart_grant_id')::uuid;
  v_identity := jsonb_build_object(
    'productSlug', lower(trim(p_product_slug)),
    'variantId', CASE WHEN p_variant_id IS NULL THEN NULL ELSE lower(p_variant_id::text) END
  );
  IF NOT public.commerce_cart_device_is_active()
    OR NOT EXISTS (SELECT 1 FROM public.merchants m WHERE m.id = v_merchant AND m.premium_features @> '["shared_cart"]'::jsonb) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unauthorized', 'state', null, 'currentVersion', null, 'replayed', false);
  END IF;

  -- Preserve canonical mutation lock order: cart, grant, then operation key.
  SELECT c.version, c.state INTO v_cart_version, v_cart_state
  FROM public.commerce_carts c
  WHERE c.id = p_cart_id AND c.merchant_id = v_merchant
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found', 'state', null, 'currentVersion', null, 'replayed', false);
  END IF;
  PERFORM 1 FROM public.commerce_cart_grants g
  WHERE g.id = v_grant_id AND g.merchant_id = v_merchant AND g.cart_id = p_cart_id
    AND g.principal_id = v_principal AND g.expires_at > now() AND g.revoked_at IS NULL
    AND 'add' = ANY(g.allowed_operations)
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unauthorized', 'state', null, 'currentVersion', null, 'replayed', false);
  END IF;

  SELECT * INTO v_existing FROM public.commerce_cart_operations o
  WHERE o.merchant_id = v_merchant AND o.cart_id = p_cart_id
    AND o.principal_id = v_principal AND o.operation_id = p_operation_id;
  IF FOUND THEN
    IF v_existing.request_identity IS DISTINCT FROM v_identity OR v_existing.canonical_command IS NULL OR v_existing.result IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'idempotency_conflict', 'state', null, 'currentVersion', v_cart_version, 'replayed', false);
    END IF;
    RETURN public.commerce_cart_mutate(p_cart_id, p_operation_id, p_expected_version, v_existing.canonical_command);
  END IF;

  IF v_cart_state <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'cart_locked', 'state', null, 'currentVersion', v_cart_version, 'replayed', false);
  END IF;
  IF v_cart_version <> p_expected_version THEN
    RETURN jsonb_build_object('ok', false, 'code', 'version_conflict', 'state', null, 'currentVersion', v_cart_version, 'replayed', false);
  END IF;

  SELECT s.product_data INTO v_product
  FROM private.get_storefront_pdp_core_v2(v_merchant, p_product_slug, NULL) s
  WHERE s.resolution_status = 'found'
  LIMIT 1;
  IF v_product IS NULL
    OR v_product->>'merchant_id' IS DISTINCT FROM v_merchant::text
    OR v_product->>'status' IS DISTINCT FROM 'active'
    OR jsonb_typeof(v_product->'has_variants') IS DISTINCT FROM 'boolean'
    OR coalesce((v_product->>'has_condition_offers')::boolean, true) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'state', null, 'currentVersion', v_cart_version, 'replayed', false);
  END IF;

  IF coalesce((v_product->>'has_variants')::boolean, false) THEN
    IF p_variant_id IS NULL OR jsonb_typeof(v_product->'product_variants') IS DISTINCT FROM 'array' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'state', null, 'currentVersion', v_cart_version, 'replayed', false);
    END IF;
    SELECT element INTO v_variant FROM jsonb_array_elements(v_product->'product_variants') AS variants(element)
    WHERE element->>'id' = p_variant_id::text AND element->>'product_id' = v_product->>'id'
    LIMIT 1;
    IF v_variant IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'state', null, 'currentVersion', v_cart_version, 'replayed', false);
    END IF;
    -- product_variants has no lifecycle columns: its presence in the live PDP
    -- snapshot establishes purchasability; row keys bind it to this merchant/product.
    SELECT variant.* INTO v_variant_row
    FROM public.product_variants variant
    WHERE variant.id = p_variant_id AND variant.product_id = (v_product->>'id')::uuid
      AND variant.merchant_id = v_merchant
      AND NOT coalesce(variant.is_inventory_anchor, false);
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'state', null, 'currentVersion', v_cart_version, 'replayed', false);
    END IF;
    v_policy := coalesce(v_variant->>'effective_policy', v_variant->>'inventory_tracking_policy', 'off');
    v_manage_stock := v_policy IN ('standard', 'serialized_strict') OR
      CASE WHEN jsonb_typeof(v_product->'manage_stock') = 'boolean'
        THEN (v_product->>'manage_stock')::boolean ELSE true END;
    IF v_policy = 'serialized_then_unlimited' THEN v_manage_stock := false; END IF;
    IF v_policy IN ('serialized_strict', 'serialized_then_unlimited') THEN
      v_stock := coalesce(
        CASE WHEN v_variant->>'available_units' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (v_variant->>'available_units')::numeric END,
        CASE WHEN v_variant->>'stock_quantity' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (v_variant->>'stock_quantity')::numeric END
      );
    ELSE
      v_stock := coalesce(
        CASE WHEN v_variant->>'stock_quantity' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (v_variant->>'stock_quantity')::numeric END,
        CASE
          WHEN greatest(trunc(coalesce(CASE WHEN v_product->>'stock_quantity' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (v_product->>'stock_quantity')::numeric END, 0)), 0) = 0
            AND greatest(trunc(coalesce(CASE WHEN v_product->>'stock' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (v_product->>'stock')::numeric END, 0)), 0) > 0
            THEN greatest(trunc((v_product->>'stock')::numeric), 0)
          ELSE greatest(trunc(coalesce(CASE WHEN v_product->>'stock_quantity' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (v_product->>'stock_quantity')::numeric END, 0)), 0)
        END
      );
    END IF;
    IF v_manage_stock AND coalesce(v_stock, 0) < 1 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'state', null, 'currentVersion', v_cart_version, 'replayed', false);
    END IF;
    SELECT coalesce(jsonb_object_agg(entry.key, to_jsonb(btrim(entry.value #>> '{}'))), '{}'::jsonb)
    INTO v_options
    FROM jsonb_each(coalesce(v_variant_row.attributes, '{}'::jsonb)) entry
    WHERE jsonb_typeof(entry.value) = 'string' AND btrim(entry.value #>> '{}') <> '';
    v_condition := discovery.canonical_product_condition(v_variant_row.condition);
    v_item := jsonb_build_object('productId', v_product->>'id', 'variantId', v_variant->>'id')
      || CASE WHEN v_condition IS NOT NULL THEN jsonb_build_object('condition', v_condition) ELSE '{}'::jsonb END
      || CASE WHEN v_options <> '{}'::jsonb THEN jsonb_build_object('options', v_options) ELSE '{}'::jsonb END;
  ELSE
    IF p_variant_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'state', null, 'currentVersion', v_cart_version, 'replayed', false);
    END IF;
    v_policy := coalesce(v_product->>'effective_policy', v_product->>'inventory_tracking_policy', 'off');
    v_manage_stock := CASE WHEN jsonb_typeof(v_product->'manage_stock') = 'boolean'
      THEN (v_product->>'manage_stock')::boolean ELSE true END;
    IF v_policy IN ('serialized_strict', 'serialized_then_unlimited') THEN v_manage_stock := v_policy = 'serialized_strict'; END IF;
    v_stock := CASE
      WHEN greatest(trunc(coalesce(CASE WHEN v_product->>'stock_quantity' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (v_product->>'stock_quantity')::numeric END, 0)), 0) = 0
        AND greatest(trunc(coalesce(CASE WHEN v_product->>'stock' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (v_product->>'stock')::numeric END, 0)), 0) > 0
        THEN greatest(trunc((v_product->>'stock')::numeric), 0)
      ELSE greatest(trunc(coalesce(CASE WHEN v_product->>'stock_quantity' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (v_product->>'stock_quantity')::numeric END, 0)), 0)
    END;
    IF v_manage_stock AND coalesce(v_stock, 0) < 1 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'state', null, 'currentVersion', v_cart_version, 'replayed', false);
    END IF;
    v_condition := discovery.canonical_product_condition(v_product->>'condition');
    v_item := jsonb_build_object('productId', v_product->>'id')
      || CASE WHEN v_condition IS NOT NULL THEN jsonb_build_object('condition', v_condition) ELSE '{}'::jsonb END;
  END IF;

  v_command := jsonb_build_object('type', 'add', 'item', v_item, 'quantity', 1);
  v_result := public.commerce_cart_mutate(p_cart_id, p_operation_id, p_expected_version, v_command);
  IF v_result->>'ok' = 'true' THEN
    UPDATE public.commerce_cart_operations SET request_identity = v_identity, canonical_command = v_command
    WHERE merchant_id = v_merchant AND cart_id = p_cart_id AND principal_id = v_principal AND operation_id = p_operation_id;
  END IF;
  RETURN v_result;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'state', null, 'currentVersion', v_cart_version, 'replayed', false);
END $$;

REVOKE ALL ON FUNCTION public.commerce_cart_add_chatwoot(uuid,text,integer,text,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.commerce_cart_add_chatwoot(uuid,text,integer,text,uuid)
  TO commerce_cart_shopper;
