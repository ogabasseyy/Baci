-- Keep repair-center contact details behind a short-lived server capability.
-- Ordinary anon/authenticated JWTs cannot execute the RPC. The dedicated role
-- must also present a matching merchant-bound claim minted by the web server.
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'repair_pickup_receiver'
  ) THEN
    CREATE ROLE repair_pickup_receiver NOLOGIN;
  END IF;
END;
$migration$;

GRANT repair_pickup_receiver TO authenticator;
GRANT USAGE ON SCHEMA public TO repair_pickup_receiver;

CREATE OR REPLACE FUNCTION public.get_repair_pickup_receiver(
  p_merchant_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN COALESCE(auth.jwt() ->> 'repair_pickup_receiver_context', '')
        IS DISTINCT FROM 'server-quote'
      OR COALESCE(
        auth.jwt() ->> 'repair_pickup_receiver_merchant_id',
        ''
      ) IS DISTINCT FROM p_merchant_id::text
    THEN '{}'::jsonb
    ELSE COALESCE(
      (
        SELECT CASE
          WHEN COALESCE(merchant.is_published, false)
            AND COALESCE(
              settings.repair_settings ->> 'pickup_enabled',
              'true'
            ) IS DISTINCT FROM 'false'
            AND NULLIF(
              btrim(settings.repair_settings ->> 'pickup_address'),
              ''
            ) IS NOT NULL
            AND NULLIF(btrim(settings.repair_settings ->> 'city'), '')
              IS NOT NULL
            AND NULLIF(btrim(settings.repair_settings ->> 'state'), '')
              IS NOT NULL
            AND NULLIF(
              btrim(settings.repair_settings ->> 'contact_phone'),
              ''
            ) IS NOT NULL
          THEN jsonb_build_object(
            'name',
            COALESCE(
              NULLIF(
                btrim(settings.repair_settings ->> 'contact_name'),
                ''
              ),
              'Repair Center'
            ),
            'phone',
            btrim(settings.repair_settings ->> 'contact_phone'),
            'email',
            NULLIF(
              btrim(settings.repair_settings ->> 'contact_email'),
              ''
            ),
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
    )
  END;
$$;

COMMENT ON FUNCTION public.get_repair_pickup_receiver(uuid) IS
  'Server-capability-only repair-center destination for paid GIGL pickup quotes; ordinary storefront JWTs receive no contact details.';

REVOKE ALL ON FUNCTION public.get_repair_pickup_receiver(uuid)
  FROM PUBLIC, anon, authenticated, service_role, repair_pickup_receiver;
GRANT EXECUTE ON FUNCTION public.get_repair_pickup_receiver(uuid)
  TO repair_pickup_receiver;

NOTIFY pgrst, 'reload schema';
