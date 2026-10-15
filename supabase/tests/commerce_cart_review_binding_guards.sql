-- Loaded by the local-only runner after the existing rollback fixture.
-- All order RPCs are mocks; no actual order/payment service is called.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-a4","cart_scope":"session","cart_id":"cccccccc-4000-4000-8000-000000000000","cart_grant_id":"99999999-9999-4999-8999-999999999960"}';
SET ROLE commerce_cart_shopper;
DO $$ DECLARE prep jsonb; BEGIN
  prep := public.commerce_cart_prepare_checkout('cccccccc-4000-4000-8000-000000000000', 1, 'review-guards');
  IF NOT (prep ->> 'ok')::boolean THEN RAISE EXCEPTION 'fixture prepare failed: %', prep; END IF;
  INSERT INTO test_ctx VALUES ('guard_session', prep -> 'snapshot' ->> 'checkoutSessionId');
END $$;
RESET ROLE;
-- A second principal holding a grant for the same cart and version must
-- receive its own checkout session, never the first principal's session.
INSERT INTO public.commerce_cart_grants (id, merchant_id, cart_id, principal_id, expires_at, revoked_at) VALUES
  ('99999999-9999-4999-8999-999999999970', '11111111-1111-4111-8111-111111111111', 'cccccccc-4000-4000-8000-000000000000', 'guest-other', now() + interval '7 days', NULL);
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-other","cart_scope":"session","cart_id":"cccccccc-4000-4000-8000-000000000000","cart_grant_id":"99999999-9999-4999-8999-999999999970"}';
SET ROLE commerce_cart_shopper;
DO $$ DECLARE prep jsonb; BEGIN
  prep := public.commerce_cart_prepare_checkout('cccccccc-4000-4000-8000-000000000000', 1, 'review-guards-other');
  IF NOT (prep ->> 'ok')::boolean THEN RAISE EXCEPTION 'second principal prepare failed: %', prep; END IF;
  IF (prep -> 'snapshot' ->> 'checkoutSessionId') = (SELECT value FROM test_ctx WHERE key = 'guard_session') THEN
    RAISE EXCEPTION 'second principal reused the first principal checkout session';
  END IF;
END $$;
RESET ROLE;
-- A line that becomes unavailable after review (deactivated product,
-- then insufficient stock) must be rejected by the binding itself,
-- never reaching the inner order RPC on its fallback last price.
DO $$ BEGIN
  UPDATE products SET status = 'inactive' WHERE id = '44444444-4444-4444-8444-444444444444';
END $$;
SET request.jwt.claims = '{"role":"authenticated","storefront_order_context":"route","storefront_order_merchant_id":"11111111-1111-4111-8111-111111111111"}';
SET ROLE authenticated;
DO $$
DECLARE
  sid uuid := (SELECT value::uuid FROM test_ctx WHERE key = 'guard_session');
  good jsonb := '{"cart_line_id":"dddddddd-4000-4000-8000-000000000000","product_id":"44444444-4444-4444-8444-444444444444","quantity":1,"price":15,"variant_attributes":{}}';
  rejected boolean := false;
BEGIN
  BEGIN
    PERFORM public.create_storefront_order_with_cart_binding('base', sid, 1,
      jsonb_build_object('p_merchant_id','11111111-1111-4111-8111-111111111111',
        'p_customer_email','test@example.invalid','p_customer_name','Fixture',
        'p_items',jsonb_build_array(good),'p_checkout_idempotency_key','review-unavailable-inactive',
        'p_cart_id','cccccccc-4000-4000-8000-000000000000','p_cart_version',1,
        'p_cart_principal_id','guest-a4'));
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'cart_checkout_stale' THEN RAISE; END IF;
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'binding accepted an inactive-product line'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  UPDATE products SET status = 'active', stock_quantity = 0, stock = 0
  WHERE id = '44444444-4444-4444-8444-444444444444';
END $$;
SET request.jwt.claims = '{"role":"authenticated","storefront_order_context":"route","storefront_order_merchant_id":"11111111-1111-4111-8111-111111111111"}';
SET ROLE authenticated;
DO $$
DECLARE
  sid uuid := (SELECT value::uuid FROM test_ctx WHERE key = 'guard_session');
  good jsonb := '{"cart_line_id":"dddddddd-4000-4000-8000-000000000000","product_id":"44444444-4444-4444-8444-444444444444","quantity":1,"price":15,"variant_attributes":{}}';
  rejected boolean := false;
BEGIN
  BEGIN
    PERFORM public.create_storefront_order_with_cart_binding('base', sid, 1,
      jsonb_build_object('p_merchant_id','11111111-1111-4111-8111-111111111111',
        'p_customer_email','test@example.invalid','p_customer_name','Fixture',
        'p_items',jsonb_build_array(good),'p_checkout_idempotency_key','review-unavailable-stock',
        'p_cart_id','cccccccc-4000-4000-8000-000000000000','p_cart_version',1,
        'p_cart_principal_id','guest-a4'));
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'cart_checkout_stale' THEN RAISE; END IF;
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'binding accepted an insufficient-stock line'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  UPDATE products SET status = 'active', stock_quantity = 10, stock = 10
  WHERE id = '44444444-4444-4444-8444-444444444444';
  IF (SELECT count(*) FROM order_stub_calls WHERE idempotency_key IN ('review-unavailable-inactive','review-unavailable-stock')) <> 0 THEN
    RAISE EXCEPTION 'unavailable cart items reached order mock';
  END IF;
