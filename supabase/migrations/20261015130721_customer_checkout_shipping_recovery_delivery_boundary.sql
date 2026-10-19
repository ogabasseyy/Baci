-- Recovery is restricted to address delivery even when its selected quote was
-- deleted. Preserve the durable delivery method and fail closed in the shared
-- assertion used by context, prepare and confirm, including direct RPC calls.
-- Null remains compatible with legacy address-delivery orders; explicit
-- pickup/airport methods and surviving pickup-station quotes are unsupported.
-- Existing ownership, locks, retained payment, refund, proof and price checks
-- are unchanged. CREATE OR REPLACE preserves the existing restricted grants.
CREATE OR REPLACE FUNCTION private.assert_customer_checkout_shipping_recovery(p_order_id uuid)
RETURNS public.orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_order public.orders%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.orders o JOIN public.merchants m ON m.id=o.merchant_id
      WHERE o.id=p_order_id AND m.user_id=auth.uid()) THEN
    RAISE EXCEPTION 'forbidden_shipping_recovery' USING ERRCODE='42501';
  END IF;
  -- Same order-payment serialization boundary as refunds and pre-submit checks.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text,0));
  SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden_shipping_recovery' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.merchants WHERE id=v_order.merchant_id FOR SHARE;
  IF NOT EXISTS (SELECT 1 FROM public.merchants
    WHERE id=v_order.merchant_id AND user_id=auth.uid()) THEN
    RAISE EXCEPTION 'forbidden_shipping_recovery' USING ERRCODE='42501';
  END IF;
  -- Freeze mutable quote inputs until this RPC ends. The parent FOR UPDATE
  -- lock also conflicts with FK checks for newly inserted order items.
  PERFORM 1 FROM public.order_items WHERE order_id=p_order_id ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.products p JOIN public.order_items i ON i.product_id=p.id
    WHERE i.order_id=p_order_id ORDER BY p.id FOR SHARE OF p;
  PERFORM 1 FROM public.shipping_quotes WHERE id=v_order.selected_quote_id FOR SHARE;
  PERFORM 1 FROM public.merchant_settlements WHERE source_type='order'
    AND source_id=p_order_id AND merchant_id=v_order.merchant_id ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.transactions WHERE order_id=p_order_id
    AND merchant_id=v_order.merchant_id ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.customer_wallet_transactions WHERE source_type='order_redemption'
    AND source_id=p_order_id AND merchant_id=v_order.merchant_id ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.customer_savings_redemptions WHERE order_id=p_order_id
    AND merchant_id=v_order.merchant_id ORDER BY id FOR SHARE;
  PERFORM public.assert_shippable_order_payment(p_order_id,v_order.merchant_id);
  IF (v_order.delivery_method IS NOT NULL AND v_order.delivery_method <> 'door')
    OR EXISTS (SELECT 1 FROM public.shipping_quotes q WHERE q.id=v_order.selected_quote_id
      AND q.merchant_id=v_order.merchant_id AND q.is_station_pickup IS TRUE)
    OR v_order.shipping_provider IS DISTINCT FROM 'GIGL'
    OR v_order.shipping_funding_source IS DISTINCT FROM 'customer_checkout'
    OR lower(COALESCE(v_order.payment_status,'')) IS DISTINCT FROM 'paid'
    OR lower(COALESCE(v_order.shipping_status,'')) IS DISTINCT FROM 'processing'
    OR lower(COALESCE(v_order.payment_method,'')) IN ('pod','pay_on_delivery','credit_direct','credit-direct','manual','manual_payment','cash')
    OR v_order.cancelled_at IS NOT NULL OR v_order.shipment_id IS NOT NULL
    OR v_order.tracking_number IS NOT NULL OR v_order.shipment_booking_lock_token IS NOT NULL
    OR COALESCE(v_order.shipping_fee,0)<=0
    OR COALESCE(v_order.shipping_platform_retained_amount,0)<v_order.shipping_fee
    OR private.uba_redvault_partial_refund_blocks_booking(p_order_id) THEN
    RAISE EXCEPTION 'shipping_recovery_unavailable' USING ERRCODE='22023';
  END IF;
  -- Use the existing settled/internal-credit retention boundary. Its positive
  -- marker also ensures the economics stamp trigger preserves paid snapshots.
  IF private.order_settled_gigl_retained_amount(p_order_id,v_order.merchant_id)<=0 THEN
    RAISE EXCEPTION 'shipping_recovery_funding_not_ready' USING ERRCODE='22023';
  END IF;
  RETURN v_order;
END;
$$;

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
      'delivery_method',v_order.delivery_method,
      'shipping_fee',v_order.shipping_fee,'order_items',v_items));
END;
$$;
