-- Restore the authenticated confirmation API after the hardening migration's
-- final REVOKE. Function-body ownership, proof and explicit-confirmation checks
-- remain unchanged; anon and service_role retain no EXECUTE privilege.
GRANT EXECUTE ON FUNCTION public.confirm_customer_checkout_shipping_recovery(uuid,uuid,boolean)
  TO authenticated;

-- Match the bounded redaction scan's predicate and ordering. Redacted audit
-- rows remain in the table but leave this index after the redaction update.
CREATE INDEX IF NOT EXISTS checkout_shipping_recovery_pending_redaction_idx
  ON private.customer_checkout_shipping_recovery_previews (confirmed_at)
  WHERE confirmed_at IS NOT NULL
    AND (original_address <> '{}'::jsonb OR quote <> '{"redacted": true}'::jsonb);

-- Quote the same surviving units as booking: JSON numbers only, accepting
-- non-negative integral values including 1.0. Nest CASE to avoid casting
-- arbitrary strings/booleans to numeric. Preserve the existing fallback.
CREATE OR REPLACE FUNCTION public.get_customer_checkout_shipping_recovery_context(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_order public.orders%ROWTYPE; v_items jsonb;
BEGIN
  v_order := private.assert_customer_checkout_shipping_recovery(p_order_id);
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',i.id,'name',i.name,'quantity',i.quantity,'price',i.price,'product_id',i.product_id,
    'fulfillment_quantity',(CASE
      WHEN pg_catalog.jsonb_typeof(i.fulfillment_data->'fulfillmentQuantity') = 'number' THEN
        CASE WHEN (i.fulfillment_data->>'fulfillmentQuantity')::numeric >= 0
          AND (i.fulfillment_data->>'fulfillmentQuantity')::numeric =
            pg_catalog.trunc((i.fulfillment_data->>'fulfillmentQuantity')::numeric)
        THEN (i.fulfillment_data->>'fulfillmentQuantity')::numeric
        ELSE GREATEST(COALESCE(i.quantity,1),0) END
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