END $$;
SET request.jwt.claims = '{"role":"authenticated","storefront_order_context":"route","storefront_order_merchant_id":"11111111-1111-4111-8111-111111111111"}';
SET ROLE authenticated;
DO $$
DECLARE
  sid uuid := (SELECT value::uuid FROM test_ctx WHERE key = 'guard_session');
  good jsonb := '{"cart_line_id":"dddddddd-4000-4000-8000-000000000000","product_id":"44444444-4444-4444-8444-444444444444","quantity":1,"price":15,"variant_attributes":{}}';
  bad jsonb;
  cases jsonb[];
  rejected boolean;
BEGIN
  cases := ARRAY[
    '[]'::jsonb,
    jsonb_build_array(good || '{"quantity":2}'::jsonb),
    jsonb_build_array(good || '{"product_id":"55555555-5555-4555-8555-555555555555"}'::jsonb),
    jsonb_build_array(good || '{"cart_line_id":"aaaaaaaa-aaaa-4aaa-8aaa-000000000003"}'::jsonb),
    jsonb_build_array(good || '{"variant_attributes":{"color":"wrong"}}'::jsonb),
    jsonb_build_array(good || '{"condition":"used"}'::jsonb),
    jsonb_build_array(good || '{"variant_id":"55555555-5555-4555-8555-555555555555"}'::jsonb),
    jsonb_build_array(good || '{"price":14}'::jsonb),
    jsonb_build_array(good || '{"price":16}'::jsonb),
    jsonb_build_array(good || '{"has_assurance":true,"assurance_fee":1}'::jsonb),
    jsonb_build_array(good, good)
  ];
  FOREACH bad IN ARRAY cases LOOP
    rejected := false;
    BEGIN
      PERFORM public.create_storefront_order_with_cart_binding('base', sid, 1,
        jsonb_build_object('p_merchant_id','11111111-1111-4111-8111-111111111111',
          'p_customer_email','test@example.invalid','p_customer_name','Fixture',
          'p_cart_principal_id','guest-a4',
          'p_items',bad,'p_checkout_idempotency_key','review-invalid'));
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM <> 'cart_checkout_stale' THEN RAISE; END IF;
      rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'binding accepted unrelated or incomplete cart items: %', bad; END IF;
  END LOOP;
  -- A body binding naming another cart or version is stale.
  rejected := false;
  BEGIN
    PERFORM public.create_storefront_order_with_cart_binding('base', sid, 1,
      jsonb_build_object('p_merchant_id','11111111-1111-4111-8111-111111111111',
        'p_customer_email','test@example.invalid','p_customer_name','Fixture',
        'p_items',jsonb_build_array(good),'p_checkout_idempotency_key','review-invalid',
        'p_cart_id','cccccccc-5000-4000-8000-000000000000','p_cart_version',1));
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'cart_checkout_stale' THEN RAISE; END IF;
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'binding accepted a foreign cart id'; END IF;
  rejected := false;
  BEGIN
    PERFORM public.create_storefront_order_with_cart_binding('base', sid, 1,
      jsonb_build_object('p_merchant_id','11111111-1111-4111-8111-111111111111',
        'p_customer_email','test@example.invalid','p_customer_name','Fixture',
        'p_items',jsonb_build_array(good),'p_checkout_idempotency_key','review-invalid',
        'p_cart_id','cccccccc-4000-4000-8000-000000000000','p_cart_version',99));
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'cart_checkout_stale' THEN RAISE; END IF;
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'binding accepted a foreign cart version'; END IF;
  -- A shopper principal that did not prepare the session cannot submit it.
  rejected := false;
  BEGIN
    PERFORM public.create_storefront_order_with_cart_binding('base', sid, 1,
      jsonb_build_object('p_merchant_id','11111111-1111-4111-8111-111111111111',
        'p_customer_email','test@example.invalid','p_customer_name','Fixture',
        'p_items',jsonb_build_array(good),'p_checkout_idempotency_key','review-invalid',
        'p_cart_id','cccccccc-4000-4000-8000-000000000000','p_cart_version',1,
        'p_cart_principal_id','guest-attacker'));
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'cart_order_unauthorized' THEN RAISE; END IF;
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'binding accepted a foreign principal'; END IF;
  -- Omitting the principal entirely must fail closed as unauthorized,
  -- never skip the owner check.
  rejected := false;
  BEGIN
    PERFORM public.create_storefront_order_with_cart_binding('base', sid, 1,
      jsonb_build_object('p_merchant_id','11111111-1111-4111-8111-111111111111',
        'p_customer_email','test@example.invalid','p_customer_name','Fixture',
        'p_items',jsonb_build_array(good),'p_checkout_idempotency_key','review-invalid',
        'p_cart_id','cccccccc-4000-4000-8000-000000000000','p_cart_version',1));
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'cart_order_unauthorized' THEN RAISE; END IF;
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'binding accepted an omitted principal'; END IF;
  -- Match by stable IDs rather than array order; exact fixture succeeds.
  PERFORM public.create_storefront_order_with_cart_binding('base', sid, 1,
    jsonb_build_object('p_merchant_id','11111111-1111-4111-8111-111111111111',
      'p_customer_email','test@example.invalid','p_customer_name','Fixture',
      'p_items',jsonb_build_array(good),'p_checkout_idempotency_key','review-valid',
      'p_cart_id','cccccccc-4000-4000-8000-000000000000','p_cart_version',1,
      'p_cart_principal_id','guest-a4'));
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM order_stub_calls WHERE idempotency_key = 'review-invalid') <> 0 THEN
    RAISE EXCEPTION 'invalid cart items reached order mock';
  END IF;
  IF (SELECT count(*) FROM order_stub_calls WHERE idempotency_key = 'review-valid') <> 1 THEN
    RAISE EXCEPTION 'matching cart must reach order mock once';
  END IF;
  UPDATE commerce_carts SET expires_at = now() - interval '1 second'
    WHERE id = 'cccccccc-5000-4000-8000-000000000000';
