BEGIN;
-- Extend the existing safe projection with a derived presentation capability.
-- Raw plan fields and provider credentials remain behind the same boundary.
DO $migration$
DECLARE
  definition text;
  anchor text := $anchor$'price_negotiation_enabled',
            resolved.price_negotiation_enabled,$anchor$;
BEGIN
  definition := pg_catalog.pg_get_functiondef(
    'public.resolve_storefront_public_snapshot_v2(text)'::regprocedure
  );
  IF position(anchor IN definition) = 0 THEN
    RAISE EXCEPTION 'storefront public capability projection contract changed';
  END IF;
  EXECUTE replace(definition, anchor, anchor || $hint$
          'growth_integrations_enabled', COALESCE(
            (
              pg_catalog.jsonb_typeof(resolved.merchant_data->'premium_features') = 'array'
              AND EXISTS (
                SELECT 1 FROM pg_catalog.jsonb_array_elements_text(
                  CASE WHEN pg_catalog.jsonb_typeof(resolved.merchant_data->'premium_features') = 'array'
                    THEN resolved.merchant_data->'premium_features' ELSE '[]'::jsonb END
                ) AS feature(value)
                WHERE pg_catalog.lower(pg_catalog.btrim(feature.value))
                  IN ('all_features', 'growth_integrations')
              )
            ) OR (
              resolved.merchant_data->>'plan_tier' IN ('pro', 'business', 'enterprise')
              AND resolved.merchant_data ? 'plan_expires_at'
              AND (
                resolved.merchant_data->>'plan_expires_at' IS NULL
                OR (resolved.merchant_data->>'plan_expires_at')::timestamptz > now()
              )
            ), false
          ),$hint$);
END;
$migration$;
COMMIT;
