-- Remove payment-time legacy economics inference, restore the canonical
-- storefront shipping-provider default, and allow self-fulfillment to release
-- never-submitted wallet reservations.

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
  IF NOT FOUND
     OR pg_catalog.upper(pg_catalog.btrim(COALESCE(v_provider, ''))) <> 'GIGL'
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
  NEW.shipping_pricing_version := 'gigl_platform_margin_v1';
  NEW.shipping_platform_retained_amount := CASE
    WHEN NEW.shipping_funding_source = 'customer_checkout' THEN v_price
    ELSE 0
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.stamp_gigl_order_economics() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.get_storefront_shipping_rates(
  p_merchant_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'zones', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', z.id,
          'name', z.name,
          'is_rest_of_world', z.is_rest_of_world
        )
        ORDER BY z.is_rest_of_world, z.name
      )
      FROM public.merchant_shipping_zones AS z
      WHERE z.merchant_id = p_merchant_id
        AND z.active
    ), '[]'::jsonb),
    'locations', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'zone_id', l.zone_id,
          'country_code', l.country_code,
          'subdivision_code', l.subdivision_code
        )
        ORDER BY l.country_code, l.subdivision_code
      )
      FROM public.merchant_shipping_zone_locations AS l
      JOIN public.merchant_shipping_zones AS z ON z.id = l.zone_id
      WHERE z.merchant_id = p_merchant_id
        AND z.active
    ), '[]'::jsonb),
    'rates', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'zone_id', r.zone_id,
          'name', r.name,
          'kind', r.kind,
          'currency', r.currency,
          'base_amount', r.base_amount,
          'condition_type', r.condition_type,
          'min_subtotal', r.min_subtotal,
          'max_subtotal', r.max_subtotal,
          'free_over_amount', r.free_over_amount,
          'delivery_min_days', r.delivery_min_days,
          'delivery_max_days', r.delivery_max_days,
          'pickup_address', r.pickup_address,
          'sort_order', r.sort_order
        )
        ORDER BY r.sort_order, r.base_amount, r.id
      )
      FROM public.merchant_shipping_rates AS r
      JOIN public.merchant_shipping_zones AS z ON z.id = r.zone_id
      WHERE r.merchant_id = p_merchant_id
        AND r.active
        AND z.active
    ), '[]'::jsonb),
    'merchant_payout_currency', (
      SELECT m.payout_currency
      FROM public.merchants AS m
      WHERE m.id = p_merchant_id
    ),
    'merchant_country', (
      SELECT m.country
      FROM public.merchants AS m
      WHERE m.id = p_merchant_id
    ),
    'shipping_providers', COALESCE(
      (
        SELECT fs.shipping_providers
        FROM public.merchant_feature_settings AS fs
        WHERE fs.merchant_id = p_merchant_id
          AND fs.shipping_providers IS NOT NULL
      ),
      '["gigl", "topship"]'::jsonb
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.release_reserved_merchant_shipping_charges_for_order(
  p_order_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_charge public.merchant_shipping_charges%ROWTYPE;
  v_balance numeric;
  v_transaction uuid;
  v_released integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.orders AS o
    JOIN public.merchants AS merchant ON merchant.id = o.merchant_id
    WHERE o.id = p_order_id
      AND (
        merchant.user_id = (SELECT auth.uid())
        OR public.check_staff_permission(
          (SELECT auth.uid()), o.merchant_id, 'orders', 'fulfill'
        )
        OR public.check_staff_permission(
          (SELECT auth.uid()), o.merchant_id, 'orders', 'edit'
        )
      )
  ) THEN
    RAISE EXCEPTION 'order_not_owned' USING ERRCODE = '42501';
  END IF;

  FOR v_charge IN
    SELECT charge.*
    FROM public.merchant_shipping_charges AS charge
    WHERE charge.order_id = p_order_id
      AND charge.status = 'reserved'
      AND charge.shipment_id IS NULL
    FOR UPDATE
  LOOP
    UPDATE public.merchant_wallets
    SET available_balance = available_balance + v_charge.charged_amount,
        updated_at = now()
    WHERE merchant_id = v_charge.merchant_id
    RETURNING available_balance INTO v_balance;

    INSERT INTO public.wallet_transactions(
      wallet_id, merchant_id, type, amount, balance_after, source_type,
      source_id, description, status
    )
    SELECT id, v_charge.merchant_id, 'refund', v_charge.charged_amount,
      v_balance, 'gigl_shipping', v_charge.order_id,
      'GIGL shipping reservation refund before self-fulfillment', 'completed'
    FROM public.merchant_wallets
    WHERE merchant_id = v_charge.merchant_id
    RETURNING id INTO v_transaction;

    UPDATE public.merchant_shipping_charges
    SET status = 'refunded',
        refund_transaction_id = v_transaction,
        failure_code = 'SELF_FULFILL_BEFORE_SUBMISSION',
        refunded_at = now(),
        updated_at = now()
    WHERE id = v_charge.id;
    v_released := v_released + 1;
  END LOOP;

  RETURN v_released;
END;
$$;

REVOKE ALL ON FUNCTION public.release_reserved_merchant_shipping_charges_for_order(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_reserved_merchant_shipping_charges_for_order(uuid)
  TO authenticated;