END $$;
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-a5","cart_scope":"session","cart_id":"cccccccc-5000-4000-8000-000000000000","cart_grant_id":"99999999-9999-4999-8999-999999999961"}';
SET ROLE commerce_cart_shopper;
DO $$ DECLARE result jsonb; BEGIN
  result := public.commerce_cart_prepare_checkout('cccccccc-5000-4000-8000-000000000000', 1, 'expired-review');
  IF result ->> 'code' <> 'expired' OR (result ->> 'ok')::boolean THEN
    RAISE EXCEPTION 'expired cart was allowed into checkout: %', result;
  END IF;
END $$;
RESET ROLE;

-- Abandoned checkout pointers must not prevent bounded cart expiration.
RESET ROLE;
DO $$ BEGIN
  UPDATE commerce_carts SET expires_at = now() - interval '2 days', checkout_session_id = gen_random_uuid()
    WHERE id = 'cccccccc-6000-4000-8000-000000000000';
  PERFORM cleanup_commerce_carts();
  IF (SELECT state FROM commerce_carts WHERE id = 'cccccccc-6000-4000-8000-000000000000') <> 'expired' THEN
    RAISE EXCEPTION 'abandoned checkout pointer kept expired cart active';
  END IF;
END $$;

-- Authorized activity renews only this cart and this live grant.
UPDATE commerce_carts SET expires_at = now() + interval '1 hour' WHERE id = 'cccccccc-7000-4000-8000-000000000000';
UPDATE commerce_cart_grants SET expires_at = now() + interval '1 hour' WHERE id = '99999999-9999-4999-8999-999999999963';
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-a7","cart_scope":"session","cart_id":"cccccccc-7000-4000-8000-000000000000","cart_grant_id":"99999999-9999-4999-8999-999999999963"}';
SET ROLE commerce_cart_shopper;
DO $$ DECLARE result jsonb; BEGIN
  result := commerce_cart_mutate('cccccccc-7000-4000-8000-000000000000','renew-mutation',1,'{"type":"clear"}');
  IF NOT (result ->> 'ok')::boolean THEN RAISE EXCEPTION 'mutation failed: %', result; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT expires_at FROM commerce_carts WHERE id = 'cccccccc-7000-4000-8000-000000000000') < now() + interval '6 days' THEN
    RAISE EXCEPTION 'authorized mutation did not renew cart expiry';
  END IF;
  IF (SELECT expires_at FROM commerce_cart_grants WHERE id = '99999999-9999-4999-8999-999999999963') < now() + interval '6 days' THEN
    RAISE EXCEPTION 'authorized mutation did not renew live grant';
  END IF;
END $$;

-- The effective mutate definition (this migration supersedes the core
-- commands copy) must carry assurance, in-place negotiated repricing
-- and the voucher quantity pin; subset fixtures alone cannot prove it.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-a9","cart_scope":"session","cart_id":"cccccccc-9000-4000-8000-000000000000","cart_grant_id":"99999999-9999-4999-8999-999999999965"}';
SET ROLE commerce_cart_shopper;
DO $$ DECLARE result jsonb; ver integer; BEGIN
  SELECT version INTO ver FROM commerce_carts WHERE id = 'cccccccc-9000-4000-8000-000000000000';
  result := public.commerce_cart_mutate('cccccccc-9000-4000-8000-000000000000','guard-assurance',ver,
    '{"type":"set_assurance","lineId":"dddddddd-9000-4000-8000-000000000000","hasAssurance":true}'::jsonb);
  IF NOT (result ->> 'ok')::boolean THEN RAISE EXCEPTION 'effective mutate lost set_assurance: %', result; END IF;
  IF NOT EXISTS (SELECT 1 FROM commerce_cart_lines WHERE id = 'dddddddd-9000-4000-8000-000000000000' AND has_assurance AND assurance_rate = 0.05) THEN
    RAISE EXCEPTION 'effective set_assurance must persist the server-owned rate';
  END IF;
  SELECT version INTO ver FROM commerce_carts WHERE id = 'cccccccc-9000-4000-8000-000000000000';
  result := public.commerce_cart_mutate('cccccccc-9000-4000-8000-000000000000','guard-reprice-deep',ver,
    '{"type":"set_negotiated_price","lineId":"dddddddd-9000-4000-8000-000000000000","negotiatedUnitPriceMinor":1200}'::jsonb);
  IF NOT (result ->> 'ok')::boolean THEN RAISE EXCEPTION 'effective mutate lost set_negotiated_price: %', result; END IF;
  -- A 20% self-proposal exceeds the 2% auto-negotiation band: it is
  -- stored as a pending proposal on the same line, never accepted.
  IF NOT EXISTS (SELECT 1 FROM commerce_cart_lines WHERE id = 'dddddddd-9000-4000-8000-000000000000' AND negotiated_unit_price_minor = 1200 AND negotiation_status = 'pending' AND quantity = 1) THEN
    RAISE EXCEPTION 'deep self-proposal must stay pending on the same line';
  END IF;
  SELECT version INTO ver FROM commerce_carts WHERE id = 'cccccccc-9000-4000-8000-000000000000';
  result := public.commerce_cart_mutate('cccccccc-9000-4000-8000-000000000000','guard-reprice-band',ver,
    '{"type":"set_negotiated_price","lineId":"dddddddd-9000-4000-8000-000000000000","negotiatedUnitPriceMinor":1470}'::jsonb);
  IF NOT (result ->> 'ok')::boolean THEN RAISE EXCEPTION 'in-band reprice must succeed: %', result; END IF;
  IF NOT EXISTS (SELECT 1 FROM commerce_cart_lines WHERE id = 'dddddddd-9000-4000-8000-000000000000' AND negotiated_unit_price_minor = 1470 AND negotiation_status = 'accepted' AND quantity = 1) THEN
    RAISE EXCEPTION 'in-band reprice must auto-accept on the same line';
  END IF;
