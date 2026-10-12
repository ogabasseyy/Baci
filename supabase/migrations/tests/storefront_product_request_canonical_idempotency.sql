-- Canonical idempotency: a retry resubmitting the same request id with
-- casing/punctuation-only spelling variants must succeed, not raise
-- 23505 Request conflict. A genuinely different query keeps conflicting.
ALTER TABLE public.merchants DISABLE TRIGGER USER;
INSERT INTO public.merchants (id, user_id, email, business_name, slug, is_published)
VALUES ('01c00000-0000-4000-8000-000000000001', '01c00000-0000-4000-8000-000000000002',
  'intake-canonical@example.com', 'Intake Canonical', 'intake-canonical', true);
ALTER TABLE public.merchants ENABLE TRIGGER USER;

SELECT public.submit_storefront_product_request(
  'intake-canonical', 'Need an iPhone', 'Buyer@Example.COM', '01c00000-0000-4000-8000-000000000010');

-- Same request id, different casing: canonical keys match, returns success.
SELECT public.submit_storefront_product_request(
  'intake-canonical', 'NEED AN IPHONE', 'buyer@example.com', '01c00000-0000-4000-8000-000000000010');

-- Phone punctuation variant: same request id, re-punctuated contact.
SELECT public.submit_storefront_product_request(
  'intake-canonical', 'Need a charger', '+234 801 234 5678', '01c00000-0000-4000-8000-000000000011');
SELECT public.submit_storefront_product_request(
  'intake-canonical', 'need a charger', '2348012345678', '01c00000-0000-4000-8000-000000000011');

-- A genuinely different query under the same id still conflicts.
DO $$ BEGIN
  BEGIN
    PERFORM public.submit_storefront_product_request(
      'intake-canonical', 'Need a laptop', 'buyer@example.com', '01c00000-0000-4000-8000-000000000010');
  EXCEPTION WHEN SQLSTATE '23505' THEN
    RETURN;
  END;
  RAISE EXCEPTION 'different query under same request id must raise 23505';
END $$;

-- Exactly two rows persisted (retries returned, conflicts raised).
DO $$ BEGIN
  IF (SELECT count(*) FROM public.storefront_product_requests
      WHERE merchant_id = '01c00000-0000-4000-8000-000000000001') <> 2 THEN
    RAISE EXCEPTION 'expected exactly 2 intake rows';
  END IF;
END $$;
