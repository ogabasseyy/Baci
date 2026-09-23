-- Clearing a stale quote after a carrier is disabled is quote invalidation,
-- not a new carrier selection. Keep the provider guard on new selections.
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

  IF TG_OP = 'UPDATE'
    AND NEW.shipping_provider IS NOT DISTINCT FROM OLD.shipping_provider
    AND (
      NEW.selected_quote_id IS NOT DISTINCT FROM OLD.selected_quote_id
      OR NEW.selected_quote_id IS NULL
    ) THEN
    RETURN NEW;
  END IF;

  IF NOT (v_provider = ANY(private.supported_carrier_provider_ids())) THEN
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
