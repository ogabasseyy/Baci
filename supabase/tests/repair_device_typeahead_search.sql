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

RESET ROLE;

DO $$
BEGIN
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
