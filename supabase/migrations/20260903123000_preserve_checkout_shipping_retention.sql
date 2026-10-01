-- Address edits clear selected_quote_id so a later booking cannot use a stale
-- destination. Settlement still needs the customer-checkout retention snapshot
-- even after that quote is unbound. Preserve the previously stamped checkout
-- economics and let the GIGL settlement wrapper fall back to that snapshot
-- when the live quote row is gone.

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
    IF TG_OP = 'UPDATE'
       AND OLD.shipping_funding_source = 'customer_checkout'
       AND NEW.shipping_funding_source IS NOT DISTINCT FROM 'customer_checkout' THEN
      NEW.shipping_provider_cost := OLD.shipping_provider_cost;
      NEW.shipping_platform_margin := OLD.shipping_platform_margin;
      NEW.shipping_pricing_version := OLD.shipping_pricing_version;
      NEW.shipping_platform_retained_amount := OLD.shipping_platform_retained_amount;
      RETURN NEW;
    END IF;
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

REVOKE ALL ON FUNCTION private.stamp_gigl_order_economics() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.record_merchant_settlement_gigl_v1(
  p_merchant_id       uuid,
  p_source_type       text,
  p_source_id         uuid,
  p_gateway           text,
  p_gateway_reference text,
  p_gross_amount      numeric,
  p_gateway_fee       numeric,
  p_platform_fee      numeric,
  p_description       text,
  p_metadata          jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote_shipping_amount numeric(12,2) := 0;
  v_retained_shipping_amount numeric(12,2) := 0;
  v_metadata jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: record_merchant_settlement_gigl_v1 requires service_role';
  END IF;

  IF p_source_type = 'order' THEN
    SELECT COALESCE(
      CASE
        WHEN o.shipping_funding_source = 'customer_checkout'
         AND sq.provider = 'GIGL'
         AND sq.pricing_version = 'gigl_platform_margin_v1'
        THEN sq.price
        WHEN o.shipping_funding_source = 'customer_checkout'
         AND pg_catalog.upper(pg_catalog.btrim(COALESCE(o.shipping_provider, ''))) = 'GIGL'
         AND o.shipping_pricing_version = 'gigl_platform_margin_v1'
        THEN o.shipping_platform_retained_amount
        ELSE 0
      END,
      0
    )
      INTO v_quote_shipping_amount
      FROM public.orders AS o
      LEFT JOIN public.shipping_quotes AS sq
        ON sq.id = o.selected_quote_id
       AND sq.merchant_id = o.merchant_id
      WHERE o.id = p_source_id
        AND o.merchant_id = p_merchant_id;
  END IF;

  v_retained_shipping_amount := LEAST(
    GREATEST(v_quote_shipping_amount, 0),
    GREATEST(COALESCE(p_gross_amount, 0)
      - COALESCE(p_gateway_fee, 0)
      - COALESCE(p_platform_fee, 0), 0)
  );

  v_metadata := COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
    'retained_shipping_amount', v_retained_shipping_amount
  );

  RETURN public.record_merchant_settlement(
    p_merchant_id,
    p_source_type,
    p_source_id,
    p_gateway,
    p_gateway_reference,
    p_gross_amount,
    p_gateway_fee,
    p_platform_fee + v_retained_shipping_amount,
    p_description,
    v_metadata
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_merchant_settlement_gigl_v1(
  uuid, text, uuid, text, text, numeric, numeric, numeric, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_merchant_settlement_gigl_v1(
  uuid, text, uuid, text, text, numeric, numeric, numeric, text, jsonb
) TO service_role;
