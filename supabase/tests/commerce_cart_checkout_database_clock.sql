CREATE TEMP TABLE checkout_clock_failures(message text);
CREATE FUNCTION pg_temp.check_checkout_clock(ok boolean, message text) RETURNS void
LANGUAGE sql AS $$ INSERT INTO checkout_clock_failures SELECT message WHERE NOT coalesce(ok, false) $$;
UPDATE public.merchants SET premium_features = '["shared_cart"]' WHERE id = '11111111-1111-4111-8111-111111111111';
DO $$
DECLARE
  m uuid := '11111111-1111-4111-8111-111111111111';
  p uuid := '44444444-4444-4444-8444-444444444444';
  c uuid := 'aaaaaaaa-4404-4000-8000-000000000001';
  g uuid := 'bbbbbbbb-4404-4000-8000-000000000001';
  r jsonb; replay jsonb; stored jsonb;
BEGIN
  INSERT INTO public.commerce_carts(id, merchant_id, expires_at) VALUES (c, m, now() + interval '1 day');
  INSERT INTO public.commerce_cart_grants(id, merchant_id, cart_id, principal_id, expires_at)
    VALUES (g, m, c, 'database-clock', now() + interval '1 day');
  INSERT INTO public.commerce_cart_lines(merchant_id, cart_id, product_id, quantity, last_unit_price_minor)
    VALUES (m, c, p, 1, 1500);
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'role', 'commerce_cart_shopper', 'exp', 9999999999, 'cart_scope', 'session',
    'cart_merchant_id', m, 'cart_principal_id', 'database-clock', 'cart_id', c, 'cart_grant_id', g
  )::text, true);

  r := public.commerce_cart_prepare_checkout(c, 1, 'prepare-db-clock');
  PERFORM pg_temp.check_checkout_clock(
    r->>'ok' = 'true' AND (r->>'databaseNow')::timestamptz BETWEEN now() - interval '1 second' AND now(),
    'fresh prepare did not return a PostgreSQL databaseNow'
  );
  SELECT result INTO stored FROM public.commerce_cart_operations
    WHERE merchant_id=m AND cart_id=c AND principal_id='database-clock' AND operation_id='prepare-db-clock';
  PERFORM pg_temp.check_checkout_clock(NOT (stored ? 'databaseNow'), 'databaseNow was persisted in the idempotency receipt');

  UPDATE public.commerce_cart_operations SET result=jsonb_set(result, '{databaseNow}', to_jsonb('2000-01-01T00:00:00Z'::text), true)
    WHERE merchant_id=m AND cart_id=c AND principal_id='database-clock' AND operation_id='prepare-db-clock';
  replay := public.commerce_cart_prepare_checkout(c, 1, 'prepare-db-clock');
  PERFORM pg_temp.check_checkout_clock(
    replay->>'replayed' = 'true' AND (replay->>'databaseNow')::timestamptz BETWEEN now() - interval '1 second' AND now(),
    'replay did not replace a stale persisted databaseNow with PostgreSQL time'
  );
END $$;
DO $$ DECLARE failures text; BEGIN
  SELECT string_agg(message, E'\n') INTO failures FROM checkout_clock_failures;
  IF failures IS NOT NULL THEN RAISE EXCEPTION E'Checkout database clock regressions:\n%', failures; END IF;
END $$;
