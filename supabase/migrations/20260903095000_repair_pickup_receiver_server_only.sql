-- Tighten the repair-pickup receiver projection: require a usable contact phone
-- and keep the SECURITY DEFINER RPC server-only (service_role). Anonymous
-- storefront callers must not read raw repair-center contact fields via PostgREST.
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
          AND NULLIF(btrim(settings.repair_settings ->> 'contact_phone'), '')
            IS NOT NULL
        THEN jsonb_build_object(
          'name',
          COALESCE(
            NULLIF(btrim(settings.repair_settings ->> 'contact_name'), ''),
            'Repair Center'
          ),
          'phone',
          btrim(settings.repair_settings ->> 'contact_phone'),
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
  'Server-only published repair-center destination for GIGL customer pickups; requires contact phone and never grants EXECUTE to anon.';

REVOKE ALL ON FUNCTION public.get_repair_pickup_receiver(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_repair_pickup_receiver(uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';
