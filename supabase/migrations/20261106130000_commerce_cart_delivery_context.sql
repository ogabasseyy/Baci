-- Read the bounded, canonical item identity needed to request a delivery
-- quote for an already prepared shared-cart checkout. This function does not
-- quote, reserve, submit, or mutate anything.
CREATE OR REPLACE FUNCTION public.commerce_cart_delivery_context(
  p_checkout_session_id uuid,
  p_checkout_generation integer,
  p_cart_version integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  claims jsonb := auth.jwt();
  v_merchant_id uuid;
  v_cart_id uuid;
  v_principal_id text;
  v_grant_id uuid;
  checkout public.commerce_cart_checkout_sessions%ROWTYPE;
  cart public.commerce_carts%ROWTYPE;
  authority public.commerce_cart_grants%ROWTYPE;
  snapshot_lines jsonb;
  quote_lines jsonb;
  unavailable jsonb := pg_catalog.jsonb_build_object('ok', false, 'code', 'unavailable');
BEGIN
  IF claims->>'role' IS DISTINCT FROM 'commerce_cart_shopper'
    OR claims->>'cart_scope' IS DISTINCT FROM 'session'
    OR coalesce(claims->>'cart_merchant_id', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    OR coalesce(claims->>'cart_id', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    OR coalesce(claims->>'cart_grant_id', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    OR nullif(claims->>'cart_principal_id', '') IS NULL
    OR p_checkout_session_id IS NULL
    OR p_checkout_generation IS NULL OR p_checkout_generation < 1
    OR p_cart_version IS NULL OR p_cart_version < 1 THEN
    RETURN unavailable;
  END IF;
  IF pg_catalog.jsonb_typeof(claims->'exp') IS DISTINCT FROM 'number' THEN
    RETURN unavailable;
  END IF;
  IF (claims->>'exp')::numeric <= extract(epoch FROM pg_catalog.clock_timestamp()) THEN
    RETURN unavailable;
  END IF;

  v_merchant_id := (claims->>'cart_merchant_id')::uuid;
  v_cart_id := (claims->>'cart_id')::uuid;
  v_grant_id := (claims->>'cart_grant_id')::uuid;
  v_principal_id := claims->>'cart_principal_id';

  -- Match the shared-cart pilot gate used by the preparation RPC.
  IF NOT EXISTS (
    SELECT 1 FROM public.merchants m
    WHERE m.id = v_merchant_id AND m.premium_features @> '["shared_cart"]'::jsonb
  ) THEN
    RETURN unavailable;
  END IF;

  SELECT * INTO checkout
  FROM public.commerce_cart_checkout_sessions s
  WHERE s.id = p_checkout_session_id
    AND s.merchant_id = v_merchant_id
    AND s.cart_id = v_cart_id
    AND s.principal_id = v_principal_id
    AND s.preparing_grant_id = v_grant_id
    AND s.checkout_generation = p_checkout_generation
    AND s.cart_version_reviewed = p_cart_version
    AND s.status = 'active'
    AND s.expires_at > pg_catalog.clock_timestamp();
  IF NOT FOUND OR checkout.reviewed_snapshot IS NULL THEN
    RETURN unavailable;
  END IF;

  -- Serialize with device retirement/revocation and then recheck the exact
  -- grant. The client token's merchant/cart/principal/grant tuple is never
  -- treated as sufficient without the persisted grant row.
  SELECT * INTO authority
  FROM public.commerce_cart_grants g
  WHERE g.id = v_grant_id;
  IF NOT FOUND
    OR authority.merchant_id IS DISTINCT FROM v_merchant_id
    OR authority.cart_id IS DISTINCT FROM v_cart_id
    OR authority.principal_id IS DISTINCT FROM v_principal_id THEN
    RETURN unavailable;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'cc-device-revoke|' || v_merchant_id::text || '|' ||
      coalesce(authority.device_principal_id, authority.principal_id), 0));

  -- Keep the established order-submit order: device advisory lock, then cart
  -- row. Do not lock the checkout row here. Preparation locks the cart before
  -- updating the session, so a checkout-row lock followed by this cart lock
  -- would invert its lock order and could deadlock with a concurrent prepare.
  SELECT * INTO cart
  FROM public.commerce_carts c
  WHERE c.id = v_cart_id AND c.merchant_id = v_merchant_id
  FOR SHARE;
  IF NOT FOUND
    OR cart.state IS DISTINCT FROM 'active'
    OR cart.version IS DISTINCT FROM checkout.cart_version_reviewed
    OR cart.checkout_session_id IS DISTINCT FROM checkout.id
    OR cart.expires_at <= pg_catalog.clock_timestamp() THEN
    RETURN unavailable;
  END IF;

  -- Preparation may have reused or refreshed the session while this call was
  -- waiting for the cart. Re-read it after taking the cart lock, without a row
  -- lock; the advisory/cart locks serialize authority changes and avoid the
  -- cart->session / session->cart cycle with prepare and order submission.
  SELECT * INTO checkout
  FROM public.commerce_cart_checkout_sessions s
  WHERE s.id = p_checkout_session_id
    AND s.merchant_id = v_merchant_id
    AND s.cart_id = v_cart_id
    AND s.principal_id = v_principal_id
    AND s.preparing_grant_id = v_grant_id
    AND s.checkout_generation = p_checkout_generation
    AND s.cart_version_reviewed = p_cart_version
    AND s.status = 'active'
    AND s.expires_at > pg_catalog.clock_timestamp();
  IF NOT FOUND OR checkout.reviewed_snapshot IS NULL
    OR checkout.id IS DISTINCT FROM cart.checkout_session_id THEN
    RETURN unavailable;
  END IF;

  PERFORM 1
  FROM public.commerce_cart_grants g
  WHERE g.id = v_grant_id
    AND g.merchant_id = v_merchant_id
    AND g.cart_id = v_cart_id
    AND g.principal_id = v_principal_id
    AND g.expires_at > pg_catalog.clock_timestamp()
    AND g.revoked_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.commerce_cart_device_retirements retired
      WHERE retired.merchant_id = g.merchant_id
        AND retired.device_principal_id = coalesce(g.device_principal_id, g.principal_id)
    )
  FOR SHARE;
  IF NOT FOUND THEN
    RETURN unavailable;
  END IF;

  snapshot_lines := checkout.reviewed_snapshot->'lines';
  IF pg_catalog.jsonb_typeof(snapshot_lines) IS DISTINCT FROM 'array' THEN
    RETURN unavailable;
  END IF;
  IF pg_catalog.jsonb_array_length(snapshot_lines) < 1
    OR pg_catalog.jsonb_array_length(snapshot_lines) > 20
    OR pg_catalog.jsonb_typeof(checkout.reviewed_snapshot->'estimates') IS DISTINCT FROM 'object'
    OR nullif(checkout.reviewed_snapshot->'estimates'->>'currency', '') IS NULL
    OR checkout.reviewed_snapshot->'estimates'->>'currency' !~ '^[A-Z]{3}$'
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(snapshot_lines) line
      WHERE coalesce(line->>'productId', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        OR coalesce(line->>'quantity', '') !~ '^(10|[1-9])$'
        OR (line ? 'condition' AND line->'condition' <> 'null'::jsonb
          AND coalesce(line->>'condition', '') NOT IN ('new', 'used', 'open_box', 'refurbished'))
        OR (line ? 'variantId' AND line->'variantId' <> 'null'::jsonb
          AND coalesce(line->>'variantId', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
    ) THEN
    RETURN unavailable;
  END IF;

  SELECT pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'productId', line->>'productId',
      'variantId', CASE WHEN line->'variantId' = 'null'::jsonb THEN NULL ELSE line->>'variantId' END,
      'condition', CASE WHEN line->'condition' = 'null'::jsonb THEN NULL ELSE line->>'condition' END,
      'quantity', (line->>'quantity')::integer
    ) ORDER BY ordinality
  ) INTO quote_lines
  FROM pg_catalog.jsonb_array_elements(snapshot_lines) WITH ORDINALITY AS rows(line, ordinality);

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'context', pg_catalog.jsonb_build_object(
      'merchantId', v_merchant_id,
      'cartId', v_cart_id,
      'checkoutSessionId', checkout.id,
      'checkoutGeneration', checkout.checkout_generation,
      'cartVersion', checkout.cart_version_reviewed,
      'currency', checkout.reviewed_snapshot->'estimates'->>'currency',
      'items', quote_lines
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.commerce_cart_delivery_context(uuid, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.commerce_cart_delivery_context(uuid, integer, integer)
  TO commerce_cart_shopper;
