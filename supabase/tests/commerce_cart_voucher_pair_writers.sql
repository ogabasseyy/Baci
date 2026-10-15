-- Final-chain assertions for commerce_cart_partial_voucher_binding:
-- incomplete voucher pairs (token only or award only) are ordinary
-- priced lines. They keep their full quantity and can be re-quantified;
-- only complete pairs pin at quantity one. Runs after
-- commerce_cart_checkout_add_identity on the same disposable catalog.
CREATE FUNCTION pg_temp.partial_claim(c uuid, g uuid, principal text)
RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', jsonb_build_object(
    'role', 'commerce_cart_shopper', 'exp', 9999999999,
    'cart_scope', 'session',
    'cart_merchant_id', '11111111-1111-4111-8111-111111111111',
    'cart_principal_id', principal, 'cart_id', c, 'cart_grant_id', g
  )::text, true)
$$;

DO $$
DECLARE
  m uuid := '11111111-1111-4111-8111-111111111111';
  p uuid := '44444444-4444-4444-8444-444444444444';
  c uuid := 'aaaaaaaa-4500-4000-8000-000000000001';
  g uuid := 'bbbbbbbb-4500-4000-8000-000000000001';
  r jsonb;
  line_id uuid;
  line_qty integer;
BEGIN
  INSERT INTO public.commerce_carts(id, merchant_id, expires_at)
  VALUES (c, m, now() + interval '1 day');
  INSERT INTO public.commerce_cart_grants(id, merchant_id, cart_id, principal_id, expires_at)
  VALUES (g, m, c, 'partial-token', now() + interval '1 day');
  PERFORM pg_temp.partial_claim(c, g, 'partial-token');
  r := public.commerce_cart_mutate(c, 'pv-add-token', 1, jsonb_build_object(
    'type', 'add',
    'item', jsonb_build_object('productId', p),
    'quantity', 2,
    'voucherToken', 'quiz_voucher:11111111-1111-4111-8111-111111111111:77777777-7777-4777-8777-777777777777:lesson.partial.tokenonly.sig'
  ));
  IF r ->> 'ok' <> 'true' THEN
    RAISE EXCEPTION 'token-only add must succeed: %', r;
  END IF;
  SELECT id, quantity::integer INTO line_id, line_qty
  FROM public.commerce_cart_lines
  WHERE cart_id = c AND product_id = p;
  IF (SELECT quantity::integer FROM public.commerce_cart_lines WHERE id = line_id) <> 2 THEN
    RAISE EXCEPTION 'token-only line must keep quantity two: %', r;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.commerce_cart_lines
    WHERE id = line_id AND voucher_token IS NOT NULL AND voucher_award_id IS NULL
  ) THEN
    RAISE EXCEPTION 'token-only attachment must persist as a partial pair';
  END IF;
  r := public.commerce_cart_mutate(c, 'pv-set-token', 2, jsonb_build_object(
    'type', 'set_quantity', 'lineId', line_id, 'quantity', 3
  ));
  IF r ->> 'ok' <> 'true' THEN
    RAISE EXCEPTION 'token-only line must accept re-quantification: %', r;
  END IF;
  IF (SELECT quantity::integer FROM public.commerce_cart_lines WHERE id = line_id) <> 3 THEN
    RAISE EXCEPTION 'token-only line quantity must update to three';
  END IF;
END $$;

DO $$
DECLARE
  m uuid := '11111111-1111-4111-8111-111111111111';
  p uuid := '44444444-4444-4444-8444-444444444444';
  c uuid := 'aaaaaaaa-4500-4000-8000-000000000002';
  g uuid := 'bbbbbbbb-4500-4000-8000-000000000002';
  r jsonb;
BEGIN
  INSERT INTO public.commerce_carts(id, merchant_id, expires_at)
  VALUES (c, m, now() + interval '1 day');
  INSERT INTO public.commerce_cart_grants(id, merchant_id, cart_id, principal_id, expires_at)
  VALUES (g, m, c, 'partial-award', now() + interval '1 day');
  PERFORM pg_temp.partial_claim(c, g, 'partial-award');
  r := public.commerce_cart_mutate(c, 'pv-add-award', 1, jsonb_build_object(
    'type', 'add',
    'item', jsonb_build_object('productId', p),
    'quantity', 2,
    'voucherAwardId', '88888888-8888-4888-8888-888888888888'
  ));
  IF r ->> 'ok' <> 'true' THEN
    RAISE EXCEPTION 'award-only add must succeed: %', r;
  END IF;
  IF (
    SELECT quantity::integer FROM public.commerce_cart_lines
    WHERE cart_id = c AND product_id = p
  ) <> 2 THEN
    RAISE EXCEPTION 'award-only line must keep quantity two';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.commerce_cart_lines
    WHERE cart_id = c AND product_id = p
      AND voucher_token IS NULL AND voucher_award_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'award-only attachment must persist as a partial pair';
  END IF;
END $$;
