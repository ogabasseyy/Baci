-- Reviewed names come from the current merchant catalog row and are bounded.
DO $$
DECLARE
  m uuid := '11111111-1111-4111-8111-111111111111';
  p uuid := '44444444-4444-4444-8444-444444444444';
  foreign_product uuid := '66666666-6666-4666-8666-666666666666';
  c uuid := 'aaaaaaaa-4500-4000-8000-000000000002';
  snapshot jsonb;
  line jsonb;
BEGIN
  INSERT INTO public.commerce_carts(id, merchant_id, expires_at)
  VALUES (c, m, now() + interval '1 day');
  INSERT INTO public.commerce_cart_lines(
    merchant_id, cart_id, product_id, quantity, last_unit_price_minor
  ) VALUES (m, c, p, 1, 1500);
  UPDATE public.products SET name = 'Cross-merchant synthetic private name'
  WHERE id = foreign_product;
  INSERT INTO public.commerce_cart_lines(
    merchant_id, cart_id, product_id, quantity, last_unit_price_minor
  ) VALUES (m, c, foreign_product, 1, 900);

  UPDATE public.products SET name = 'Reviewed synthetic product' WHERE id = p;
  snapshot := public.commerce_cart_build_checkout_snapshot(m, c);
  SELECT value INTO line FROM jsonb_array_elements(snapshot->'lines')
  WHERE value->>'productId' = p::text;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'checkout snapshot omitted the owned product line';
  END IF;
  IF line->>'productName' IS DISTINCT FROM 'Reviewed synthetic product' THEN
    RAISE EXCEPTION 'checkout snapshot did not include current catalog name';
  END IF;
  SELECT value INTO line FROM jsonb_array_elements(snapshot->'lines')
  WHERE value->>'productId' = foreign_product::text;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'checkout snapshot omitted the cross-merchant test line';
  END IF;
  IF line->'productName' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'checkout snapshot leaked a cross-merchant product name';
  END IF;

  UPDATE public.products SET name = repeat('n', 240) WHERE id = p;
  snapshot := public.commerce_cart_build_checkout_snapshot(m, c);
  SELECT value INTO line FROM jsonb_array_elements(snapshot->'lines')
  WHERE value->>'productId' = p::text;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'checkout snapshot omitted the owned product line during truncation check';
  END IF;
  IF length(line->>'productName') IS DISTINCT FROM 200 THEN
    RAISE EXCEPTION 'checkout snapshot name was not bounded to 200 characters';
  END IF;

  UPDATE public.products SET name = '   ' WHERE id = p;
  snapshot := public.commerce_cart_build_checkout_snapshot(m, c);
  SELECT value INTO line FROM jsonb_array_elements(snapshot->'lines')
  WHERE value->>'productId' = p::text;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'checkout snapshot omitted the owned product line during blank-name check';
  END IF;
  IF line->'productName' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'empty catalog name was not represented as null';
  END IF;
END $$;
