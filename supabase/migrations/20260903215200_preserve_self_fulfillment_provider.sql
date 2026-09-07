-- Preserve self-fulfillment provider while retaining immutable checkout economics.

CREATE OR REPLACE FUNCTION private.stamp_gigl_order_economics()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_provider text;
  v_provider_cost numeric;
  v_platform_margin numeric;
  v_pricing_version text;
  v_price numeric;
  v_legacy_checkout boolean := false;
BEGIN
  IF NEW.shipping_funding_source IS NOT NULL
     AND NEW.shipping_funding_source NOT IN ('customer_checkout', 'merchant_wallet') THEN
    RAISE EXCEPTION 'Invalid shipping funding source' USING ERRCODE = '22023';
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.shipping_funding_source = 'customer_checkout'
     AND OLD.shipping_platform_retained_amount IS NOT NULL THEN
    NEW.shipping_funding_source := 'customer_checkout';
    IF COALESCE(NEW.fulfillment_type, '') IS DISTINCT FROM 'self' THEN
      NEW.shipping_provider := 'GIGL';
    END IF;
    NEW.shipping_provider_cost := OLD.shipping_provider_cost;
    NEW.shipping_platform_margin := OLD.shipping_platform_margin;
    NEW.shipping_pricing_version := OLD.shipping_pricing_version;
    NEW.shipping_platform_retained_amount := OLD.shipping_platform_retained_amount;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.shipping_funding_source = 'merchant_wallet'
     AND NEW.selected_quote_id IS NOT NULL THEN
    NEW.shipping_funding_source := 'merchant_wallet';
  END IF;

  IF NEW.selected_quote_id IS NULL THEN
    NEW.shipping_funding_source := NULL;
    NEW.shipping_provider_cost := NULL;
    NEW.shipping_platform_margin := NULL;
    NEW.shipping_pricing_version := NULL;
    NEW.shipping_platform_retained_amount := 0;
    RETURN NEW;
  END IF;

  SELECT sq.provider, sq.provider_cost, sq.platform_margin,
         sq.pricing_version, sq.price
    INTO v_provider, v_provider_cost, v_platform_margin, v_pricing_version, v_price
    FROM public.shipping_quotes sq
   WHERE sq.id = NEW.selected_quote_id
     AND sq.merchant_id = NEW.merchant_id
   LIMIT 1;
  v_legacy_checkout := TG_OP = 'UPDATE'
    AND NEW.payment_status = 'paid'
    AND OLD.payment_status IS DISTINCT FROM 'paid'
    AND NEW.shipping_funding_source IS NULL
    AND NEW.shipping_platform_retained_amount IS NULL
    AND v_pricing_version IS NULL;
  IF NOT FOUND
     OR pg_catalog.upper(pg_catalog.btrim(COALESCE(v_provider, ''))) <> 'GIGL'
     OR (v_pricing_version IS DISTINCT FROM 'gigl_platform_margin_v1'
         AND NOT v_legacy_checkout) THEN
    NEW.shipping_funding_source := NULL;
    NEW.shipping_provider_cost := NULL;
    NEW.shipping_platform_margin := NULL;
    NEW.shipping_pricing_version := NULL;
    NEW.shipping_platform_retained_amount := 0;
    RETURN NEW;
  END IF;
  IF NEW.shipping_funding_source IS NULL THEN
    NEW.shipping_funding_source := 'customer_checkout';
  END IF;
  NEW.shipping_provider_cost := v_provider_cost;
  NEW.shipping_platform_margin := v_platform_margin;
  NEW.shipping_pricing_version := COALESCE(v_pricing_version, 'gigl_platform_margin_v1');
  NEW.shipping_platform_retained_amount := CASE
    WHEN NEW.shipping_funding_source = 'customer_checkout' THEN
      CASE WHEN v_legacy_checkout
        THEN GREATEST(COALESCE(NEW.shipping_fee, v_price, 0), 0)
        ELSE v_price
      END
    ELSE 0
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.stamp_gigl_order_economics() FROM PUBLIC;
