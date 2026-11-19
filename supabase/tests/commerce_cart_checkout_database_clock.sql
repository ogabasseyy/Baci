CREATE TEMP TABLE checkout_clock_failures(message text);
CREATE FUNCTION pg_temp.check_checkout_clock(ok boolean, message text) RETURNS void
LANGUAGE sql AS $$ INSERT INTO checkout_clock_failures SELECT message WHERE NOT coalesce(ok, false) $$;
-- Full chronological replay starts from schema-only migrations, unlike the
-- focused harness, which imports commerce_cart_order_binding.sql fixtures.
-- Seed the minimum merchant/product rows this regression needs in either
-- schema. The focused stub omits merchants.email; the replay schema requires
-- it, so select the compatible insert shape at runtime.
DO $$
DECLARE
  prior_claims text := current_setting('request.jwt.claims', true);
  prior_role text := current_setting('request.jwt.claim.role', true);
BEGIN
  -- The full replay installs merchant audit triggers which require an actor.
  -- This JWT role is fixture-local to this statement and does not grant SQL
  -- privileges or affect the shopper claims used by the prepare call.
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'merchants' AND column_name = 'email'
  ) THEN
    INSERT INTO public.merchants (id, email, slug, premium_features)
    VALUES ('f6a6a006-8f22-4cb4-a626-d71eac10c001', 'checkout-clock-f6a6a006@example.invalid', 'checkout-clock-f6a6a006', '["shared_cart"]'::jsonb);
  ELSE
    INSERT INTO public.merchants (id, slug, premium_features)
    VALUES ('f6a6a006-8f22-4cb4-a626-d71eac10c001', 'checkout-clock-f6a6a006', '["shared_cart"]'::jsonb);
  END IF;
  -- Product insert policy triggers also inspect auth.role() through
  -- enforce_mobile_admin_product_limit, so seed it under the same fixture
  -- actor context rather than after this DO block restores prior GUCs.
  INSERT INTO public.products (id, merchant_id, name, price, status, stock_quantity, stock, manage_stock)
  VALUES ('f6a6a006-8f22-4cb4-a626-d71eac10c002', 'f6a6a006-8f22-4cb4-a626-d71eac10c001', 'Checkout clock fixture', 15, 'active', 10, 10, true);
  PERFORM set_config('request.jwt.claims', coalesce(prior_claims, ''), true);
  PERFORM set_config('request.jwt.claim.role', coalesce(prior_role, ''), true);
END $$;
DO $$
DECLARE
  m uuid := 'f6a6a006-8f22-4cb4-a626-d71eac10c001';
  p uuid := 'f6a6a006-8f22-4cb4-a626-d71eac10c002';
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
  PERFORM set_config('request.jwt.claim.role', 'commerce_cart_shopper', true);
  PERFORM pg_temp.check_checkout_clock(
    auth.role() = 'commerce_cart_shopper',
    'prepare authorization role was not the cart shopper'
  );

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
    RAISE EXCEPTION 'Checkout database clock regressions: %', failures;
  END IF;
END $$;
