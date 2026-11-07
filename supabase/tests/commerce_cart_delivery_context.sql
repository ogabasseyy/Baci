-- Executed by run_commerce_cart_checkout_add_identity.py against its
-- disposable PostgreSQL fixture after the shared-cart checkout migrations.
CREATE TEMP TABLE delivery_context_failures(message text);
CREATE FUNCTION pg_temp.check_delivery_context(ok boolean, message text)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO delivery_context_failures SELECT message WHERE NOT coalesce(ok, false)
$$;

DO $test$
DECLARE
  merchant uuid := '11111111-1111-4111-8111-111111111111';
  cart uuid := 'aaaaaaaa-6600-4000-8000-000000000001';
  grant_id uuid := 'bbbbbbbb-6600-4000-8000-000000000001';
  other_grant uuid := 'bbbbbbbb-6600-4000-8000-000000000002';
  product uuid := '44444444-4444-4444-8444-444444444444';
  session_id uuid := 'cccccccc-6600-4000-8000-000000000001';
  principal text := 'delivery-context-principal';
  result jsonb;
  claims jsonb;
  malformed jsonb;
BEGIN
  INSERT INTO public.commerce_carts(id, merchant_id, currency, version, state, expires_at)
  VALUES (cart, merchant, 'NGN', 3, 'active', now() + interval '1 day');
  INSERT INTO public.commerce_cart_grants(id, merchant_id, cart_id, principal_id, expires_at)
  VALUES
    (grant_id, merchant, cart, principal, now() + interval '1 day'),
    (other_grant, merchant, cart, 'delivery-context-other', now() + interval '1 day');
  INSERT INTO public.commerce_cart_checkout_sessions(
    id, merchant_id, cart_id, checkout_generation, cart_version_reviewed,
    principal_id, preparing_grant_id, reviewed_snapshot, expires_at
  ) VALUES (
    session_id, merchant, cart, 7, 3, principal, grant_id,
    jsonb_build_object(
      'lines', jsonb_build_array(jsonb_build_object(
        'productId', product, 'variantId', NULL, 'condition', 'new', 'quantity', 2,
        'effectiveUnitPriceMinor', 99900, 'voucherToken', 'must-not-leak'
      )),
      'estimates', jsonb_build_object('currency', 'NGN', 'subtotalMinor', 199800)
    ), now() + interval '30 minutes'
  );
  UPDATE public.commerce_carts SET checkout_session_id = session_id WHERE id = cart;

  claims := jsonb_build_object(
    'role', 'commerce_cart_shopper', 'exp', 9999999999,
    'cart_scope', 'session', 'cart_merchant_id', merchant,
    'cart_id', cart, 'cart_grant_id', grant_id, 'cart_principal_id', principal
  );
  PERFORM set_config('request.jwt.claims', claims::text, true);
  result := public.commerce_cart_delivery_context(session_id, 7, 3);
  PERFORM pg_temp.check_delivery_context(result->>'ok' = 'true', 'valid prepared caller was rejected');
  PERFORM pg_temp.check_delivery_context(
    result->'context'->'items' = jsonb_build_array(jsonb_build_object(
      'productId', product, 'variantId', NULL, 'condition', 'new', 'quantity', 2
    )), 'response was not the bounded canonical item context'
  );
  PERFORM pg_temp.check_delivery_context(
    NOT (result::text LIKE '%voucherToken%' OR result::text LIKE '%effectiveUnitPriceMinor%'
      OR result::text LIKE '%subtotalMinor%'), 'private or non-shipping snapshot fields leaked'
  );
  PERFORM pg_temp.check_delivery_context(
    has_function_privilege('commerce_cart_shopper', 'public.commerce_cart_delivery_context(uuid,integer,integer)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.commerce_cart_delivery_context(uuid,integer,integer)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.commerce_cart_delivery_context(uuid,integer,integer)', 'EXECUTE')
      AND NOT has_function_privilege('service_role', 'public.commerce_cart_delivery_context(uuid,integer,integer)', 'EXECUTE'),
    'delivery context RPC execution grants are broader than the shopper role'
  );

  UPDATE public.commerce_cart_checkout_sessions
  SET reviewed_snapshot = jsonb_set(reviewed_snapshot, '{lines,0,quantity}', '10'::jsonb)
  WHERE id = session_id;
  result := public.commerce_cart_delivery_context(session_id, 7, 3);
  PERFORM pg_temp.check_delivery_context(
    result->>'ok' = 'true' AND result->'context'->'items'->0->>'quantity' = '10',
    'maximum canonical line quantity of 10 was rejected or changed'
  );
  UPDATE public.commerce_cart_checkout_sessions
  SET reviewed_snapshot = jsonb_set(reviewed_snapshot, '{lines,0,quantity}', '11'::jsonb)
  WHERE id = session_id;
  result := public.commerce_cart_delivery_context(session_id, 7, 3);
  PERFORM pg_temp.check_delivery_context(result->>'ok' = 'false', 'line quantity above the cart limit of 10 was accepted');
  UPDATE public.commerce_cart_checkout_sessions
  SET reviewed_snapshot = jsonb_set(reviewed_snapshot, '{lines,0,quantity}', '2'::jsonb)
  WHERE id = session_id;

  FOREACH malformed IN ARRAY ARRAY['"not-a-number"'::jsonb, 'null'::jsonb, '{}'::jsonb]
  LOOP
    PERFORM set_config('request.jwt.claims', (claims || jsonb_build_object('exp', malformed))::text, true);
    result := public.commerce_cart_delivery_context(session_id, 7, 3);
    PERFORM pg_temp.check_delivery_context(result->>'ok' = 'false', 'malformed expiration claim was not rejected');
  END LOOP;
  PERFORM set_config('request.jwt.claims', claims::text, true);

  FOREACH malformed IN ARRAY ARRAY['null'::jsonb, '{}'::jsonb, '"scalar"'::jsonb, '3'::jsonb]
  LOOP
    UPDATE public.commerce_cart_checkout_sessions
    SET reviewed_snapshot = jsonb_build_object(
      'lines', malformed,
      'estimates', jsonb_build_object('currency', 'NGN')
    ) WHERE id = session_id;
    result := public.commerce_cart_delivery_context(session_id, 7, 3);
    PERFORM pg_temp.check_delivery_context(result->>'ok' = 'false', 'non-array reviewed lines were not rejected');
  END LOOP;
  UPDATE public.commerce_cart_checkout_sessions
  SET reviewed_snapshot = jsonb_build_object(
    'lines', jsonb_build_array(jsonb_build_object(
      'productId', product, 'variantId', NULL, 'condition', 'new', 'quantity', 2,
      'effectiveUnitPriceMinor', 99900, 'voucherToken', 'must-not-leak'
    )),
    'estimates', jsonb_build_object('currency', 'NGN', 'subtotalMinor', 199800)
  ) WHERE id = session_id;

  UPDATE public.commerce_carts SET state = 'checkout' WHERE id = cart;
  result := public.commerce_cart_delivery_context(session_id, 7, 3);
  PERFORM pg_temp.check_delivery_context(result->>'ok' = 'false', 'inactive cart state was accepted');
  UPDATE public.commerce_carts SET state = 'active' WHERE id = cart;

  UPDATE public.commerce_carts SET checkout_session_id = NULL WHERE id = cart;
  result := public.commerce_cart_delivery_context(session_id, 7, 3);
  PERFORM pg_temp.check_delivery_context(result->>'ok' = 'false', 'mismatched cart session pointer was accepted');
  UPDATE public.commerce_carts SET checkout_session_id = session_id WHERE id = cart;

  UPDATE public.commerce_cart_checkout_sessions
  SET reviewed_snapshot = jsonb_build_object(
    'lines', '[]'::jsonb, 'estimates', jsonb_build_object('currency', 'NGN')
  ) WHERE id = session_id;
  result := public.commerce_cart_delivery_context(session_id, 7, 3);
  PERFORM pg_temp.check_delivery_context(result->>'ok' = 'false', 'empty reviewed lines were accepted');

  UPDATE public.commerce_cart_checkout_sessions
  SET reviewed_snapshot = jsonb_build_object(
    'lines', (SELECT jsonb_agg(jsonb_build_object(
      'productId', product, 'variantId', NULL, 'condition', 'new', 'quantity', 1
    )) FROM generate_series(1, 21)),
    'estimates', jsonb_build_object('currency', 'NGN')
  ) WHERE id = session_id;
  result := public.commerce_cart_delivery_context(session_id, 7, 3);
  PERFORM pg_temp.check_delivery_context(result->>'ok' = 'false', 'reviewed line count above 20 was accepted');

  FOREACH malformed IN ARRAY ARRAY[
    jsonb_build_object('productId', product, 'variantId', NULL, 'condition', 'new', 'quantity', 0),
    jsonb_build_object('productId', product, 'variantId', 'not-a-uuid', 'condition', 'new', 'quantity', 1),
    jsonb_build_object('productId', product, 'variantId', NULL, 'condition', 'oversize', 'quantity', 1)
  ]
  LOOP
    UPDATE public.commerce_cart_checkout_sessions
    SET reviewed_snapshot = jsonb_build_object(
      'lines', jsonb_build_array(malformed),
      'estimates', jsonb_build_object('currency', 'NGN')
    ) WHERE id = session_id;
    result := public.commerce_cart_delivery_context(session_id, 7, 3);
    PERFORM pg_temp.check_delivery_context(result->>'ok' = 'false', 'invalid item quantity, variant, or condition was accepted');
  END LOOP;
  UPDATE public.commerce_cart_checkout_sessions
  SET reviewed_snapshot = jsonb_build_object(
    'lines', jsonb_build_array(jsonb_build_object(
      'productId', product, 'variantId', NULL, 'condition', 'new', 'quantity', 2
    )), 'estimates', jsonb_build_object('currency', 'nGn')
  ) WHERE id = session_id;
  result := public.commerce_cart_delivery_context(session_id, 7, 3);
  PERFORM pg_temp.check_delivery_context(result->>'ok' = 'false', 'invalid currency was accepted');
  UPDATE public.commerce_cart_checkout_sessions
  SET reviewed_snapshot = jsonb_build_object(
    'lines', jsonb_build_array(jsonb_build_object(
      'productId', product, 'variantId', NULL, 'condition', 'new', 'quantity', 2,
      'effectiveUnitPriceMinor', 99900, 'voucherToken', 'must-not-leak'
    )), 'estimates', jsonb_build_object('currency', 'NGN', 'subtotalMinor', 199800)
  ) WHERE id = session_id;

  INSERT INTO public.commerce_cart_device_retirements(merchant_id, device_principal_id)
  VALUES (merchant, principal);
  result := public.commerce_cart_delivery_context(session_id, 7, 3);
  PERFORM pg_temp.check_delivery_context(result->>'ok' = 'false', 'retired device was accepted');
  DELETE FROM public.commerce_cart_device_retirements
  WHERE merchant_id = merchant AND device_principal_id = principal;

  UPDATE public.commerce_carts
  SET created_at = now() - interval '8 days', expires_at = now() + interval '1 day'
  WHERE id = cart;
  result := public.commerce_cart_delivery_context(session_id, 7, 3);
  PERFORM pg_temp.check_delivery_context(result->>'ok' = 'false', 'overextended cart lifetime was accepted');
  UPDATE public.commerce_carts
  SET created_at = now(), expires_at = now() + interval '1 day'
  WHERE id = cart;

  UPDATE public.commerce_cart_checkout_sessions
  SET created_at = now() - interval '8 days', expires_at = now() + interval '1 day'
  WHERE id = session_id;
  result := public.commerce_cart_delivery_context(session_id, 7, 3);
  PERFORM pg_temp.check_delivery_context(result->>'ok' = 'false', 'overextended checkout session lifetime was accepted');
  UPDATE public.commerce_cart_checkout_sessions
  SET created_at = now(), expires_at = now() + interval '30 minutes'
  WHERE id = session_id;

  UPDATE public.commerce_cart_grants
  SET created_at = now() - interval '8 days', expires_at = now() + interval '1 day'
  WHERE id = grant_id;
  result := public.commerce_cart_delivery_context(session_id, 7, 3);
  PERFORM pg_temp.check_delivery_context(result->>'ok' = 'false', 'overextended grant lifetime was accepted');
  UPDATE public.commerce_cart_grants
  SET created_at = now(), expires_at = now() + interval '1 day'
  WHERE id = grant_id;

  PERFORM set_config('request.jwt.claims', (claims || jsonb_build_object('cart_grant_id', other_grant))::text, true);
  result := public.commerce_cart_delivery_context(session_id, 7, 3);
  PERFORM pg_temp.check_delivery_context(result->>'ok' = 'false', 'other grant was accepted');

  PERFORM set_config('request.jwt.claims', (claims || jsonb_build_object(
    'cart_merchant_id', '22222222-2222-4222-8222-222222222222'
  ))::text, true);
  result := public.commerce_cart_delivery_context(session_id, 7, 3);
  PERFORM pg_temp.check_delivery_context(result->>'ok' = 'false', 'other merchant was accepted');
  PERFORM set_config('request.jwt.claims', claims::text, true);

  result := public.commerce_cart_delivery_context(session_id, 8, 3);
  PERFORM pg_temp.check_delivery_context(result->>'ok' = 'false', 'stale checkout generation was accepted');
  result := public.commerce_cart_delivery_context(session_id, 7, 4);
  PERFORM pg_temp.check_delivery_context(result->>'ok' = 'false', 'stale cart version was accepted');
  UPDATE public.commerce_carts SET version = 4 WHERE id = cart;
  result := public.commerce_cart_delivery_context(session_id, 7, 3);
  PERFORM pg_temp.check_delivery_context(result->>'ok' = 'false', 'changed current cart version was accepted');
  UPDATE public.commerce_carts SET version = 3 WHERE id = cart;

  UPDATE public.commerce_cart_checkout_sessions SET expires_at = now() - interval '1 second' WHERE id = session_id;
  result := public.commerce_cart_delivery_context(session_id, 7, 3);
  PERFORM pg_temp.check_delivery_context(result->>'ok' = 'false', 'expired checkout session was accepted');
  UPDATE public.commerce_cart_checkout_sessions SET expires_at = now() + interval '30 minutes' WHERE id = session_id;

  UPDATE public.commerce_cart_grants SET revoked_at = now() WHERE id = grant_id;
  result := public.commerce_cart_delivery_context(session_id, 7, 3);
  PERFORM pg_temp.check_delivery_context(result->>'ok' = 'false', 'revoked preparing grant was accepted');
