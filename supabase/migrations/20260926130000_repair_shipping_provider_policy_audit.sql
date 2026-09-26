-- Repair only where the original policy migration is still missing.
-- A database that already applied it may have newer trigger definitions.
DO $repair$
BEGIN
  IF EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20260921100200'
      AND name = 'enforce_merchant_shipping_provider_policy'
  ) THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20260921100200'
  ) THEN
    RAISE EXCEPTION 'shipping_policy_migration_history_conflict';
  END IF;
  EXECUTE $shipping_policy$
-- Append-only replacement for the failed shipping-policy migration.
-- Use the existing service audit identity for this trusted database backfill.
-- Restore the previous claim context after the update; an error rolls back the block.
-- No audit trigger, writer check, or application privilege is changed.
-- Carrier integrations are opt-in for new stores; existing real GIGL/Topship
-- selections are preserved. The storefront projection sanitizes the stored
-- allowlist, and a stale carrier-backed selection cannot create an order
-- after the merchant switches the carrier off.

ALTER TABLE public.merchant_feature_settings
  ALTER COLUMN shipping_providers SET DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION private.supported_carrier_provider_ids()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY['gigl', 'topship']::text[];
$$;

COMMENT ON FUNCTION private.supported_carrier_provider_ids() IS
  'Canonical merchant-configurable carrier provider ids.';

REVOKE ALL ON FUNCTION private.supported_carrier_provider_ids()
  FROM PUBLIC, anon, authenticated, service_role;

-- Keep active integrations for existing merchants, but remove the retired
-- Shiip placeholder and any malformed/duplicate values. This deliberately
-- does not turn carriers off for existing stores.
DO $shipping_backfill$
DECLARE
  v_claims text := pg_catalog.current_setting('request.jwt.claims', true);
  v_role text := pg_catalog.current_setting('request.jwt.claim.role', true);
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
WITH normalized_provider_settings AS (
  SELECT
    mfs.id,
    COALESCE((
      SELECT jsonb_agg(normalized.provider ORDER BY normalized.first_position)
      FROM (
        SELECT
          lower(btrim(entry.value)) AS provider,
          min(entry.ordinality) AS first_position
        FROM jsonb_array_elements_text(
          CASE
            WHEN jsonb_typeof(mfs.shipping_providers) = 'array'
              THEN mfs.shipping_providers
            ELSE '[]'::jsonb
          END
        ) WITH ORDINALITY AS entry(value, ordinality)
        WHERE lower(btrim(entry.value)) = ANY (
          private.supported_carrier_provider_ids()
        )
        GROUP BY lower(btrim(entry.value))
      ) AS normalized
    ), '[]'::jsonb) AS shipping_providers
  FROM public.merchant_feature_settings AS mfs
)
UPDATE public.merchant_feature_settings AS mfs
SET shipping_providers = normalized.shipping_providers
FROM normalized_provider_settings AS normalized
WHERE normalized.id = mfs.id
  AND mfs.shipping_providers IS DISTINCT FROM normalized.shipping_providers;
  PERFORM pg_catalog.set_config('request.jwt.claims', COALESCE(v_claims, ''), true);
  PERFORM pg_catalog.set_config('request.jwt.claim.role', COALESCE(v_role, ''), true);
END;
$shipping_backfill$;