END $$;
RESET ROLE;
UPDATE commerce_cart_lines SET voucher_token = 'voucher-tok-9000' WHERE id = 'dddddddd-9000-4000-8000-000000000000';
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-a9","cart_scope":"session","cart_id":"cccccccc-9000-4000-8000-000000000000","cart_grant_id":"99999999-9999-4999-8999-999999999965"}';
SET ROLE commerce_cart_shopper;
DO $$ DECLARE result jsonb; ver integer; BEGIN
  SELECT version INTO ver FROM commerce_carts WHERE id = 'cccccccc-9000-4000-8000-000000000000';
  result := public.commerce_cart_mutate('cccccccc-9000-4000-8000-000000000000','guard-voucher-qty',ver,
    '{"type":"set_quantity","lineId":"dddddddd-9000-4000-8000-000000000000","quantity":2}'::jsonb);
  IF (result ->> 'ok')::boolean OR result ->> 'code' <> 'invalid_item' THEN
    RAISE EXCEPTION 'voucher line quantity must stay pinned to one: %', result;
  END IF;
END $$;
RESET ROLE;

-- Negotiation policy: deep or non-negotiable proposals never charge.
INSERT INTO products (id, merchant_id, price, status, stock_quantity, stock, manage_stock, brand, name) VALUES
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '11111111-1111-4111-8111-111111111111', 100.00, 'active', 10, 10, true, 'Tecno', 'Tecno Spark 20');
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-a9","cart_scope":"session","cart_id":"cccccccc-9000-4000-8000-000000000000","cart_grant_id":"99999999-9999-4999-8999-999999999965"}';
SET ROLE commerce_cart_shopper;
DO $$ DECLARE result jsonb; ver integer; BEGIN
  SELECT version INTO ver FROM commerce_carts WHERE id = 'cccccccc-9000-4000-8000-000000000000';
  result := public.commerce_cart_mutate('cccccccc-9000-4000-8000-000000000000','guard-add-deep',ver,
    '{"type":"add","item":{"productId":"33333333-3333-4333-8333-333333333333"},"quantity":1,"negotiatedUnitPriceMinor":1}'::jsonb);
  IF NOT (result ->> 'ok')::boolean THEN RAISE EXCEPTION 'deep add proposal must be stored, got: %', result; END IF;
  IF NOT EXISTS (SELECT 1 FROM commerce_cart_lines WHERE cart_id = 'cccccccc-9000-4000-8000-000000000000' AND product_id = '33333333-3333-4333-8333-333333333333' AND negotiated_unit_price_minor = 1 AND negotiation_status = 'pending') THEN
    RAISE EXCEPTION 'a 1-minor self-proposal must stay pending, never accepted';
  END IF;
  SELECT version INTO ver FROM commerce_carts WHERE id = 'cccccccc-9000-4000-8000-000000000000';
  result := public.commerce_cart_mutate('cccccccc-9000-4000-8000-000000000000','guard-add-tecno',ver,
    '{"type":"add","item":{"productId":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"},"quantity":1,"negotiatedUnitPriceMinor":9900}'::jsonb);
  IF NOT (result ->> 'ok')::boolean THEN RAISE EXCEPTION 'tecno proposal must be stored, got: %', result; END IF;
  IF NOT EXISTS (SELECT 1 FROM commerce_cart_lines WHERE cart_id = 'cccccccc-9000-4000-8000-000000000000' AND product_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' AND negotiation_status = 'pending') THEN
    RAISE EXCEPTION 'non-negotiable brands must never auto-accept, even in band';
  END IF;
END $$;
RESET ROLE;
DO $$ DECLARE snap jsonb; line jsonb; BEGIN
  SELECT public.commerce_cart_build_checkout_snapshot('11111111-1111-4111-8111-111111111111', 'cccccccc-9000-4000-8000-000000000000') INTO snap;
  SELECT l INTO line FROM jsonb_array_elements(snap -> 'lines') l WHERE l ->> 'productId' = '33333333-3333-4333-8333-333333333333';
  IF (line ->> 'effectiveUnitPriceMinor')::integer <> 25000 THEN
    RAISE EXCEPTION 'pending proposal must charge catalog, got %', line;
  END IF;
END $$;

-- A near-expiry cart must remain usable for the accepted checkout session.
UPDATE commerce_carts SET expires_at = now() + interval '1 second' WHERE id = 'cccccccc-8000-4000-8000-000000000000';

-- A valid ten-unit gadget basket can exceed int32 minor units.
UPDATE products SET price = 4000000, stock_quantity = 20, stock = 20 WHERE id = '44444444-4444-4444-8444-444444444444';
UPDATE commerce_cart_lines SET quantity = 10 WHERE cart_id = 'cccccccc-8000-4000-8000-000000000000';
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-a8","cart_scope":"session","cart_id":"cccccccc-8000-4000-8000-000000000000","cart_grant_id":"99999999-9999-4999-8999-999999999964"}';
SET ROLE commerce_cart_shopper;
DO $$ DECLARE result jsonb; BEGIN
  result := commerce_cart_prepare_checkout('cccccccc-8000-4000-8000-000000000000',1,'large-total');
  IF NOT coalesce((result ->> 'ok')::boolean, false)
    OR (result -> 'snapshot' -> 'estimates' ->> 'subtotalMinor')::bigint IS DISTINCT FROM 4000000000 THEN
    RAISE EXCEPTION 'valid large basket lost its exact total: %',result;
  END IF;
END $$;
RESET ROLE;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM commerce_carts c
    JOIN commerce_cart_checkout_sessions s ON s.id = c.checkout_session_id
    WHERE c.id = 'cccccccc-8000-4000-8000-000000000000'
      AND c.expires_at < s.expires_at
  ) THEN RAISE EXCEPTION 'accepted checkout outlives its cart'; END IF;
