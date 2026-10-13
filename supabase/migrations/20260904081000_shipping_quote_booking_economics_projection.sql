-- Expose quote and order economics only through a purpose-built booking
-- projection. Authenticated PostgREST clients cannot select the restricted
-- economics columns directly from orders or shipping_quotes.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_shipping_quote_booking_economics(
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
  SELECT jsonb_build_object(
    'provider_cost', sq.provider_cost,
    'platform_margin', sq.platform_margin,
    'platform_margin_bps', sq.platform_margin_bps,
    'pricing_version', sq.pricing_version,
    'shipping_provider_cost', o.shipping_provider_cost,
    'shipping_platform_margin', o.shipping_platform_margin,
    'shipping_pricing_version', o.shipping_pricing_version,
    'shipping_platform_retained_amount', o.shipping_platform_retained_amount
  )
  FROM public.shipping_quotes AS sq
  JOIN public.orders AS o
    ON o.id = p_order_id
   AND o.merchant_id = p_merchant_id
   AND (
     o.selected_quote_id = sq.id
     OR o.selected_quote_id IS NULL
     OR EXISTS (
       SELECT 1
       FROM public.shipping_quote_attestations AS attestation
       WHERE attestation.quote_id = sq.id
         AND attestation.order_id = o.id
         AND attestation.merchant_id = p_merchant_id
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

REVOKE ALL ON FUNCTION public.get_shipping_quote_booking_economics(uuid, uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_shipping_quote_booking_economics(uuid, uuid, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_shipping_quote_booking_economics(uuid, uuid, uuid)
  IS 'Returns quote and order economics for an authorized booking context; never exposes raw provider metadata.';

COMMIT;
