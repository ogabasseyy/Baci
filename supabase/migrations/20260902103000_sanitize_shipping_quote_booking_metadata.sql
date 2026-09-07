-- Keep provider metadata out of authenticated shipping_quotes reads while
-- preserving provider booking through a tightly scoped, sanitized projection.
BEGIN;

REVOKE SELECT ON TABLE public.shipping_quotes FROM authenticated;
REVOKE INSERT ON TABLE public.shipping_quotes FROM authenticated;
REVOKE UPDATE ON TABLE public.shipping_quotes FROM authenticated;
REVOKE INSERT (
  price,
  provider_cost,
  platform_margin,
  platform_margin_bps,
  pricing_version,
  provider_metadata
) ON TABLE public.shipping_quotes FROM authenticated;
REVOKE UPDATE (
  price,
  provider_cost,
  platform_margin,
  platform_margin_bps,
  pricing_version,
  provider_metadata
) ON TABLE public.shipping_quotes FROM authenticated;
GRANT UPDATE (used) ON TABLE public.shipping_quotes TO authenticated;

GRANT SELECT (
  id,
  session_id,
  merchant_id,
  provider,
  service_tier,
  carrier_name,
  price,
  currency,
  estimated_days,
  min_days,
  max_days,
  pickup_included,
  insurance_included,
  provider_rate_id,
  is_station_pickup,
  station_name,
  station_address,
  quote_request,
  used,
  expires_at,
  created_at
) ON TABLE public.shipping_quotes TO authenticated;

CREATE OR REPLACE FUNCTION public.get_shipping_quote_booking_metadata(
  p_merchant_id uuid,
  p_order_id uuid,
  p_quote_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN sq.provider = 'TOPSHIP' THEN jsonb_build_object(
      'pricingTier', sq.provider_metadata ->> 'pricingTier',
      'serviceType', sq.provider_metadata ->> 'serviceType',
      'cost', CASE
        WHEN (sq.provider_metadata ->> 'cost') ~ '^-?[0-9]+(\.[0-9]+)?$'
          THEN to_jsonb((sq.provider_metadata ->> 'cost')::numeric)
        ELSE NULL
      END
    )
    ELSE NULL
  END
  FROM public.shipping_quotes AS sq
  JOIN public.orders AS o
    ON o.id = p_order_id
   AND o.merchant_id = p_merchant_id
   AND o.selected_quote_id = sq.id
  WHERE sq.id = p_quote_id
    AND sq.merchant_id = p_merchant_id
    AND public.check_staff_permission(
      (SELECT auth.uid()), p_merchant_id, 'orders', 'fulfill'
    );
$$;

REVOKE ALL ON FUNCTION public.get_shipping_quote_booking_metadata(uuid, uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_shipping_quote_booking_metadata(uuid, uuid, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_shipping_quote_booking_metadata(uuid, uuid, uuid)
  IS 'Returns NULL for GIGL or exact Topship booking fields; never exposes raw provider metadata.';

COMMIT;