END $$;

-- Platform-delegated (agentic) submits derive their items from the
-- reviewed snapshot: caller-supplied identities/prices are not echoed,
-- so a delegated caller cannot reprice or substitute lines. The order
-- mock must receive the reviewed line id and effective price.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-a12","cart_scope":"session","cart_id":"cccccccc-c000-4000-8000-000000000000","cart_grant_id":"99999999-9999-4999-8999-999999999968"}';
SET ROLE commerce_cart_shopper;
DO $$ DECLARE prep jsonb; BEGIN
  prep := public.commerce_cart_prepare_checkout('cccccccc-c000-4000-8000-000000000000', 1, 'review-agentic');
  IF NOT (prep ->> 'ok')::boolean THEN RAISE EXCEPTION 'agentic fixture prepare failed: %', prep; END IF;
  INSERT INTO test_ctx VALUES ('agentic_session', prep -> 'snapshot' ->> 'checkoutSessionId');
END $$;
RESET ROLE;
SET request.jwt.claims = '{"role":"authenticated","agentic_context":"checkout","agentic_merchant_id":"11111111-1111-4111-8111-111111111111"}';
SET ROLE authenticated;
DO $$ DECLARE result jsonb; BEGIN
  SELECT public.create_storefront_order_with_cart_binding('base',
    (SELECT value::uuid FROM test_ctx WHERE key = 'agentic_session'), 1,
    jsonb_build_object('p_merchant_id','11111111-1111-4111-8111-111111111111',
      'p_customer_email','test@example.invalid','p_customer_name','Fixture',
      'p_cart_principal_id','guest-a12',
      'p_items', jsonb_build_array(jsonb_build_object(
        'product_id','44444444-4444-4444-8444-444444444444','quantity',1,'price',999)),
      'p_checkout_idempotency_key','review-agentic')
  ) INTO result;
  IF NOT (result ->> 'ok')::boolean THEN RAISE EXCEPTION 'agentic derived submit must succeed, got %', result; END IF;
END $$;
RESET ROLE;
DO $$ DECLARE items jsonb; BEGIN
  SELECT c.items INTO items FROM order_stub_calls c
  WHERE c.idempotency_key = 'review-agentic';
  IF items IS NULL OR jsonb_array_length(items) <> 1 THEN
    RAISE EXCEPTION 'agentic submit must reach the order mock once, got %', items;
  END IF;
  IF (items -> 0 ->> 'cart_line_id') <> 'dddddddd-c000-4000-8000-000000000000'
    OR (items -> 0 ->> 'price')::numeric <> (
      SELECT price FROM products WHERE id = '44444444-4444-4444-8444-444444444444'
    ) THEN
    RAISE EXCEPTION 'agentic items must be derived from the reviewed snapshot, got %', items;
  END IF;
END $$;

-- Pilot gate: with the shared_cart feature removed, the cart RPCs
-- refuse the merchant even with otherwise-valid session claims.
UPDATE public.merchants SET premium_features = '[]'::jsonb
WHERE id = '11111111-1111-4111-8111-111111111111';
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-a12","cart_scope":"session","cart_id":"cccccccc-c000-4000-8000-000000000000","cart_grant_id":"99999999-9999-4999-8999-999999999968"}';
SET ROLE commerce_cart_shopper;
DO $$ DECLARE result jsonb; BEGIN
  result := public.commerce_cart_mutate('cccccccc-c000-4000-8000-000000000000', 'review-unenrolled', 2,
    '{"type":"clear"}'::jsonb);
  IF (result ->> 'code') <> 'merchant_unavailable' THEN
    RAISE EXCEPTION 'unenrolled merchant must be refused, got %', result;
  END IF;
