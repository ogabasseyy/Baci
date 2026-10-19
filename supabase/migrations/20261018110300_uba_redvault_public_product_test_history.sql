ALTER TABLE private.uba_redvault_live_pilot_policy
  ADD COLUMN IF NOT EXISTS public_product_activation_id uuid;

CREATE OR REPLACE FUNCTION private.configure_uba_redvault_public_product_test(p_enabled boolean,p_product_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE policy private.uba_redvault_live_pilot_policy%ROWTYPE;
BEGIN
  IF p_enabled THEN
    PERFORM 1 FROM public.products WHERE id=p_product_id FOR UPDATE;
  END IF;
  SELECT * INTO STRICT policy FROM private.uba_redvault_live_pilot_policy WHERE singleton FOR UPDATE;
  IF NOT p_enabled THEN
    IF policy.audience IS DISTINCT FROM 'public_product_test' THEN
      RAISE EXCEPTION 'redvault_public_test_not_configured';
    END IF;
    UPDATE private.uba_redvault_live_pilot_policy SET enabled=false,updated_at=pg_catalog.now() WHERE singleton;
    RETURN;
  END IF;
  IF p_enabled IS NOT TRUE OR p_product_id IS NULL
    OR policy.reserved_attempt_id IS NOT NULL
    OR (policy.product_id IS NOT NULL AND policy.product_id IS DISTINCT FROM p_product_id) THEN
    RAISE EXCEPTION 'redvault_public_test_configuration_invalid';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.products product WHERE product.id=p_product_id
      AND product.merchant_id=policy.merchant_id
      AND product.price=100 AND product.status='active'
      AND product.has_variants IS FALSE AND product.inventory_tracking_policy='off'
      AND private.is_uba_redvault_negotiable_product(product.brand,product.name)
      AND NOT EXISTS (SELECT 1 FROM public.product_variants variant
        WHERE variant.product_id=product.id AND variant.is_inventory_anchor IS NOT TRUE)
  ) THEN
    RAISE EXCEPTION 'redvault_public_test_product_invalid';
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_items WHERE product_id=p_product_id) AND (
    policy.audience IS DISTINCT FROM 'public_product_test'
    OR policy.product_id IS DISTINCT FROM p_product_id
    OR policy.public_product_activation_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.order_items item WHERE item.product_id=p_product_id
        AND NOT EXISTS (
          SELECT 1 FROM public.orders history_order
          JOIN private.uba_redvault_applications application ON application.order_id=history_order.id
          JOIN private.uba_redvault_line_allocations allocation ON allocation.application_id=application.id
          WHERE history_order.id=item.order_id AND history_order.merchant_id=policy.merchant_id
            AND history_order.currency='NGN' AND history_order.payment_method='uba_redvault'
            AND history_order.shipping_status IN ('pending','processing','cancelled','canceled')
            AND history_order.subtotal=100 AND history_order.discount_amount=5
            AND history_order.tax_amount>=0 AND history_order.total=95+history_order.tax_amount
            AND COALESCE(history_order.shipping_fee,0)=0
            AND COALESCE(history_order.gift_wrapping_fee,0)=0
            AND COALESCE(history_order.wallet_amount_used,0)=0
            AND history_order.tracking_number IS NULL AND history_order.shipping_provider IS NULL
            AND history_order.shipment_id IS NULL AND history_order.shipped_at IS NULL
            AND history_order.delivered_at IS NULL AND history_order.fulfillment_details IS NULL
            AND (pg_catalog.to_jsonb(history_order)->>'shipment_booking_lock_token') IS NULL
            AND item.quantity=1 AND item.price=100 AND item.variant_id IS NULL
            AND COALESCE((pg_catalog.to_jsonb(item)->>'assurance_fee')::numeric,0)=0
            AND application.merchant_id=policy.merchant_id
            AND application.discount_kobo=500 AND application.eligible_subtotal_kobo=10000
            AND allocation.order_item_id=item.id AND allocation.product_id=item.product_id
            AND allocation.unit_ordinal=1 AND allocation.allocation_kobo=500
            AND allocation.unit_price_kobo=10000 AND allocation.variant_id IS NULL
            AND (SELECT count(*) FROM public.order_items sibling WHERE sibling.order_id=item.order_id)=1
            AND (SELECT count(*) FROM private.uba_redvault_applications sibling WHERE sibling.order_id=item.order_id)=1
            AND (SELECT count(*) FROM private.uba_redvault_line_allocations sibling WHERE sibling.application_id=application.id)=1
            AND NOT EXISTS (SELECT 1 FROM public.customer_savings_redemptions redemption
              WHERE redemption.order_id=item.order_id AND redemption.amount>0)
        )
    )
  ) THEN
    RAISE EXCEPTION 'redvault_public_test_history_invalid';
  END IF;
  IF EXISTS (
    SELECT 1 FROM private.uba_redvault_line_allocations allocation
    WHERE allocation.product_id=p_product_id AND NOT EXISTS (
      SELECT 1 FROM public.order_items item
      JOIN private.uba_redvault_applications application ON application.order_id=item.order_id
      WHERE item.id=allocation.order_item_id AND item.product_id=p_product_id
        AND application.id=allocation.application_id AND application.merchant_id=policy.merchant_id
    )
  ) THEN
    RAISE EXCEPTION 'redvault_public_test_history_invalid';
  END IF;
  UPDATE private.uba_redvault_live_pilot_policy
  SET audience='public_product_test',enabled=true,product_id=p_product_id,
    public_product_activation_id=COALESCE(policy.public_product_activation_id,pg_catalog.gen_random_uuid()),
    expires_at=NULL,staging_test_mode=false,updated_at=pg_catalog.now()
  WHERE singleton;
END;
$$;
ALTER FUNCTION private.configure_uba_redvault_public_product_test(boolean,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.configure_uba_redvault_public_product_test(boolean,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
