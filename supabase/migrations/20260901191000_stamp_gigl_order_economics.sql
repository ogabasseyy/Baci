ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS shipping_funding_source text,
  ADD COLUMN IF NOT EXISTS shipping_provider_cost numeric(12,2),
  ADD COLUMN IF NOT EXISTS shipping_platform_margin numeric(12,2),
  ADD COLUMN IF NOT EXISTS shipping_platform_retained_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS shipping_pricing_version text;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_shipping_funding_source_check,
  ADD CONSTRAINT orders_shipping_funding_source_check
    CHECK (shipping_funding_source IS NULL OR shipping_funding_source IN ('customer_checkout', 'merchant_wallet'));

CREATE OR REPLACE FUNCTION private.stamp_gigl_order_economics()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_provider text;
  v_merchant_id uuid;
  v_provider_cost numeric;
  v_platform_margin numeric;
  v_pricing_version text;
  v_price numeric;
BEGIN
  IF NEW.shipping_funding_source IS NOT NULL
    AND NEW.shipping_funding_source NOT IN ('customer_checkout', 'merchant_wallet') THEN
    RAISE EXCEPTION 'Invalid shipping funding source' USING ERRCODE = '22023';
  END IF;

  IF NEW.selected_quote_id IS NULL THEN
    NEW.shipping_funding_source := NULL;
    NEW.shipping_provider_cost := NULL;
    NEW.shipping_platform_margin := NULL;
    NEW.shipping_pricing_version := NULL;
    NEW.shipping_platform_retained_amount := 0;
    RETURN NEW;
  END IF;

  SELECT sq.provider, sq.merchant_id, sq.provider_cost, sq.platform_margin,
         sq.pricing_version, sq.price
    INTO v_provider, v_merchant_id, v_provider_cost, v_platform_margin,
         v_pricing_version, v_price
    FROM public.shipping_quotes AS sq
   WHERE sq.id = NEW.selected_quote_id
     AND sq.merchant_id = NEW.merchant_id
   LIMIT 1;

  IF NOT FOUND OR pg_catalog.upper(pg_catalog.btrim(COALESCE(v_provider, ''))) <> 'GIGL'
     OR v_merchant_id IS DISTINCT FROM NEW.merchant_id
     OR v_pricing_version IS DISTINCT FROM 'gigl_platform_margin_v1' THEN
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
  NEW.shipping_pricing_version := v_pricing_version;
  NEW.shipping_platform_retained_amount := CASE
    WHEN NEW.shipping_funding_source = 'customer_checkout' THEN v_price
    ELSE 0
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stamp_gigl_order_economics ON public.orders;
CREATE TRIGGER stamp_gigl_order_economics
  BEFORE INSERT OR UPDATE OF selected_quote_id, shipping_funding_source,
    shipping_provider_cost, shipping_platform_margin,
    shipping_platform_retained_amount, shipping_pricing_version
  ON public.orders
  FOR EACH ROW EXECUTE FUNCTION private.stamp_gigl_order_economics();
