-- Expose only the published repair-center destination fields needed to quote
-- and book GIGL customer pickups. Storefront payment and webhook callers cannot
-- construct a service-role client, and repair_settings stays off every public
-- merchant projection.
CREATE OR REPLACE FUNCTION public.get_repair_pickup_receiver(
  p_merchant_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (
      SELECT CASE
        WHEN COALESCE(merchant.is_published, false)
          AND COALESCE(
            settings.repair_settings ->> 'pickup_enabled',
            'true'
          ) IS DISTINCT FROM 'false'
          AND NULLIF(btrim(settings.repair_settings ->> 'pickup_address'), '')
            IS NOT NULL
          AND NULLIF(btrim(settings.repair_settings ->> 'city'), '') IS NOT NULL
          AND NULLIF(btrim(settings.repair_settings ->> 'state'), '') IS NOT NULL
        THEN jsonb_build_object(
          'name',
          COALESCE(
            NULLIF(btrim(settings.repair_settings ->> 'contact_name'), ''),
            'Repair Center'
          ),
          'phone',
          COALESCE(btrim(settings.repair_settings ->> 'contact_phone'), ''),
          'email',
          NULLIF(btrim(settings.repair_settings ->> 'contact_email'), ''),
          'address',
          btrim(settings.repair_settings ->> 'pickup_address'),
          'city',
          btrim(settings.repair_settings ->> 'city'),
          'state',
          btrim(settings.repair_settings ->> 'state'),
          'country',
          COALESCE(
            NULLIF(btrim(settings.repair_settings ->> 'country'), ''),
            'Nigeria'
          ),
          'countryCode',
          'NG'
        )
        ELSE '{}'::jsonb
      END
      FROM public.merchants AS merchant
      JOIN public.merchant_feature_settings AS settings
        ON settings.merchant_id = merchant.id
      WHERE merchant.id = p_merchant_id
    ),
    '{}'::jsonb
  );
$$;

COMMENT ON FUNCTION public.get_repair_pickup_receiver(uuid) IS
  'Returns the published repair-center destination required to quote and book GIGL customer pickups; private repair_settings rows remain hidden.';

REVOKE ALL ON FUNCTION public.get_repair_pickup_receiver(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_repair_pickup_receiver(uuid)
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
