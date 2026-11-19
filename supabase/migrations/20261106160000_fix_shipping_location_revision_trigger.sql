-- Resolve the merchant through each location's parent zone. Locations carry
-- zone_id rather than merchant_id, unlike the other configuration tables.
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
      AND OLD.shipping_providers IS NOT DISTINCT FROM NEW.shipping_providers THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN v_old := OLD.merchant_id; ELSE v_new := NEW.merchant_id; END IF;
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
