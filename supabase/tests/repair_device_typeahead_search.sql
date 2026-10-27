-- Regression: a full brand + model query must find its linked repair device.
BEGIN;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO public.merchants (
  id, email, business_name, slug, business_type, is_published
)
VALUES (
  '00000000-0000-0000-0000-000000003007',
  'repair-typeahead@example.com',
  'Repair Typeahead',
  'repair-typeahead-regression',
  'electronics',
  true
)
ON CONFLICT (id) DO UPDATE
SET business_type = EXCLUDED.business_type,
    is_published = EXCLUDED.is_published;

INSERT INTO public.repair_devices (
  id, merchant_id, brand, model, slug, device_type, product_id, aliases, is_active
)
VALUES (
  '00000000-0000-0000-0000-000000003017',
  '00000000-0000-0000-0000-000000003007',
  'Apple',
  'iPhone 13',
  'apple-iphone-13-typeahead-regression',
  'Smartphone',
  NULL,
  ARRAY['iPhone 13'],
  true
)
ON CONFLICT (id) DO UPDATE
SET brand = EXCLUDED.brand,
    model = EXCLUDED.model,
    is_active = true;

INSERT INTO public.repair_devices (
  id, merchant_id, brand, model, slug, device_type, product_id, aliases, is_active
)
SELECT
  ('00000000-0000-0000-0000-' || pg_catalog.lpad((3017 + n)::text, 12, '0'))::uuid,
  '00000000-0000-0000-0000-000000003007', 'Apple', 'iPhone ' || n,
  'apple-iphone-' || n || '-typeahead-regression', 'Smartphone', NULL,
  ARRAY['iPhone ' || n], true
FROM pg_catalog.generate_series(1, 9) AS series(n)
ON CONFLICT (id) DO UPDATE
SET brand = EXCLUDED.brand,
    model = EXCLUDED.model,
    is_active = true;

RESET ROLE;

DO $$
DECLARE
  v_catalog_count integer;
  v_suggestion_count integer;
BEGIN
  SELECT pg_catalog.count(*) INTO v_catalog_count
  FROM public.search_repair_devices('00000000-0000-0000-0000-000000003007', 'Apple');
  SELECT pg_catalog.count(*) INTO v_suggestion_count
  FROM public.search_repair_device_suggestions('00000000-0000-0000-0000-000000003007', 'Apple');

  IF v_catalog_count <> 10 THEN
    RAISE EXCEPTION 'full catalog query expected 10 Apple devices, got %', v_catalog_count;
  END IF;
  IF v_suggestion_count <> 8 THEN
    RAISE EXCEPTION 'suggestion query expected 8 Apple devices, got %', v_suggestion_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.search_repair_devices(
      '00000000-0000-0000-0000-000000003007',
      'Apple iPhone 13'
    ) AS result
    WHERE result.id = '00000000-0000-0000-0000-000000003017'
      AND result.device_type = 'Smartphone'
  ) THEN
    RAISE EXCEPTION 'full brand + model typeahead query must return the repair device';
  END IF;
END $$;

ROLLBACK;
