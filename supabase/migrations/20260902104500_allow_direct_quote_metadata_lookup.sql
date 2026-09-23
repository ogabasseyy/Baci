-- Direct admin booking accepts a quote submitted with the booking request.
-- Such legacy orders can have no selected_quote_id until booking succeeds, so
-- keep the exact merchant/order/quote and fulfillment checks while allowing
-- that validated pre-selection state.
BEGIN;

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
   AND (
     o.selected_quote_id = sq.id
     OR o.selected_quote_id IS NULL
   )
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
  IS 'Returns NULL for GIGL or exact Topship booking fields for the merchant order quote; supports direct booking before selected_quote_id is persisted and never exposes raw provider metadata.';

COMMIT;
