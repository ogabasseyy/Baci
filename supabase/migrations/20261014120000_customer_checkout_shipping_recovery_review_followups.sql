-- Recovery review follow-ups: quote surviving units and let account deletion cascade.
--
-- 1. The recovery context projected only original order quantities, so after a
--    merchandise partial refund finished reconciliation, the fresh carrier quote
--    was calculated for refunded units. The booking path ships surviving units
--    (fulfillment_data.fulfillmentQuantity via survivingShipmentQuantity), so the
--    context now exposes the same surviving quantity per item and the API builds
--    the recovery quote from it. Fully refunded lines resolve to zero and are
--    dropped from the quote request by the API.
-- 2. The previews table used default NO ACTION foreign keys, so any recovery
--    preview blocked merchant/order deletion even though sibling tables cascade.
--    Recovery previews are PII-bearing ephemeral rows; they cascade with the
--    owning order/merchant like every other dependent table.
CREATE OR REPLACE FUNCTION public.get_customer_checkout_shipping_recovery_context(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_order public.orders%ROWTYPE; v_items jsonb;
BEGIN
  v_order := private.assert_customer_checkout_shipping_recovery(p_order_id);
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',i.id,'name',i.name,'quantity',i.quantity,'price',i.price,'product_id',i.product_id,
    'fulfillment_quantity',(CASE WHEN (i.fulfillment_data->>'fulfillmentQuantity') ~ '^[0-9]{1,9}$'
      THEN (i.fulfillment_data->>'fulfillmentQuantity')::int
      ELSE GREATEST(COALESCE(i.quantity,1),0) END),
    'product',pg_catalog.jsonb_build_object('weight_value',p.weight_value,'weight_unit',p.weight_unit,
      'dimensions',p.dimensions,'commodity_code',p.commodity_code)) ORDER BY i.id),'[]'::jsonb)
    INTO v_items FROM public.order_items i LEFT JOIN public.products p ON p.id=i.product_id
    WHERE i.order_id=p_order_id;
  -- Internal quote cost/margins, payment secrets and provider payloads stay private.
  RETURN pg_catalog.jsonb_build_object('fingerprint',
    private.customer_checkout_shipping_recovery_fingerprint(p_order_id),
    'quote_preference',(SELECT pg_catalog.jsonb_build_object('service_tier',q.service_tier,
      'carrier_name',q.carrier_name,'provider_rate_id',q.provider_rate_id,
      'is_station_pickup',q.is_station_pickup) FROM public.shipping_quotes q
      WHERE q.id=v_order.selected_quote_id AND q.merchant_id=v_order.merchant_id),'order',
    pg_catalog.jsonb_build_object('id',v_order.id,'merchant_id',v_order.merchant_id,
      'customer_name',v_order.customer_name,'customer_email',v_order.customer_email,
      'customer_phone',v_order.customer_phone,'shipping_address',v_order.shipping_address,
      'shipping_fee',v_order.shipping_fee,'order_items',v_items));
END;
$$;
ALTER TABLE private.customer_checkout_shipping_recovery_previews
  DROP CONSTRAINT IF EXISTS customer_checkout_shipping_recovery_previews_order_id_fkey,
  ADD CONSTRAINT customer_checkout_shipping_recovery_previews_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
ALTER TABLE private.customer_checkout_shipping_recovery_previews
  DROP CONSTRAINT IF EXISTS customer_checkout_shipping_recovery_previews_merchant_id_fkey,
  ADD CONSTRAINT customer_checkout_shipping_recovery_previews_merchant_id_fkey
    FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE CASCADE;
