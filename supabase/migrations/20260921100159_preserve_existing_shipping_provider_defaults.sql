-- Preserve the effective legacy carrier default before the opt-in migration
-- normalizes NULL settings to an empty allowlist. An explicit [] stays off.
UPDATE public.merchant_feature_settings
SET shipping_providers = '["gigl", "topship"]'::jsonb
WHERE shipping_providers IS NULL;

INSERT INTO public.merchant_feature_settings (merchant_id, shipping_providers)
SELECT m.id, '["gigl", "topship"]'::jsonb
FROM public.merchants AS m
WHERE NOT EXISTS (
  SELECT 1
  FROM public.merchant_feature_settings AS mfs
  WHERE mfs.merchant_id = m.id
)
ON CONFLICT (merchant_id) DO NOTHING;
