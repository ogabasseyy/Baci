-- Replay projection: repeated product+offer lines must carry their
-- fee-determining economics (quantity, price, has_assurance) so the
-- route matches stored fees by line identity instead of request
-- position. Reordered retries are hash-equivalent under the sorted
-- idempotency hash, so positional pairing would swap fees.
ALTER TABLE public.merchants DISABLE TRIGGER USER;
INSERT INTO public.merchants (id, user_id, email, business_name, slug, is_published)
VALUES ('01d00000-0000-4000-8000-000000000001', '01d00000-0000-4000-8000-000000000002',
  'replay-identity@example.com', 'Replay Identity', 'replay-identity', true);
ALTER TABLE public.merchants ENABLE TRIGGER USER;

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
  IF (first_line->>'quantity')::int <> 1 OR (first_line->>'price')::numeric <> 320000
    OR (first_line->>'has_assurance')::boolean IS NOT TRUE
    OR (first_line->>'assurance_fee')::numeric <> 4500 THEN
    RAISE EXCEPTION 'first line economics mismatch: %', first_line;
  END IF;
  IF (second_line->>'quantity')::int <> 2 OR (second_line->>'price')::numeric <> 320000
    OR (second_line->>'has_assurance')::boolean IS NOT TRUE
    OR (second_line->>'assurance_fee')::numeric <> 9000 THEN
    RAISE EXCEPTION 'second line economics mismatch: %', second_line;
  END IF;
END $$;
