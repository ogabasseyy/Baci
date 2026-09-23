-- Validate repair-center phone numbers before exposing paid pickup quotes.
-- Also release booking claims when local shipment persistence fails pre-provider.

CREATE OR REPLACE FUNCTION public.is_usable_repair_pickup_phone(p_phone text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_phone IS NULL OR btrim(p_phone) = '' THEN false
    WHEN lower(btrim(p_phone)) IN ('unknown', 'n/a', 'na', 'none', '-', 'nil')
      THEN false
  ELSE regexp_replace(
    CASE
      WHEN left(btrim(p_phone), 1) = '+'
        THEN substring(btrim(p_phone) FROM 2)
      ELSE btrim(p_phone)
    END,
    '[^0-9]',
    '',
    'g'
  ) ~ '^[1-9][0-9]{7,14}$'
  END;
$$;

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

CREATE OR REPLACE FUNCTION public.release_repair_pickup_booking_claim(
  p_repair_id uuid,
  p_merchant_id uuid,
  p_lock_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_repair_found boolean := false;
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT public.check_staff_permission(
       (SELECT auth.uid()),
       p_merchant_id,
       'repairs',
       'edit'
     ) THEN
    RAISE EXCEPTION 'forbidden_release_repair_pickup_booking_claim'
      USING ERRCODE = '42501';
  END IF;

  SELECT true
  INTO v_repair_found
  FROM public.repairs AS repair
  WHERE repair.id = p_repair_id
    AND repair.merchant_id = p_merchant_id
    AND repair.shipment_id IS NULL
    AND repair.pickup_booking_lock_token = p_lock_token
  FOR UPDATE;

  IF NOT v_repair_found THEN
    RETURN false;
  END IF;

  UPDATE public.repairs AS repair
  SET pickup_booking_lock_token = NULL,
      pickup_booking_started_at = NULL
  WHERE repair.id = p_repair_id
    AND repair.merchant_id = p_merchant_id
    AND repair.shipment_id IS NULL
    AND repair.pickup_booking_lock_token = p_lock_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'repair_pickup_booking_claim_not_cleared';
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.release_repair_pickup_booking_claim(
  uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_repair_pickup_booking_claim(
  uuid, uuid, uuid
) TO authenticated, service_role;

COMMENT ON FUNCTION public.release_repair_pickup_booking_claim(
  uuid, uuid, uuid
) IS
  'Clears a repair pickup booking lock before any provider shipment exists so webhook retries can reclaim promptly.';

NOTIFY pgrst, 'reload schema';
