DO $$
DECLARE
  v_revision_merchant_id_attnum smallint;
  v_merchants_id_attnum smallint;
BEGIN
  SELECT attnum INTO STRICT v_revision_merchant_id_attnum
  FROM pg_attribute
  WHERE attrelid = 'public.merchant_shipping_config_revisions'::regclass
    AND attname = 'merchant_id'
    AND NOT attisdropped;

  SELECT attnum INTO STRICT v_merchants_id_attnum
  FROM pg_attribute
  WHERE attrelid = 'public.merchants'::regclass
    AND attname = 'id'
    AND NOT attisdropped;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS c
    WHERE c.conrelid = 'public.merchant_shipping_config_revisions'::regclass
      AND c.conname = 'merchant_shipping_config_revisions_merchant_id_fkey'
      AND c.contype = 'f'
      AND c.conkey = ARRAY[v_revision_merchant_id_attnum]::smallint[]
      AND c.confrelid = 'public.merchants'::regclass
      AND c.confkey = ARRAY[v_merchants_id_attnum]::smallint[]
      AND c.confdeltype = 'c'
      AND c.convalidated
  ) THEN
    ALTER TABLE public.merchant_shipping_config_revisions
      ADD CONSTRAINT merchant_shipping_config_revisions_merchant_id_fkey
      FOREIGN KEY (merchant_id)
      REFERENCES public.merchants(id)
      ON DELETE CASCADE;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS cleanup_merchant_shipping_config_revision ON public.merchants;
DROP FUNCTION IF EXISTS private.cleanup_merchant_shipping_config_revision();

CREATE OR REPLACE FUNCTION private.track_shipping_config_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old uuid;
  v_new uuid;
BEGIN
  IF TG_TABLE_NAME = 'merchants' THEN
    IF OLD.country IS NOT DISTINCT FROM NEW.country
      AND OLD.payout_currency IS NOT DISTINCT FROM NEW.payout_currency THEN
      RETURN NEW;
    END IF;
    v_old := OLD.id;
    v_new := NEW.id;
  ELSIF TG_TABLE_NAME = 'merchant_feature_settings' THEN
    IF TG_OP = 'UPDATE'
      AND OLD.shipping_providers IS NOT DISTINCT FROM NEW.shipping_providers
      AND OLD.merchant_id IS NOT DISTINCT FROM NEW.merchant_id THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN
      v_old := OLD.merchant_id;
    ELSIF TG_OP = 'INSERT' THEN
      v_new := NEW.merchant_id;
    ELSE
      v_old := OLD.merchant_id;
      v_new := NEW.merchant_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'merchant_shipping_zone_locations' THEN
    IF TG_OP <> 'INSERT' THEN
      SELECT z.merchant_id INTO v_old
      FROM public.merchant_shipping_zones AS z
      WHERE z.id = OLD.zone_id;
    END IF;
    IF TG_OP <> 'DELETE' THEN
      SELECT z.merchant_id INTO v_new
      FROM public.merchant_shipping_zones AS z
      WHERE z.id = NEW.zone_id;
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    v_new := NEW.merchant_id;
  ELSIF TG_OP = 'DELETE' THEN
    v_old := OLD.merchant_id;
  ELSE
    v_old := OLD.merchant_id;
    v_new := NEW.merchant_id;
  END IF;

  PERFORM private.bump_merchant_shipping_config_revision(v_old, v_new);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.track_shipping_config_row_change() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.track_shipping_config_row_change()
  FROM PUBLIC, anon, authenticated, service_role;
