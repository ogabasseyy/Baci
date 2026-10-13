-- Keep the Jumia marketplace country constraint aligned with the countries
-- exposed by the Vendor API. Scope the replacement immediately so existing
-- non-Jumia integrations are never transiently checked against Jumia's list.
ALTER TABLE public.marketplace_integrations
  DROP CONSTRAINT IF EXISTS marketplace_integrations_country_code_check;

ALTER TABLE public.marketplace_integrations
  ADD CONSTRAINT marketplace_integrations_country_code_check
  CHECK (
    platform IS DISTINCT FROM 'jumia'::text
    OR country_code = ANY (
      ARRAY[
        'DZ'::text,
        'EG'::text,
        'GH'::text,
        'CI'::text,
        'KE'::text,
        'MA'::text,
        'NG'::text,
        'SN'::text,
        'TN'::text,
        'UG'::text,
        'ZA'::text
      ]
    )
  );