-- Checkout already uses this SECURITY DEFINER function for merchant shipping
-- rates. Include the sanitized carrier preference here so anonymous storefront
-- requests never need direct access to merchant_feature_settings.
CREATE OR REPLACE FUNCTION public.get_storefront_shipping_rates(
  p_merchant_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'zones', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', z.id,
          'name', z.name,
          'is_rest_of_world', z.is_rest_of_world
        )
        ORDER BY z.is_rest_of_world, z.name
      )
      FROM public.merchant_shipping_zones AS z
      WHERE z.merchant_id = p_merchant_id
        AND z.active
    ), '[]'::jsonb),
    'locations', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'zone_id', l.zone_id,
          'country_code', l.country_code,
          'subdivision_code', l.subdivision_code
        )
        ORDER BY l.country_code, l.subdivision_code
      )
      FROM public.merchant_shipping_zone_locations AS l
      JOIN public.merchant_shipping_zones AS z ON z.id = l.zone_id
      WHERE z.merchant_id = p_merchant_id
        AND z.active
    ), '[]'::jsonb),
    'rates', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'zone_id', r.zone_id,
          'name', r.name,
          'kind', r.kind,
          'currency', r.currency,
          'base_amount', r.base_amount,
          'condition_type', r.condition_type,
          'min_subtotal', r.min_subtotal,
          'max_subtotal', r.max_subtotal,
          'free_over_amount', r.free_over_amount,
          'delivery_min_days', r.delivery_min_days,
          'delivery_max_days', r.delivery_max_days,
          'pickup_address', r.pickup_address,
          'sort_order', r.sort_order
        )
        ORDER BY r.sort_order, r.base_amount, r.id
      )
      FROM public.merchant_shipping_rates AS r
      JOIN public.merchant_shipping_zones AS z ON z.id = r.zone_id
      WHERE r.merchant_id = p_merchant_id
        AND r.active
        AND z.active
    ), '[]'::jsonb),
    'merchant_payout_currency', (
      SELECT m.payout_currency
      FROM public.merchants AS m
      WHERE m.id = p_merchant_id
    ),
    'merchant_country', (
      SELECT m.country
      FROM public.merchants AS m
      WHERE m.id = p_merchant_id
    ),
    'shipping_providers', COALESCE((
      SELECT jsonb_agg(provider.provider ORDER BY provider.first_position)
      FROM (
        SELECT
          lower(btrim(entry.value)) AS provider,
          min(entry.ordinality) AS first_position
        FROM public.merchant_feature_settings AS mfs
        CROSS JOIN LATERAL jsonb_array_elements_text(
          CASE
            WHEN jsonb_typeof(mfs.shipping_providers) = 'array'
              THEN mfs.shipping_providers
            ELSE '[]'::jsonb
          END
        ) WITH ORDINALITY AS entry(value, ordinality)
        WHERE mfs.merchant_id = p_merchant_id
          AND lower(btrim(entry.value)) = ANY (
            private.supported_carrier_provider_ids()
          )
        GROUP BY lower(btrim(entry.value))
      ) AS provider
    ), '[]'::jsonb)
  );
$$;

COMMENT ON FUNCTION public.get_storefront_shipping_rates(uuid) IS
  'Returns checkout-safe active delivery configuration, merchant currency/country, and the sanitized enabled carrier allowlist used by both storefront and Admin shipping.';

REVOKE ALL ON FUNCTION public.get_storefront_shipping_rates(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_storefront_shipping_rates(uuid)
  TO anon, authenticated, service_role;

-- A carrier quote can outlive a merchant switching the carrier off. Enforce
-- the current setting at order creation/update so a stale quote cannot create
-- a new carrier-backed order after that change. Merchant-configured rates
-- and merchant self-fulfillment use provider labels as durable order
-- metadata, not carrier selections, so they stay allowed without a carrier
-- opt-in.
CREATE OR REPLACE FUNCTION private.enforce_merchant_shipping_provider_enabled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_provider text := lower(btrim(coalesce(NEW.shipping_provider, '')));
BEGIN
  IF v_provider = ''
    OR v_provider IN ('merchant', 'merchant_pickup')
    OR NEW.fulfillment_type = 'self' THEN
    RETURN NEW;
  END IF;

  -- Existing orders remain fulfillable after a merchant changes settings; the
  -- guard applies only when a carrier quote or carrier selection is introduced.
  IF TG_OP = 'UPDATE'
    AND NEW.selected_quote_id IS NOT DISTINCT FROM OLD.selected_quote_id
    AND NEW.shipping_provider IS NOT DISTINCT FROM OLD.shipping_provider THEN
    RETURN NEW;
  END IF;

  IF NOT (v_provider = ANY(private.supported_carrier_provider_ids())) THEN
    -- The storefront already treats this as a stale delivery selection and
    -- returns a retryable 4xx that asks the shopper to select delivery again.
    RAISE EXCEPTION 'shipping_quote_required' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.merchant_feature_settings AS mfs
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE
        WHEN jsonb_typeof(mfs.shipping_providers) = 'array'
          THEN mfs.shipping_providers
        ELSE '[]'::jsonb
      END
    ) AS configured_provider(value)
    WHERE mfs.merchant_id = NEW.merchant_id
      AND lower(btrim(configured_provider.value)) = v_provider
  ) THEN
    RAISE EXCEPTION 'shipping_quote_required' USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_merchant_shipping_provider_enabled()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS enforce_merchant_shipping_provider_enabled
  ON public.orders;
CREATE TRIGGER enforce_merchant_shipping_provider_enabled
  BEFORE INSERT OR UPDATE OF selected_quote_id, shipping_provider
  ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_merchant_shipping_provider_enabled();

NOTIFY pgrst, 'reload schema';

$shipping_policy$;
END;
$repair$;