END $$;
RESET ROLE;
UPDATE public.merchants
SET premium_features = '["shared_cart","shared_cart_accounts","shared_cart_realtime"]'::jsonb
WHERE id = '11111111-1111-4111-8111-111111111111';

-- Prepare replay must not revive an expired session, and preparing
-- near cart expiry extends the preparing grant to the session end.
UPDATE public.commerce_cart_grants SET expires_at = now() + interval '1 minute'
WHERE id = '99999999-9999-4999-8999-999999999966';
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-a10","cart_scope":"session","cart_id":"cccccccc-a000-4000-8000-000000000000","cart_grant_id":"99999999-9999-4999-8999-999999999966"}';
SET ROLE commerce_cart_shopper;
DO $$ DECLARE result jsonb; BEGIN
  result := public.commerce_cart_prepare_checkout('cccccccc-a000-4000-8000-000000000000', 1, 'review-replay-expire');
  IF NOT (result ->> 'ok')::boolean THEN RAISE EXCEPTION 'prepare must succeed, got %', result; END IF;
  INSERT INTO test_ctx VALUES ('replay_session', result -> 'snapshot' ->> 'checkoutSessionId');
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT expires_at FROM public.commerce_cart_grants
      WHERE id = '99999999-9999-4999-8999-999999999966') < now() + interval '20 minutes' THEN
    RAISE EXCEPTION 'preparing grant must extend to cover the session lifetime';
  END IF;
  UPDATE public.commerce_cart_checkout_sessions SET expires_at = now() - interval '1 second'
  WHERE id = (SELECT value::uuid FROM test_ctx WHERE key = 'replay_session');
END $$;
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-a10","cart_scope":"session","cart_id":"cccccccc-a000-4000-8000-000000000000","cart_grant_id":"99999999-9999-4999-8999-999999999966"}';
SET ROLE commerce_cart_shopper;
DO $$ DECLARE result jsonb; BEGIN
  result := public.commerce_cart_prepare_checkout('cccccccc-a000-4000-8000-000000000000', 1, 'review-replay-expire');
  IF (result ->> 'ok')::boolean OR (result ->> 'code') <> 'expired' THEN
    RAISE EXCEPTION 'expired session replay must report expired, got %', result;
  END IF;
END $$;
RESET ROLE;

-- Repeated preparation cannot push a cart or grant past the absolute
-- 7-day lifetime: this cart was created 6d23h50m ago and expires in
-- five minutes, so a fresh prepare may extend it by minutes, not by a
-- full new session window beyond the cap.
INSERT INTO commerce_carts (id, merchant_id, currency, version, state, created_at, expires_at) VALUES
  ('cccccccc-e000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', 'NGN', 1, 'active', now() - interval '6 days 23 hours 50 minutes', now() + interval '5 minutes');
INSERT INTO commerce_cart_lines (merchant_id, cart_id, product_id, quantity, last_unit_price_minor) VALUES
  ('11111111-1111-4111-8111-111111111111', 'cccccccc-e000-4000-8000-000000000000', '44444444-4444-4444-8444-444444444444', 1, 1500);
INSERT INTO commerce_cart_grants (id, merchant_id, cart_id, principal_id, expires_at, revoked_at, created_at) VALUES
  ('99999999-9999-4999-8999-999999999971', '11111111-1111-4111-8111-111111111111', 'cccccccc-e000-4000-8000-000000000000', 'guest-cap', now() + interval '5 minutes', NULL, now() - interval '6 days 23 hours 50 minutes');
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-cap","cart_scope":"session","cart_id":"cccccccc-e000-4000-8000-000000000000","cart_grant_id":"99999999-9999-4999-8999-999999999971"}';
SET ROLE commerce_cart_shopper;
DO $$ DECLARE result jsonb; BEGIN
  result := public.commerce_cart_prepare_checkout('cccccccc-e000-4000-8000-000000000000', 1, 'cap-prepare-1');
  IF NOT (result ->> 'ok')::boolean THEN RAISE EXCEPTION 'cap prepare must succeed, got %', result; END IF;
END $$;
RESET ROLE;
DO $$ DECLARE v_cart_cap timestamptz; v_grant_cap timestamptz; BEGIN
  SELECT created_at + interval '7 days' INTO v_cart_cap FROM commerce_carts WHERE id = 'cccccccc-e000-4000-8000-000000000000';
  IF EXISTS (SELECT 1 FROM commerce_carts WHERE id = 'cccccccc-e000-4000-8000-000000000000' AND expires_at > v_cart_cap) THEN
    RAISE EXCEPTION 'prepare must not extend the cart past its absolute lifetime';
  END IF;
  SELECT created_at + interval '7 days' INTO v_grant_cap FROM commerce_cart_grants WHERE id = '99999999-9999-4999-8999-999999999971';
  IF EXISTS (SELECT 1 FROM commerce_cart_grants WHERE id = '99999999-9999-4999-8999-999999999971' AND expires_at > v_grant_cap) THEN
    RAISE EXCEPTION 'prepare must not extend the grant past its absolute lifetime';
  END IF;
