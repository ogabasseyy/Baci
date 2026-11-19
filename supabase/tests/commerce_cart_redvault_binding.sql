-- The REDVAULT draft and the reviewed cart must commit or roll back together.
DO $$
DECLARE
  m uuid := '11111111-1111-4111-8111-111111111111';
  p uuid := '33333333-3333-4333-8333-333333333333';
  c uuid;
  g uuid;
  sid uuid;
  lid uuid;
  snapshot jsonb;
  items jsonb;
  order_payload jsonb;
  quote_payload jsonb := '{"discountKobo":50}'::jsonb;
  proof jsonb;
  args jsonb;
  result jsonb;
  first_order uuid;
  before_count bigint;
  n integer;
BEGIN
  UPDATE public.product_offers SET stock_quantity = 20 WHERE product_id = p;
  FOR n IN 1..5 LOOP
    c := ('aaaaaaaa-4800-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
    g := ('bbbbbbbb-4800-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
    INSERT INTO public.commerce_carts(id, merchant_id, expires_at)
      VALUES(c, m, now() + interval '1 day');
    INSERT INTO public.commerce_cart_grants(id, merchant_id, cart_id, principal_id, expires_at)
      VALUES(g, m, c, 'redvault-fixture-' || n, now() + interval '1 day');
    INSERT INTO public.commerce_cart_lines(merchant_id, cart_id, product_id, condition, quantity, last_unit_price_minor)
      VALUES(m, c, p, 'used', 1, 1000) RETURNING id INTO lid;
    snapshot := public.commerce_cart_build_checkout_snapshot(m, c);
    INSERT INTO public.commerce_cart_checkout_sessions(
      merchant_id, cart_id, checkout_generation, cart_version_reviewed,
      principal_id, preparing_grant_id, reviewed_snapshot, expires_at
    ) VALUES(m, c, 1, 1, 'redvault-fixture-' || n, g, snapshot, now() + interval '30 minutes')
      RETURNING id INTO sid;
    PERFORM set_config('request.jwt.claims', jsonb_build_object(
      'role', 'authenticated', 'storefront_order_context', 'route',
      'storefront_order_merchant_id', m,
      'storefront_redvault_customer_email', 'buyer@example.invalid'
    )::text, true);
    items := jsonb_build_array(jsonb_build_object(
      'cart_line_id', lid, 'product_id', p, 'condition', 'used',
      'variant_attributes', '{}'::jsonb, 'quantity', 1, 'price', 10
    ));
    order_payload := jsonb_build_object(
      'merchant_id', m, 'customer_email', 'buyer@example.invalid',
      'payment_method', 'uba_redvault', 'items', items,
      'checkout_idempotency_key', 'redvault-fixture-' || n
    );
    IF n = 2 THEN order_payload := order_payload || '{"fixture_failure":"after_write"}'::jsonb; END IF;
    proof := jsonb_build_object('valid', true, 'payload', jsonb_build_object('order', order_payload, 'quote', quote_payload));
    args := jsonb_build_object(
      'p_merchant_id', m, 'p_cart_id', c, 'p_cart_version', 1,
      'p_cart_principal_id', 'redvault-fixture-' || n, 'p_items', items,
      'p_customer_email', 'buyer@example.invalid', 'p_payment_method', 'uba_redvault',
      'p_checkout_idempotency_key', 'redvault-fixture-' || n,
      'p_redvault_order', order_payload, 'p_redvault_quote', quote_payload,
      'p_redvault_route_proof', proof
    );

    IF n = 1 THEN
      -- A forged principal or changed submitted line must not reach the leaf.
      BEGIN
        PERFORM public.create_storefront_order_with_cart_binding('redvault', sid, 1,
          jsonb_set(args, '{p_cart_principal_id}', '"other"'));
        RAISE EXCEPTION 'wrong principal accepted';
      EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'cart_order_unauthorized' THEN RAISE; END IF; END;
      BEGIN
        PERFORM public.create_storefront_order_with_cart_binding('redvault', sid, 1,
          jsonb_set(args, '{p_items,0,quantity}', '2'));
        RAISE EXCEPTION 'changed cart line accepted';
      EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'cart_checkout_stale' THEN RAISE; END IF; END;
      -- Even a valid proof over a different order cannot swap the cart lines.
      BEGIN
        order_payload := jsonb_set(order_payload, '{items,0,quantity}', '2');
        proof := jsonb_build_object('valid', true, 'payload', jsonb_build_object('order', order_payload, 'quote', quote_payload));
        PERFORM public.create_storefront_order_with_cart_binding('redvault', sid, 1,
          jsonb_set(jsonb_set(args, '{p_redvault_order}', order_payload), '{p_redvault_route_proof}', proof));
        RAISE EXCEPTION 'different signed order accepted';
      EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'cart_checkout_stale' THEN RAISE; END IF; END;
      order_payload := args->'p_redvault_order';
      proof := args->'p_redvault_route_proof';
      -- Quote normalization cannot silently change the reviewed condition.
      BEGIN
        order_payload := jsonb_set(order_payload, '{items,0,condition}', '"new"');
        proof := jsonb_build_object('valid', true, 'payload', jsonb_build_object('order', order_payload, 'quote', quote_payload));
        PERFORM public.create_storefront_order_with_cart_binding('redvault', sid, 1,
          jsonb_set(jsonb_set(args, '{p_redvault_order}', order_payload), '{p_redvault_route_proof}', proof));
        RAISE EXCEPTION 'different signed condition accepted';
      EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'cart_checkout_stale' THEN RAISE; END IF; END;
      order_payload := args->'p_redvault_order';
      proof := args->'p_redvault_route_proof';
      PERFORM set_config('request.jwt.claims', jsonb_build_object(
        'role', 'authenticated', 'agentic_context', 'checkout', 'agentic_merchant_id', m
      )::text, true);
      BEGIN
        PERFORM public.create_storefront_order_with_cart_binding('redvault', sid, 1, args);
        RAISE EXCEPTION 'agentic context accepted for REDVAULT';
      EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'cart_order_unauthorized' THEN RAISE; END IF; END;
      PERFORM set_config('request.jwt.claims', jsonb_build_object(
        'role', 'authenticated', 'storefront_order_context', 'route',
        'storefront_order_merchant_id', m,
        'storefront_redvault_customer_email', 'buyer@example.invalid'
      )::text, true);
      BEGIN
        PERFORM public.create_storefront_order_with_cart_binding('redvault', sid, 1,
          jsonb_set(args, '{p_redvault_route_proof,valid}', 'false'));
        RAISE EXCEPTION 'forged proof accepted';
      EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'redvault_proof_rejected' THEN RAISE; END IF; END;
      IF EXISTS(SELECT 1 FROM public.redvault_binding_fixture_orders) THEN
        RAISE EXCEPTION 'rejected checkout created an order';
      END IF;

      result := public.create_storefront_order_with_cart_binding('redvault', sid, 1, args);
      first_order := (result->'order'->>'id')::uuid;
      IF result->>'ok' IS DISTINCT FROM 'true' OR first_order IS NULL
        OR (SELECT state FROM public.commerce_carts WHERE id = c) IS DISTINCT FROM 'completed'
        OR (SELECT order_id FROM public.commerce_cart_checkout_sessions WHERE id = sid) IS DISTINCT FROM first_order THEN
        RAISE EXCEPTION 'REDVAULT draft and cart were not bound: %', result;
      END IF;
      SELECT count(*) INTO before_count FROM public.redvault_binding_fixture_orders;
      result := public.create_storefront_order_with_cart_binding('redvault', sid, 1, args);
      IF result->>'replayed' IS DISTINCT FROM 'true'
        OR (result->'order'->>'id')::uuid IS DISTINCT FROM first_order
        OR (SELECT count(*) FROM public.redvault_binding_fixture_orders) IS DISTINCT FROM before_count THEN
        RAISE EXCEPTION 'REDVAULT retry created or returned the wrong order';
      END IF;
      BEGIN
        PERFORM public.create_storefront_order_with_cart_binding('base', sid, 1, args);
        RAISE EXCEPTION 'REDVAULT receipt replayed as another payment variant';
      EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'cart_checkout_stale' THEN RAISE; END IF; END;
      BEGIN
        PERFORM public.create_storefront_order_with_cart_binding('redvault', sid, 1,
          jsonb_set(args, '{p_redvault_route_proof,valid}', 'false'));
        RAISE EXCEPTION 'forged replay proof accepted';
      EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'redvault_proof_rejected' THEN RAISE; END IF; END;
      BEGIN
        order_payload := jsonb_set(order_payload, '{checkout_idempotency_key}', '"different-key"');
        proof := jsonb_build_object('valid', true, 'payload', jsonb_build_object('order', order_payload, 'quote', quote_payload));
        PERFORM public.create_storefront_order_with_cart_binding('redvault', sid, 1,
          jsonb_set(jsonb_set(jsonb_set(args, '{p_redvault_order}', order_payload), '{p_redvault_route_proof}', proof), '{p_checkout_idempotency_key}', '"different-key"'));
        RAISE EXCEPTION 'different checkout replay accepted';
      EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'cart_checkout_stale' THEN RAISE; END IF; END;
      IF (SELECT count(*) FROM public.redvault_binding_fixture_orders) IS DISTINCT FROM before_count THEN
        RAISE EXCEPTION 'rejected replay left an extra order';
      END IF;
    ELSIF n = 2 THEN
      SELECT count(*) INTO before_count FROM public.redvault_binding_fixture_orders;
      BEGIN
        PERFORM public.create_storefront_order_with_cart_binding('redvault', sid, 1, args);
        RAISE EXCEPTION 'failing draft accepted';
      EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'redvault_fixture_failed' THEN RAISE; END IF; END;
      IF (SELECT count(*) FROM public.redvault_binding_fixture_orders) IS DISTINCT FROM before_count
        OR (SELECT state FROM public.commerce_carts WHERE id = c) IS DISTINCT FROM 'active'
        OR (SELECT status FROM public.commerce_cart_checkout_sessions WHERE id = sid) IS DISTINCT FROM 'active' THEN
        RAISE EXCEPTION 'failed draft did not roll back cart and order';
      END IF;
    ELSIF n = 3 THEN
      -- An already-created draft cannot be silently attached to another active session.
      PERFORM public.create_storefront_redvault_order(order_payload, quote_payload, proof);
      BEGIN
        PERFORM public.create_storefront_order_with_cart_binding('redvault', sid, 1, args);
        RAISE EXCEPTION 'existing draft attached to another session';
      EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'cart_checkout_stale' THEN RAISE; END IF; END;
      IF (SELECT state FROM public.commerce_carts WHERE id = c) IS DISTINCT FROM 'active' THEN
        RAISE EXCEPTION 'reused draft completed another cart';
      END IF;
    ELSIF n = 4 THEN
      UPDATE public.commerce_cart_checkout_sessions SET expires_at=now()-interval '1 minute' WHERE id=sid;
      BEGIN
        PERFORM public.create_storefront_order_with_cart_binding('redvault', sid, 1, args);
        RAISE EXCEPTION 'expired session accepted';
      EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'cart_checkout_expired' THEN RAISE; END IF; END;
    ELSE
      UPDATE public.commerce_cart_grants SET revoked_at=now() WHERE id=g;
      BEGIN
        PERFORM public.create_storefront_order_with_cart_binding('redvault', sid, 1, args);
        RAISE EXCEPTION 'revoked grant accepted';
      EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'cart_order_unauthorized' THEN RAISE; END IF; END;
    END IF;
  END LOOP;
END;
$$;
