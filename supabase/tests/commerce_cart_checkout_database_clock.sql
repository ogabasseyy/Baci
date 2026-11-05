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
    r->>'ok' = 'true',
    'fresh prepare was rejected: ' || coalesce(r->>'code', 'no_code')
  );
  PERFORM pg_temp.check_checkout_clock(
    r ? 'databaseNow',
    'fresh prepare did not return databaseNow'
  );
  PERFORM pg_temp.check_checkout_clock(
    (r->>'databaseNow')::timestamptz BETWEEN now() - interval '1 second' AND now(),
    'fresh prepare databaseNow was outside the database clock window'
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
  IF failures IS NOT NULL THEN
    RAISE NOTICE 'Checkout database clock regressions: %', failures;
    IF failures LIKE '%fresh prepare was rejected: unauthorized%' THEN
      RAISE EXCEPTION 'Checkout clock fresh prepare authorization rejected' USING ERRCODE = 'P0007';
    ELSIF failures LIKE '%fresh prepare was rejected: merchant_unavailable%' THEN
      RAISE EXCEPTION 'Checkout clock fresh prepare merchant gate rejected' USING ERRCODE = 'P0008';
    ELSIF failures LIKE '%fresh prepare was rejected: invalid_item%' THEN
      RAISE EXCEPTION 'Checkout clock fresh prepare input rejected' USING ERRCODE = 'P0009';
    ELSIF failures LIKE '%fresh prepare was rejected: expired%' THEN
      RAISE EXCEPTION 'Checkout clock fresh prepare expiry rejected' USING ERRCODE = 'P0010';
    ELSIF failures LIKE '%fresh prepare was rejected: idempotency_conflict%' THEN
      RAISE EXCEPTION 'Checkout clock fresh prepare idempotency conflict' USING ERRCODE = 'P0011';
    ELSIF failures LIKE '%fresh prepare was rejected: not_found%' THEN
      RAISE EXCEPTION 'Checkout clock fresh prepare cart not found' USING ERRCODE = 'P0012';
    ELSIF failures LIKE '%fresh prepare was rejected: refresh_required%' THEN
      RAISE EXCEPTION 'Checkout clock fresh prepare version stale' USING ERRCODE = 'P0013';
    ELSIF failures LIKE '%fresh prepare was rejected:%' THEN
      RAISE EXCEPTION 'Checkout clock fresh prepare was rejected' USING ERRCODE = 'P0005';
    ELSIF failures LIKE '%fresh prepare did not return databaseNow%' THEN
      RAISE EXCEPTION 'Checkout clock fresh prepare assertion failed' USING ERRCODE = 'P0002';
    ELSIF failures LIKE '%fresh prepare databaseNow was outside the database clock window%' THEN
      RAISE EXCEPTION 'Checkout clock fresh value assertion failed' USING ERRCODE = 'P0006';
    ELSIF failures LIKE '%databaseNow was persisted in the idempotency receipt%' THEN
      RAISE EXCEPTION 'Checkout clock receipt persistence assertion failed' USING ERRCODE = 'P0003';
    ELSIF failures LIKE '%replay did not replace a stale persisted databaseNow with PostgreSQL time%' THEN
      RAISE EXCEPTION 'Checkout clock replay assertion failed' USING ERRCODE = 'P0004';
    END IF;
    RAISE EXCEPTION 'Unclassified checkout database clock regression: %', failures;
  END IF;
END $$;