END $$;

-- Cart creation is bound by the same negotiation policy: initial
-- lines cannot self-accept a deep or non-negotiable price either.
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-create-policy","cart_scope":"bootstrap"}';
SET ROLE commerce_cart_shopper;
DO $$ DECLARE result jsonb; BEGIN
  result := public.commerce_cart_create('create-policy-deep',
    '[{"item":{"productId":"44444444-4444-4444-8444-444444444444"},"quantity":1,"negotiatedUnitPriceMinor":1}]'::jsonb, 'NGN');
  IF NOT (result ->> 'ok')::boolean THEN RAISE EXCEPTION 'create with deep proposal must succeed, got %', result; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM commerce_cart_lines l JOIN commerce_carts c ON c.id = l.cart_id
    WHERE c.merchant_id = '11111111-1111-4111-8111-111111111111' AND l.product_id = '44444444-4444-4444-8444-444444444444'
      AND l.negotiated_unit_price_minor = 1 AND l.negotiation_status = 'pending') THEN
    RAISE EXCEPTION 'create must store a deep proposal as pending, never accepted';
  END IF;
END $$;
SET ROLE commerce_cart_shopper;
DO $$ DECLARE result jsonb; BEGIN
  result := public.commerce_cart_create('create-policy-tecno',
    '[{"item":{"productId":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"},"quantity":1,"negotiatedUnitPriceMinor":9900}]'::jsonb, 'NGN');
  IF NOT (result ->> 'ok')::boolean THEN RAISE EXCEPTION 'create with tecno proposal must succeed, got %', result; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM commerce_cart_lines WHERE product_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' AND negotiation_status = 'pending') THEN
    RAISE EXCEPTION 'create must never auto-accept a non-negotiable brand';
  END IF;
END $$;
SET ROLE commerce_cart_shopper;
DO $$ DECLARE result jsonb; BEGIN
  result := public.commerce_cart_create('create-policy-band',
    '[{"item":{"productId":"44444444-4444-4444-8444-444444444444"},"quantity":1,"negotiatedUnitPriceMinor":1470}]'::jsonb, 'NGN');
  IF NOT (result ->> 'ok')::boolean THEN RAISE EXCEPTION 'create with in-band proposal must succeed, got %', result; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM commerce_cart_lines WHERE product_id = '44444444-4444-4444-8444-444444444444' AND negotiated_unit_price_minor = 1470 AND negotiation_status = 'accepted') THEN
    RAISE EXCEPTION 'create must auto-accept an in-band proposal on a negotiable product';
  END IF;
END $$;

-- Voucher lines review at zero (mirroring build-order-items and the TS
-- snapshot) while the catalog value stays available for validation,
-- and stock demand is pooled per (product, variant) exactly like the
-- order function validates and decrements it.
INSERT INTO products (id, merchant_id, price, status, stock_quantity, stock, manage_stock, brand, name) VALUES
  ('ffffffff-ffff-4fff-8fff-fffffffffff1', '11111111-1111-4111-8111-111111111111', 20.00, 'active', 10, 10, true, 'Generic', 'Voucher Widget'),
  ('ffffffff-ffff-4fff-8fff-fffffffffff2', '11111111-1111-4111-8111-111111111111', 10.00, 'active', 2, 2, true, 'Generic', 'Pooled Widget');
INSERT INTO commerce_carts (id, merchant_id, currency, version, state, created_at, expires_at) VALUES
  ('cccccccc-f000-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', 'NGN', 1, 'active', now(), now() + interval '1 hour'),
  ('cccccccc-f100-4000-8000-000000000000', '11111111-1111-4111-8111-111111111111', 'NGN', 1, 'active', now(), now() + interval '1 hour');
