-- Replay projection: repeated product+offer lines must carry their
-- fee-determining economics (quantity, has_assurance) so the route
-- matches stored fees by line identity instead of request position.
-- Reordered retries are hash-equivalent under the sorted idempotency
-- hash, so positional pairing would swap fees. Price is deliberately
-- absent: the order RPC persists the live price while the hash covers
-- the submitted price, so price can never join the match key.
ALTER TABLE public.merchants DISABLE TRIGGER USER;
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES ('01d00000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'replay-identity-owner@example.com', 'test',
  now(), now(), now(), '{}', '{}');
INSERT INTO public.merchants (id, user_id, email, business_name, slug, is_published)
VALUES ('01d00000-0000-4000-8000-000000000001', '01d00000-0000-4000-8000-000000000002',
  'replay-identity@example.com', 'Replay Identity', 'replay-identity', true);
ALTER TABLE public.merchants ENABLE TRIGGER USER;

ALTER TABLE public.products DISABLE TRIGGER USER;
INSERT INTO public.products (id, merchant_id, name, price, manage_stock, status)
VALUES ('01d00000-0000-4000-8000-000000000020', '01d00000-0000-4000-8000-000000000001',
  'Phone', 320000, false, 'active');
ALTER TABLE public.products ENABLE TRIGGER USER;

ALTER TABLE public.product_offers DISABLE TRIGGER USER;
INSERT INTO public.product_offers (id, product_id, merchant_id, condition, price)
VALUES ('01d00000-0000-4000-8000-000000000030', '01d00000-0000-4000-8000-000000000020',
  '01d00000-0000-4000-8000-000000000001', 'refurbished', 320000);
ALTER TABLE public.product_offers ENABLE TRIGGER USER;

ALTER TABLE public.orders DISABLE TRIGGER USER;
INSERT INTO public.orders (id, merchant_id, order_number, total, tax_amount, discount_amount, checkout_idempotency_key)
VALUES ('01d00000-0000-4000-8000-000000000010', '01d00000-0000-4000-8000-000000000001',
  'replay-identity-1', 1000000, 30000, 5000, 'checkout-replay-identity');
ALTER TABLE public.orders ENABLE TRIGGER USER;

ALTER TABLE public.order_items DISABLE TRIGGER USER;
INSERT INTO public.order_items (order_id, line_id, product_id, offer_id, name, condition, price, quantity, has_assurance, assurance_fee)
VALUES
  ('01d00000-0000-4000-8000-000000000010', 1, '01d00000-0000-4000-8000-000000000020',
    '01d00000-0000-4000-8000-000000000030', 'Phone', 'refurbished', 320000, 1, true, 4500),
  ('01d00000-0000-4000-8000-000000000010', 2, '01d00000-0000-4000-8000-000000000020',
    '01d00000-0000-4000-8000-000000000030', 'Phone', 'refurbished', 320000, 2, true, 9000);
ALTER TABLE public.order_items ENABLE TRIGGER USER;

DO $$ DECLARE
  projection jsonb;
  first_line jsonb;
  second_line jsonb;
BEGIN
  SELECT items INTO projection
  FROM public.get_storefront_order_replay_economics(
    '01d00000-0000-4000-8000-000000000001', 'checkout-replay-identity');
  IF jsonb_array_length(projection) <> 2 THEN
    RAISE EXCEPTION 'expected 2 projected lines, got %', jsonb_array_length(projection);
  END IF;
  first_line := projection->0;
  second_line := projection->1;
  IF (first_line->>'quantity')::int <> 1
    OR (first_line->>'has_assurance')::boolean IS NOT TRUE
    OR (first_line->>'assurance_fee')::numeric <> 4500
    OR first_line ? 'price' THEN
    RAISE EXCEPTION 'first line economics mismatch: %', first_line;
  END IF;
  IF (second_line->>'quantity')::int <> 2
    OR (second_line->>'has_assurance')::boolean IS NOT TRUE
    OR (second_line->>'assurance_fee')::numeric <> 9000
    OR second_line ? 'price' THEN
    RAISE EXCEPTION 'second line economics mismatch: %', second_line;
  END IF;
END $$;
