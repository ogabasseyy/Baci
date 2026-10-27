-- Exact-offer cart identity. Same condition, different offer => distinct lines.
-- Omitted offer stays on the null lane and still merges with itself.
-- Requires the commerce cart fixture (merchant 11111111-1111-4111-8111-111111111111,
-- product 44444444-4444-4444-8444-444444444444) and 20261025120000 applied.
CREATE TEMP TABLE cart_offer_failures(message text);
CREATE FUNCTION pg_temp.check_cart_offer(ok boolean, message text) RETURNS void
LANGUAGE sql AS $$ INSERT INTO cart_offer_failures SELECT message WHERE NOT coalesce(ok, false) $$;

DO $$
DECLARE
  merchant uuid := '11111111-1111-4111-8111-111111111111';
  product uuid := '44444444-4444-4444-8444-444444444444';
  offer_a uuid := '55555555-5555-4555-8555-555555555555';
  offer_b uuid := '66666666-6666-4666-8666-666666666666';
  cart uuid := 'aaaaaaaa-2512-4000-8000-000000000001';
  grant_id uuid := 'bbbbbbbb-2512-4000-8000-000000000001';
  result jsonb;
  snapshot jsonb;
  parsed uuid;
BEGIN
  INSERT INTO public.product_offers (id, product_id, merchant_id, condition, price, stock_quantity, status)
  VALUES
    (offer_a, product, merchant, 'Used', 20, 4, 'active'),
    (offer_b, product, merchant, 'used', 30, 4, 'active');
  INSERT INTO public.commerce_carts (id, merchant_id, expires_at)
  VALUES (cart, merchant, now() + interval '1 day');
  INSERT INTO public.commerce_cart_grants (id, merchant_id, cart_id, principal_id, expires_at)
  VALUES (grant_id, merchant, cart, 'offer-lanes', now() + interval '1 day');
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'commerce_cart_shopper',
      'exp', 9999999999,
      'cart_scope', 'session',
      'cart_merchant_id', merchant,
      'cart_principal_id', 'offer-lanes',
      'cart_id', cart,
      'cart_grant_id', grant_id
    )::text,
    true
  );

  parsed := public.commerce_cart_parse_offer_id(
    jsonb_build_object('item', jsonb_build_object('productId', product, 'offerId', offer_a), 'quantity', 1)
  );
  PERFORM pg_temp.check_cart_offer(parsed = offer_a, 'parser dropped a valid offer id');
  parsed := public.commerce_cart_parse_offer_id(
    jsonb_build_object('item', jsonb_build_object('productId', product), 'quantity', 1)
  );
  PERFORM pg_temp.check_cart_offer(parsed IS NULL, 'parser invented an offer id');

  result := public.commerce_cart_mutate(
    cart, 'add-offer-a', 1,
    jsonb_build_object(
      'type', 'add',
      'item', jsonb_build_object('productId', product, 'condition', 'used', 'offerId', offer_a),
      'quantity', 1
    )
  );
  PERFORM pg_temp.check_cart_offer(
    result->>'ok' = 'true'
      AND (SELECT count(*) = 1 AND bool_and(offer_id = offer_a) FROM public.commerce_cart_lines WHERE cart_id = cart),
    'exact offer add did not store offer_id'
  );

  result := public.commerce_cart_mutate(
    cart, 'add-offer-b', 2,
    jsonb_build_object(
      'type', 'add',
      'item', jsonb_build_object('productId', product, 'condition', 'used', 'offerId', offer_b),
      'quantity', 1
    )
  );
  PERFORM pg_temp.check_cart_offer(
    result->>'ok' = 'true'
      AND (SELECT count(*) = 2 FROM public.commerce_cart_lines WHERE cart_id = cart),
    'same condition with a different offer collapsed into one line'
  );

  result := public.commerce_cart_mutate(
    cart, 'add-offer-a-again', 3,
    jsonb_build_object(
      'type', 'add',
      'item', jsonb_build_object('productId', product, 'condition', 'used', 'offerId', offer_a),
      'quantity', 2
    )
  );
  PERFORM pg_temp.check_cart_offer(
    result->>'ok' = 'true'
      AND (
        SELECT quantity = 3 AND last_unit_price_minor = 2000
        FROM public.commerce_cart_lines
        WHERE cart_id = cart AND offer_id = offer_a
      ),
    'same exact offer did not merge at that offer price'
  );
  -- 2940 is inside 2% of the other spelling (3000) and above this offer (2000).
  -- A non-negotiable fixture product stays pending either way.
  PERFORM pg_temp.check_cart_offer(
    public.commerce_cart_negotiation_status(merchant, product, NULL, 'used', 2940, NULL, offer_a)
      = 'pending',
    'exact-offer negotiation band followed the other spelling'
  );

  result := public.commerce_cart_mutate(
    cart, 'add-condition-only', 4,
    jsonb_build_object(
      'type', 'add',
      'item', jsonb_build_object('productId', product, 'condition', 'used'),
      'quantity', 1
    )
  );
  PERFORM pg_temp.check_cart_offer(
    result->>'ok' = 'true'
      AND (SELECT count(*) = 1 AND bool_and(offer_id IS NULL) FROM public.commerce_cart_lines WHERE cart_id = cart AND offer_id IS NULL),
    'omitted offer did not stay on the null lane'
  );

  SELECT public.commerce_cart_assemble_state(merchant, cart) INTO snapshot;
  PERFORM pg_temp.check_cart_offer(
    (SELECT count(*) = 2 FROM jsonb_array_elements(snapshot->'lines') line WHERE line->>'offerId' IN (offer_a::text, offer_b::text)),
    'snapshot dropped stored offer ids'
  );

  result := public.commerce_cart_prepare_checkout(cart, 5, 'offer-checkout');
  PERFORM pg_temp.check_cart_offer(
    result->>'ok' = 'true'
      AND (SELECT count(*) = 2 FROM jsonb_array_elements(result->'snapshot'->'lines') line WHERE line->>'offerId' IN (offer_a::text, offer_b::text)),
    'checkout snapshot dropped stored offer ids'
  );

  result := public.commerce_cart_mutate(
    cart, 'add-foreign-offer', 5,
    jsonb_build_object(
      'type', 'add',
      'item', jsonb_build_object(
        'productId', product,
        'condition', 'used',
        'offerId', '77777777-7777-4777-8777-777777777777'
      ),
      'quantity', 1
    )
  );
  PERFORM pg_temp.check_cart_offer(
    result->>'ok' = 'false' AND result->>'code' = 'invalid_item',
    'unknown offer id was stored'
  );
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cart_offer_failures) THEN
    RAISE EXCEPTION 'cart offer identity failed: %', (SELECT string_agg(message, '; ') FROM cart_offer_failures);
  END IF;
END $$;