INSERT INTO commerce_cart_lines (id, merchant_id, cart_id, product_id, quantity, last_unit_price_minor, voucher_token) VALUES
  ('dddddddd-f000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'cccccccc-f000-4000-8000-000000000000', 'ffffffff-ffff-4fff-8fff-fffffffffff1', 1, 2000, NULL),
  ('dddddddd-f000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'cccccccc-f000-4000-8000-000000000000', 'ffffffff-ffff-4fff-8fff-fffffffffff1', 1, 2000, 'tok-review-zero'),
  ('dddddddd-f100-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'cccccccc-f100-4000-8000-000000000000', 'ffffffff-ffff-4fff-8fff-fffffffffff2', 2, 1000, NULL),
  ('dddddddd-f100-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'cccccccc-f100-4000-8000-000000000000', 'ffffffff-ffff-4fff-8fff-fffffffffff2', 1, 1000, 'tok-review-pool');
INSERT INTO commerce_cart_grants (id, merchant_id, cart_id, principal_id, expires_at, revoked_at) VALUES
  ('99999999-9999-4999-8999-999999999972', '11111111-1111-4111-8111-111111111111', 'cccccccc-f000-4000-8000-000000000000', 'guest-voucher-review', now() + interval '7 days', NULL);
DO $$ DECLARE snap jsonb; vline jsonb; oline jsonb; BEGIN
  SELECT public.commerce_cart_build_checkout_snapshot('11111111-1111-4111-8111-111111111111', 'cccccccc-f000-4000-8000-000000000000') INTO snap;
  SELECT l INTO vline FROM jsonb_array_elements(snap -> 'lines') l WHERE l ->> 'id' = 'dddddddd-f000-4000-8000-000000000002';
  SELECT l INTO oline FROM jsonb_array_elements(snap -> 'lines') l WHERE l ->> 'id' = 'dddddddd-f000-4000-8000-000000000001';
  IF (vline ->> 'effectiveUnitPriceMinor')::integer <> 0 THEN
    RAISE EXCEPTION 'voucher line must review at zero, got %', vline;
  END IF;
  IF (vline ->> 'validatedUnitPriceMinor')::integer <> 2000 THEN
    RAISE EXCEPTION 'voucher line must retain the catalog value for validation, got %', vline;
  END IF;
  IF (oline ->> 'effectiveUnitPriceMinor')::integer <> 2000 THEN
    RAISE EXCEPTION 'ordinary line must review at catalog, got %', oline;
  END IF;
  IF (snap -> 'estimates' ->> 'subtotalMinor')::bigint <> 2000 THEN
    RAISE EXCEPTION 'reviewed subtotal must exclude the voucher line, got %', snap;
  END IF;
  SELECT public.commerce_cart_build_checkout_snapshot('11111111-1111-4111-8111-111111111111', 'cccccccc-f100-4000-8000-000000000000') INTO snap;
  IF (snap -> 'estimates' ->> 'unavailableCount')::integer <> 2 THEN
    RAISE EXCEPTION 'pooled demand 3 against stock 2 must mark both lines unavailable, got %', snap;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(snap -> 'lines') l WHERE (l ->> 'available')::boolean) THEN
    RAISE EXCEPTION 'no pooled line may report available, got %', snap;
  END IF;
END $$;
UPDATE products SET stock_quantity = 3, stock = 3 WHERE id = 'ffffffff-ffff-4fff-8fff-fffffffffff2';
DO $$ DECLARE snap jsonb; BEGIN
  SELECT public.commerce_cart_build_checkout_snapshot('11111111-1111-4111-8111-111111111111', 'cccccccc-f100-4000-8000-000000000000') INTO snap;
  IF (snap -> 'estimates' ->> 'unavailableCount')::integer <> 0 THEN
    RAISE EXCEPTION 'pooled demand 3 against stock 3 must be available, got %', snap;
  END IF;
END $$;
SET request.jwt.claims = '{"cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"guest-voucher-review","cart_scope":"session","cart_id":"cccccccc-f000-4000-8000-000000000000","cart_grant_id":"99999999-9999-4999-8999-999999999972"}';
SET ROLE commerce_cart_shopper;
DO $$ DECLARE prep jsonb; BEGIN
  prep := public.commerce_cart_prepare_checkout('cccccccc-f000-4000-8000-000000000000', 1, 'review-voucher-zero');
  IF NOT (prep ->> 'ok')::boolean THEN RAISE EXCEPTION 'voucher prepare failed: %', prep; END IF;
  IF prep ->> 'grantExpiresAt' IS NULL THEN
    RAISE EXCEPTION 'prepare must report the grant expiry: %', prep;
  END IF;
  INSERT INTO test_ctx VALUES ('voucher_session', prep -> 'snapshot' ->> 'checkoutSessionId');
  INSERT INTO test_ctx VALUES ('voucher_grant_exp', prep ->> 'grantExpiresAt');
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT expires_at FROM public.commerce_cart_grants WHERE id = '99999999-9999-4999-8999-999999999972')
     <> (SELECT value::timestamptz FROM test_ctx WHERE key = 'voucher_grant_exp') THEN
    RAISE EXCEPTION 'prepare grantExpiresAt must equal the live grant expiry';
  END IF;
END $$;
SET request.jwt.claims = '{"role":"authenticated","storefront_order_context":"route","storefront_order_merchant_id":"11111111-1111-4111-8111-111111111111"}';
SET ROLE authenticated;
DO $$ DECLARE result jsonb; BEGIN
  SELECT public.create_storefront_order_with_cart_binding('base',
    (SELECT value::uuid FROM test_ctx WHERE key = 'voucher_session'), 1,
    jsonb_build_object('p_merchant_id','11111111-1111-4111-8111-111111111111',
      'p_customer_email','test@example.invalid','p_customer_name','Fixture',
      'p_cart_principal_id','guest-voucher-review',
      'p_items', jsonb_build_array(
        jsonb_build_object('cart_line_id','dddddddd-f000-4000-8000-000000000001','product_id','ffffffff-ffff-4fff-8fff-fffffffffff1','quantity',1,'price',20,'variant_attributes',jsonb_build_object()),
        jsonb_build_object('cart_line_id','dddddddd-f000-4000-8000-000000000002','product_id','ffffffff-ffff-4fff-8fff-fffffffffff1','quantity',1,'price',0,'variant_attributes',jsonb_build_object())
      ),
      'p_checkout_idempotency_key','review-voucher-zero')
  ) INTO result;
  IF NOT (result ->> 'ok')::boolean THEN
    RAISE EXCEPTION 'zero-priced voucher submit must succeed, got %', result;
  END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM order_stub_calls WHERE idempotency_key = 'review-voucher-zero') <> 1 THEN
    RAISE EXCEPTION 'voucher order must reach the order mock once';
  END IF;
END $$;
