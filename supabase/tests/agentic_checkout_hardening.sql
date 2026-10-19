-- Behavioral regressions for the round-68 SQL hardening:
-- zero-price negotiations parse and survive checkout snapshot review,
-- and the replay snapshot only answers for UUID-shaped checkout credentials.
DO $$
DECLARE
  v record;
  v_merchant uuid := '11111111-1111-4111-8111-111111111111';
  v_product uuid := '44444444-4444-4444-8444-444444444444';
  v_cart uuid := 'cccccccc-9970-4000-8000-000000000000';
  v_line uuid := 'dddddddd-9970-4000-8000-000000000000';
  v_snapshot jsonb;
BEGIN
  SELECT * INTO v
  FROM public.commerce_cart_parse_input_line(
    '{"item":{"productId":"11111111-1111-4111-8111-111111111111"},"quantity":1,"negotiatedUnitPriceMinor":0}'::jsonb
  );
  IF v.pi_product IS NULL OR v.pi_negotiated <> 0 THEN
    RAISE EXCEPTION 'zero negotiated price must parse: %', v;
  END IF;

  INSERT INTO public.commerce_carts (id, merchant_id, currency, version, state, expires_at)
  VALUES (v_cart, v_merchant, 'NGN', 1, 'active', now() + interval '1 day');
  INSERT INTO public.commerce_cart_lines (
    id, merchant_id, cart_id, product_id, quantity,
    negotiated_unit_price_minor, negotiation_status, last_unit_price_minor
  ) VALUES (
    v_line, v_merchant, v_cart, v_product, 2, 0, 'accepted', 1500
  );

  v_snapshot := public.commerce_cart_build_checkout_snapshot(v_merchant, v_cart);
  IF coalesce((v_snapshot -> 'lines' -> 0 ->> 'negotiationInvalidated')::boolean, true)
    OR (v_snapshot -> 'lines' -> 0 ->> 'effectiveUnitPriceMinor')::bigint IS DISTINCT FROM 0
    OR (v_snapshot -> 'estimates' ->> 'subtotalMinor')::bigint IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'accepted zero negotiated price must price at zero in checkout snapshot: %', v_snapshot;
  END IF;

  UPDATE public.commerce_cart_lines
  SET negotiation_status = 'pending'
  WHERE id = v_line;

  v_snapshot := public.commerce_cart_build_checkout_snapshot(v_merchant, v_cart);
  IF coalesce((v_snapshot -> 'lines' -> 0 ->> 'negotiationInvalidated')::boolean, true)
    OR (v_snapshot -> 'lines' -> 0 ->> 'effectiveUnitPriceMinor')::bigint IS NULL
    OR (v_snapshot -> 'lines' -> 0 ->> 'effectiveUnitPriceMinor')::bigint
      IS DISTINCT FROM (v_snapshot -> 'lines' -> 0 ->> 'validatedUnitPriceMinor')::bigint
    OR coalesce((v_snapshot -> 'lines' -> 0 ->> 'effectiveUnitPriceMinor')::bigint, 0) <= 0 THEN
    RAISE EXCEPTION 'pending zero negotiated price must remain at catalog in checkout snapshot: %', v_snapshot;
  END IF;

  DELETE FROM public.commerce_carts WHERE id = v_cart;

  IF strpos(
    pg_get_functiondef(
      'public.commerce_cart_redeem_handoff_coverage_impl(text,uuid,text,text,text,uuid,integer,integer,jsonb,jsonb)'::regprocedure
    ),
    'count(DISTINCT l.voucher_award_id)>1'
  ) = 0 THEN
    RAISE EXCEPTION 'handoff coverage must recognize union award lanes';
  END IF;

  IF public.storefront_checkout_replay_snapshot(
    '77777777-7777-4777-8777-777777777777', 'order-123'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'predictable replay keys must resolve no snapshot';
  END IF;
  IF public.storefront_checkout_replay_snapshot(
    '77777777-7777-4777-8777-777777777777',
    '123e4567-e89b-42d3-a456-426614174000'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'unknown UUID replay keys must resolve no snapshot';
  END IF;
  IF public.storefront_checkout_replay_snapshot(
    '77777777-7777-4777-8777-777777777777',
    repeat('ab', 32)
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'unknown 64-hex mobile replay keys must resolve no snapshot';
  END IF;

  INSERT INTO public.orders (
    id, merchant_id, order_number, total, payment_status, checkout_idempotency_key
  ) VALUES (
    'eeeeeeee-9980-4000-8000-000000000000',
    v_merchant,
    'ORD-9980',
    1500,
    'pending',
    repeat('cd', 32)
  );
  IF public.storefront_checkout_replay_snapshot(
    v_merchant,
    repeat('cd', 32)
  ) IS NOT NULL THEN
    DELETE FROM public.orders WHERE id = 'eeeeeeee-9980-4000-8000-000000000000';
    RAISE EXCEPTION 'replay snapshot must reject calls without route context claim';
  END IF;
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'authenticated',
      'storefront_order_context', 'route',
      'storefront_order_merchant_id', v_merchant::text
    )::text,
    true
  );
  v_snapshot := public.storefront_checkout_replay_snapshot(
    v_merchant,
    repeat('cd', 32)
  );
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM public.orders WHERE id = 'eeeeeeee-9980-4000-8000-000000000000';
  IF v_snapshot IS NULL
    OR (v_snapshot ->> 'order_id') IS DISTINCT FROM 'eeeeeeee-9980-4000-8000-000000000000' THEN
    RAISE EXCEPTION 'mobile 64-hex replay key must resolve committed order snapshot: %', v_snapshot;
  END IF;
END
$$;
