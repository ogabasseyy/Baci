-- Reassert the Jumia country list on Jumia rows while keeping the previous
-- supported-country validation for other providers, so replacing the
-- constraint never widens what non-Jumia integrations may store. This is
-- idempotent for histories where the preceding migration already applied the
-- scoped form.
ALTER TABLE public.marketplace_integrations
  DROP CONSTRAINT IF EXISTS marketplace_integrations_country_code_check;

ALTER TABLE public.marketplace_integrations
  ADD CONSTRAINT marketplace_integrations_country_code_check
  CHECK (
    (
      platform = 'jumia'::text
      AND country_code = ANY (
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
    )
    OR (
      platform IS DISTINCT FROM 'jumia'::text
      AND country_code = ANY (
        ARRAY[
          'NG'::text,
          'KE'::text,
          'EG'::text,
          'MA'::text,
          'GH'::text,
          'CI'::text,
          'SN'::text,
          'UG'::text,
          'TZ'::text,
          'ZA'::text
        ]
      )
    )
  );
