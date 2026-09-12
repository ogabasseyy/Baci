-- Allow order editors (not only fulfillers) to load Topship booking metadata.
-- Aligns with get_shipping_quote_booking_economics and wallet-charge projections.

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
     OR (
       o.selected_quote_id IS NULL
       AND sq.session_id = p_order_id::text
     )
   )
  WHERE sq.id = p_quote_id
    AND sq.merchant_id = p_merchant_id
    AND (
      EXISTS (
        SELECT 1
        FROM public.merchants AS merchant
        WHERE merchant.id = p_merchant_id
          AND merchant.user_id = (SELECT auth.uid())
      )
      OR public.check_staff_permission(
        (SELECT auth.uid()), p_merchant_id, 'orders', 'fulfill'
      )
      OR public.check_staff_permission(
        (SELECT auth.uid()), p_merchant_id, 'orders', 'edit'
      )
    );
$$;

REVOKE ALL ON FUNCTION public.get_shipping_quote_booking_metadata(uuid, uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_shipping_quote_booking_metadata(uuid, uuid, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_shipping_quote_booking_metadata(uuid, uuid, uuid)
  IS 'Returns NULL for GIGL or exact Topship booking fields for the merchant order quote; null selected_quote_id requires session_id = order id; authorized for owners and staff with orders fulfill or edit.';

COMMIT;