END
$test$;

DO $assert$
DECLARE failures text;
BEGIN
  SELECT string_agg(message, E'\n') INTO failures FROM delivery_context_failures;
  IF failures IS NOT NULL THEN RAISE EXCEPTION E'Delivery context regressions:\n%', failures; END IF;
END
$assert$;

-- Persist a separate live fixture for the two-connection lock-order check in
-- the focused runner. The runner commits this disposable database afterward.
INSERT INTO public.commerce_carts(id, merchant_id, currency, version, state, expires_at)
VALUES ('aaaaaaaa-6600-4000-8000-000000000002',
  '11111111-1111-4111-8111-111111111111', 'NGN', 3, 'active', now() + interval '1 day');
INSERT INTO public.commerce_cart_grants(id, merchant_id, cart_id, principal_id, expires_at)
VALUES ('bbbbbbbb-6600-4000-8000-000000000003',
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-6600-4000-8000-000000000002', 'delivery-context-lock', now() + interval '1 day');
INSERT INTO public.commerce_cart_checkout_sessions(
  id, merchant_id, cart_id, checkout_generation, cart_version_reviewed,
  principal_id, preparing_grant_id, reviewed_snapshot, expires_at
) VALUES (
  'cccccccc-6600-4000-8000-000000000002',
  '11111111-1111-4111-8111-111111111111',
  'aaaaaaaa-6600-4000-8000-000000000002', 9, 3,
  'delivery-context-lock', 'bbbbbbbb-6600-4000-8000-000000000003',
  jsonb_build_object('lines', jsonb_build_array(jsonb_build_object(
    'productId', '44444444-4444-4444-8444-444444444444',
    'variantId', NULL, 'condition', 'new', 'quantity', 1
  )), 'estimates', jsonb_build_object('currency', 'NGN')),
  now() + interval '30 minutes'
);
UPDATE public.commerce_carts
SET checkout_session_id = 'cccccccc-6600-4000-8000-000000000002'
WHERE id = 'aaaaaaaa-6600-4000-8000-000000000002';
