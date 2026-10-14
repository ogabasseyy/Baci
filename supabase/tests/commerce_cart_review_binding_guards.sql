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
