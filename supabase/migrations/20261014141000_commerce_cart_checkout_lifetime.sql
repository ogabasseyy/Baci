-- Keep a successfully prepared checkout usable through its session lifetime.
-- Preserve the original authentication, locking, replay and EXECUTE contracts.
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

  -- Pilot gate (defense in depth with the route-level check): the
  -- shared-cart RPCs refuse merchants without the shared_cart feature,
  -- mirroring the broadcast/account predicates.
  IF NOT EXISTS (
    SELECT 1 FROM public.merchants m
    WHERE m.id = v_merchant AND m.premium_features @> '["shared_cart"]'::jsonb
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'merchant_unavailable', 'replayed', false, 'snapshot', null, 'currentVersion', null);
  END IF;

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
  SET checkout_session_id = v_session.id, updated_at = now(),
    expires_at = greatest(expires_at, v_session.expires_at)
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
