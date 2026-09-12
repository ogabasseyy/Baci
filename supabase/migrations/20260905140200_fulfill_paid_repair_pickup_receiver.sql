-- Paid pickup fulfillment must still resolve the repair-center receiver after
-- the storefront is unpublished or pickup is disabled. Quote-time callers keep
-- the published + pickup-enabled gate.

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
        NOT IN ('server-quote', 'server-fulfillment')
      OR COALESCE(
        auth.jwt() ->> 'repair_pickup_receiver_merchant_id',
        ''
      ) IS DISTINCT FROM p_merchant_id::text
    THEN '{}'::jsonb
    ELSE COALESCE(
      (
        SELECT CASE
          WHEN (
            auth.jwt() ->> 'repair_pickup_receiver_context' = 'server-fulfillment'
            OR (
              COALESCE(merchant.is_published, false)
              AND COALESCE(
                settings.repair_settings ->> 'pickup_enabled',
                'true'
              ) IS DISTINCT FROM 'false'
            )
          )
            AND NULLIF(
              btrim(settings.repair_settings ->> 'pickup_address'),
              ''
            ) IS NOT NULL
            AND NULLIF(btrim(settings.repair_settings ->> 'city'), '')
              IS NOT NULL
            AND NULLIF(btrim(settings.repair_settings ->> 'state'), '')
              IS NOT NULL
            AND public.is_usable_repair_pickup_phone(
              settings.repair_settings ->> 'contact_phone'
            )
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

NOTIFY pgrst, 'reload schema';
