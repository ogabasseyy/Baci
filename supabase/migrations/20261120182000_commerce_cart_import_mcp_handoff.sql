-- Copy one MCP cart snapshot into a website cart as a single transaction.
-- The website cart keeps its grants. The sender never gains a website grant.
CREATE INDEX IF NOT EXISTS commerce_cart_handoff_mcp_import_receipt_idx
  ON public.commerce_cart_handoffs (merchant_id, source_cart_id, (redemption_receipt->>'principalId'))
  WHERE redemption_receipt->>'choice' = 'import_mcp';

CREATE FUNCTION public.commerce_cart_import_mcp_handoff(
  p_token_hash text, p_handoff_id uuid, p_attempt_id text, p_incoming_version integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  claims jsonb := auth.jwt();
  merchant uuid := (claims->>'cart_merchant_id')::uuid;
  principal text := claims->>'cart_principal_id';
  scope text := claims->>'cart_scope';
  destination_id uuid := (claims->>'cart_id')::uuid;
  destination_grant uuid := (claims->>'cart_grant_id')::uuid;
  grant_expiry timestamptz;
  handoff public.commerce_cart_handoffs%ROWTYPE;
  source public.commerce_carts%ROWTYPE;
  destination public.commerce_carts%ROWTYPE;
  incoming jsonb;
  line jsonb;
  result jsonb;
  version integer;
  step integer := 0;
  replayed boolean := false;
  failure text;
BEGIN
  IF claims->>'role' IS DISTINCT FROM 'commerce_cart_shopper'
     OR jsonb_typeof(claims->'exp') IS DISTINCT FROM 'number'
     OR (claims->>'exp')::numeric <= extract(epoch FROM now())
     OR merchant IS NULL OR nullif(principal, '') IS NULL
     OR scope IS NULL OR scope NOT IN ('session', 'bootstrap')
     OR NOT public.commerce_cart_device_is_active()
  THEN RETURN jsonb_build_object('ok', false, 'code', 'unauthorized'); END IF;
  IF p_token_hash IS NULL OR length(p_token_hash) > 128
     OR nullif(trim(p_attempt_id), '') IS NULL OR length(p_attempt_id) > 128
     OR coalesce(p_incoming_version, 0) < 1
  THEN RETURN jsonb_build_object('ok', false, 'code', 'invalid_item'); END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.merchants m
    WHERE m.id = merchant AND m.premium_features @> '["shared_cart"]'::jsonb
  ) THEN RETURN jsonb_build_object('ok', false, 'code', 'merchant_unavailable'); END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cc-handoff|' || p_token_hash, 0));
  SELECT * INTO handoff FROM public.commerce_cart_handoffs h
  WHERE h.id = p_handoff_id AND h.handoff_hash = p_token_hash AND h.merchant_id = merchant
    AND h.destination->>'type' = 'web' AND h.origin_principal_id LIKE 'legacy:mcp:%'
    AND h.operation_id LIKE 'legacy-handoff:%'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'not_found'); END IF;

  -- Serialize imports from the same source to the same website identity,
  -- even when two different continuation links were issued.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'cc-mcp-import|' || merchant || '|' || handoff.source_cart_id || '|' || principal, 0
  ));
  IF handoff.redeemed_at IS NOT NULL THEN
    IF handoff.redemption_receipt->>'choice' IS DISTINCT FROM 'import_mcp'
       OR handoff.redemption_receipt->>'principalId' IS DISTINCT FROM principal
       OR (scope = 'session' AND (
         handoff.redemption_receipt->>'destCartId' IS DISTINCT FROM destination_id::text
         OR handoff.redemption_receipt->>'destGrantId' IS DISTINCT FROM destination_grant::text))
    THEN RETURN jsonb_build_object('ok', false, 'code', 'handoff_consumed'); END IF;
    destination_id := (handoff.redemption_receipt->>'destCartId')::uuid;
    destination_grant := (handoff.redemption_receipt->>'destGrantId')::uuid;
    replayed := true;
  ELSIF handoff.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'expired');
  END IF;

  -- Lock carts in the same order as the existing handoff executor.
  PERFORM 1 FROM public.commerce_carts c
  WHERE c.merchant_id = merchant AND c.id IN (handoff.source_cart_id, destination_id)
  ORDER BY c.id FOR UPDATE;
  IF scope = 'session' OR replayed THEN
    SELECT * INTO destination FROM public.commerce_carts c
    WHERE c.merchant_id = merchant AND c.id = destination_id;
    IF NOT FOUND OR destination.state <> 'active' OR destination.expires_at <= now()
    THEN RETURN jsonb_build_object('ok', false, 'code', 'cart_locked'); END IF;
    SELECT g.expires_at INTO grant_expiry FROM public.commerce_cart_grants g
    WHERE g.merchant_id = merchant AND g.id = destination_grant AND g.cart_id = destination_id
      AND g.principal_id = principal AND g.revoked_at IS NULL AND g.expires_at > now()
      AND 'add' = ANY(g.allowed_operations)
    FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'unauthorized'); END IF;
  END IF;
  IF replayed OR destination_id = handoff.source_cart_id THEN
    RETURN jsonb_build_object('ok', true, 'choice', 'import_mcp', 'replayed', true,
      'state', public.commerce_cart_assemble_state(merchant, destination_id),
      'grantId', destination_grant, 'grantExpiresAt', grant_expiry);
  END IF;

  SELECT * INTO source FROM public.commerce_carts c
  WHERE c.merchant_id = merchant AND c.id = handoff.source_cart_id;
  IF NOT FOUND OR source.state <> 'active' OR source.expires_at <= now()
  THEN RETURN jsonb_build_object('ok', false, 'code', 'expired'); END IF;
  IF source.version <> p_incoming_version
  THEN RETURN jsonb_build_object('ok', false, 'code', 'version_conflict'); END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.commerce_cart_legacy_refs r
    WHERE r.merchant_id = merchant AND r.cart_id = source.id AND r.provider = 'mcp'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.commerce_cart_grants g
    WHERE g.merchant_id = merchant AND g.cart_id = source.id AND g.principal_id = handoff.origin_principal_id
      AND g.revoked_at IS NULL AND g.expires_at > now()
  ) THEN RETURN jsonb_build_object('ok', false, 'code', 'not_found'); END IF;

  IF EXISTS (
    SELECT 1 FROM public.commerce_cart_handoffs h WHERE h.merchant_id = merchant
      AND h.source_cart_id = source.id AND h.redemption_receipt->>'choice' = 'import_mcp'
      AND h.redemption_receipt->>'principalId' = principal
  ) THEN RETURN jsonb_build_object('ok', false, 'code', 'handoff_consumed'); END IF;

  -- Only catalog lines are copied. Private offers and credentials cannot
  -- leave the source cart through this operation.
  IF EXISTS (
    SELECT 1 FROM public.commerce_cart_lines l WHERE l.cart_id = source.id AND l.merchant_id = merchant
      AND (l.voucher_token IS NOT NULL OR l.voucher_award_id IS NOT NULL
        OR l.negotiated_unit_price_minor IS NOT NULL OR coalesce(l.negotiation_status, 'none') <> 'none'
        OR l.has_assurance)
  ) THEN RETURN jsonb_build_object('ok', false, 'code', 'invalid_item'); END IF;
  -- The add writer can increment an existing line that carries assurance
  -- or a negotiated price. An automatic import must not inherit either.
  IF EXISTS (
    SELECT 1 FROM public.commerce_cart_lines incoming_line
    JOIN public.commerce_cart_lines destination_line
      ON destination_line.merchant_id = incoming_line.merchant_id
      AND destination_line.product_id = incoming_line.product_id
      AND destination_line.variant_id IS NOT DISTINCT FROM incoming_line.variant_id
      AND destination_line.condition IS NOT DISTINCT FROM incoming_line.condition
      AND destination_line.options = incoming_line.options
    WHERE incoming_line.merchant_id = merchant AND incoming_line.cart_id = source.id
      AND destination_line.cart_id = destination_id
      AND destination_line.voucher_token IS NULL AND destination_line.voucher_award_id IS NULL
      AND (destination_line.has_assurance OR destination_line.negotiated_unit_price_minor IS NOT NULL
        OR coalesce(destination_line.negotiation_status, 'none') <> 'none')
  ) THEN RETURN jsonb_build_object('ok', false, 'code', 'invalid_item'); END IF;
  SELECT jsonb_agg(jsonb_build_object('item', jsonb_strip_nulls(jsonb_build_object(
    'productId', l.product_id, 'variantId', l.variant_id, 'condition', l.condition, 'options', l.options
  )), 'quantity', l.quantity) ORDER BY l.id) INTO incoming
  FROM public.commerce_cart_lines l WHERE l.cart_id = source.id AND l.merchant_id = merchant;
  IF incoming IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'invalid_item'); END IF;

  IF scope = 'bootstrap' THEN
    -- A concurrently created website cart must be reloaded, not replaced.
    IF EXISTS (SELECT 1 FROM public.commerce_cart_grants g WHERE g.merchant_id = merchant
       AND g.principal_id = principal AND g.revoked_at IS NULL AND g.expires_at > now())
    THEN RETURN jsonb_build_object('ok', false, 'code', 'version_conflict'); END IF;
    result := public.commerce_cart_create('mcp-import:' || handoff.id, incoming, source.currency);
    IF result->>'ok' IS DISTINCT FROM 'true' THEN RETURN result; END IF;
    destination_id := (result->'state'->>'cartId')::uuid;
    destination_grant := (result->>'grantId')::uuid;
    IF destination_id IS NULL OR destination_grant IS NULL THEN
      failure := 'temporarily_unavailable';
      RAISE EXCEPTION USING ERRCODE = 'BCI01';
    END IF;
  ELSE
    version := destination.version;
    FOR line IN SELECT value FROM jsonb_array_elements(incoming) LOOP
      step := step + 1;
      result := public.commerce_cart_mutate(destination_id, 'mcp-import:' || handoff.id || ':' || step,
        version, line || '{"type":"add"}'::jsonb);
      IF result->>'ok' IS DISTINCT FROM 'true' OR result->>'replayed' = 'true' THEN
        failure := coalesce(result->>'code', 'idempotency_conflict');
        -- Roll back any earlier lines in this import.
        RAISE EXCEPTION USING ERRCODE = 'BCI01';
      END IF;
      version := (result->>'currentVersion')::integer;
    END LOOP;
  END IF;
  SELECT g.expires_at INTO grant_expiry FROM public.commerce_cart_grants g WHERE g.id = destination_grant;
  UPDATE public.commerce_cart_handoffs SET redeemed_at = now(), destination_attempt_id = p_attempt_id,
    redemption_receipt = jsonb_build_object('choice', 'import_mcp', 'principalId', principal,
      'merchantId', merchant, 'destCartId', destination_id, 'destGrantId', destination_grant)
  WHERE id = handoff.id;
  RETURN jsonb_build_object('ok', true, 'choice', 'import_mcp', 'replayed', false,
    'state', public.commerce_cart_assemble_state(merchant, destination_id),
    'grantId', destination_grant, 'grantExpiresAt', grant_expiry);
EXCEPTION
  WHEN SQLSTATE 'BCI01' THEN RETURN jsonb_build_object('ok', false, 'code', failure);
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_item');
END $$;

REVOKE ALL ON FUNCTION public.commerce_cart_import_mcp_handoff(text,uuid,text,integer)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.commerce_cart_import_mcp_handoff(text,uuid,text,integer)
  TO commerce_cart_shopper;
