-- Round-33 P1 regressions: payment-method classification for capture
-- runs through a narrow merchant-bound RPC callable by service_role or
-- the scoped route client, and fails closed for anyone else.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant uuid := '6b5cb8a4-5575-456c-b936-8cdfae30db78';
  v_other_merchant uuid := '6b5cb8a4-5575-456c-b936-8cdfae30db79';
  v_customer uuid := '22222222-0000-4000-8000-0000000000b1';
  v_order uuid := '10000000-0000-4000-8000-0000000000b1';
  v_wallet uuid := 'f1000000-0000-4000-8000-0000000000b1';
  v_method text;
BEGIN
  -- Orders writes must ride the protected path like production writers do.
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  INSERT INTO public.merchants (id, email, business_name)
  VALUES (v_merchant, 'redvault-p33@example.com', 'Redvault P33')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.merchant_wallets (id, merchant_id)
  VALUES (v_wallet, v_merchant)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.customers (id, merchant_id, user_id, email)
  VALUES (v_customer, v_merchant, NULL, 'redvault-p33@example.com');
  INSERT INTO public.orders
    (id, merchant_id, customer_id, order_number, total, payment_method, payment_status, shipping_status,
     tracking_token, created_at)
  VALUES (v_order, v_merchant, v_customer, 'R33P1-CLASSIFY', 1500.00, 'uba_redvault', 'unpaid', 'pending',
    'track-r33-classify', pg_catalog.now() - interval '10 minutes');
  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();

  -- service_role with a matching merchant reads the method; a
  -- mismatched merchant yields no row (never another tenant's data).
  SELECT payment_method INTO v_method
  FROM public.get_redvault_order_payment_method(v_order, v_merchant);
  IF v_method IS DISTINCT FROM 'uba_redvault' THEN
    RAISE EXCEPTION 'classification returned %, want uba_redvault', v_method;
  END IF;
  SELECT payment_method INTO v_method
  FROM public.get_redvault_order_payment_method(v_order, v_other_merchant);
  IF v_method IS NOT NULL THEN
    RAISE EXCEPTION 'classification leaked % across merchants', v_method;
  END IF;

  -- The scoped route client passes with a matching merchant binding.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('storefront_order_context', 'route',
      'storefront_order_merchant_id', v_merchant::text)::text, true);
  SELECT payment_method INTO v_method
  FROM public.get_redvault_order_payment_method(v_order, v_merchant);
  IF v_method IS DISTINCT FROM 'uba_redvault' THEN
    RAISE EXCEPTION 'scoped classification returned %, want uba_redvault', v_method;
  END IF;

  -- A scoped client bound to another merchant cannot ask for this
  -- order's merchant (forbidden), and asking for its own binding
  -- yields no row (never another tenant's data).
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('storefront_order_context', 'route',
      'storefront_order_merchant_id', v_other_merchant::text)::text, true);
  BEGIN
    PERFORM public.get_redvault_order_payment_method(v_order, v_merchant);
    RAISE EXCEPTION 'cross-merchant scoped classification unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'forbidden: get_redvault_order_payment_method requires service_role or scoped route context' THEN RAISE; END IF;
  END;
  SELECT payment_method INTO v_method
  FROM public.get_redvault_order_payment_method(v_order, v_other_merchant);
  IF v_method IS NOT NULL THEN
    RAISE EXCEPTION 'scoped classification leaked % across merchants', v_method;
  END IF;

  -- Claimless authenticated callers fail closed (no NULL slip-through).
  PERFORM set_config('request.jwt.claims', '{}'::text, true);
  BEGIN
    PERFORM public.get_redvault_order_payment_method(v_order, v_merchant);
    RAISE EXCEPTION 'claimless classification unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'forbidden: get_redvault_order_payment_method requires service_role or scoped route context' THEN RAISE; END IF;
  END;

  -- Anonymous callers are forbidden outright.
  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  BEGIN
    PERFORM public.get_redvault_order_payment_method(v_order, v_merchant);
    RAISE EXCEPTION 'anon classification unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'forbidden: get_redvault_order_payment_method requires service_role or scoped route context' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();
END;
$$;

RESET ROLE;
ROLLBACK;
