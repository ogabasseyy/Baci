ALTER TABLE private.uba_redvault_live_pilot_policy
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'private_user'
  CHECK (audience IN ('private_user','public_product_test'));

DO $$
DECLARE constraint_name text;
BEGIN
  SELECT conname INTO STRICT constraint_name FROM pg_catalog.pg_constraint
  WHERE conrelid='private.uba_redvault_live_pilot_policy'::regclass
    AND contype='c'
    AND pg_catalog.pg_get_constraintdef(oid) LIKE '%enabled%'
    AND pg_catalog.pg_get_constraintdef(oid) LIKE '%expires_at IS NOT NULL%';
  EXECUTE pg_catalog.format('ALTER TABLE private.uba_redvault_live_pilot_policy DROP CONSTRAINT %I',constraint_name);
END;
$$;

ALTER TABLE private.uba_redvault_live_pilot_policy
  ADD CONSTRAINT redvault_live_pilot_audience_configuration CHECK (
    NOT enabled OR (product_id IS NOT NULL AND (
      (audience='private_user' AND expires_at IS NOT NULL)
      OR (audience='public_product_test' AND expires_at IS NULL
        AND reserved_order_id IS NULL AND reserved_attempt_id IS NULL)
    ))
  );

CREATE OR REPLACE FUNCTION private.configure_uba_redvault_public_product_test(p_enabled boolean,p_product_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE policy private.uba_redvault_live_pilot_policy%ROWTYPE;
BEGIN
  IF p_enabled THEN
    PERFORM 1 FROM public.products WHERE id=p_product_id FOR SHARE;
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
      AND NOT EXISTS (SELECT 1 FROM public.order_items item WHERE item.product_id=product.id
        AND NOT EXISTS (SELECT 1 FROM private.uba_redvault_applications application
          WHERE application.order_id=item.order_id AND application.merchant_id=policy.merchant_id))
  ) THEN
    RAISE EXCEPTION 'redvault_public_test_product_invalid';
  END IF;
  UPDATE private.uba_redvault_live_pilot_policy
  SET audience='public_product_test',enabled=true,product_id=p_product_id,
    expires_at=NULL,staging_test_mode=false,updated_at=pg_catalog.now()
  WHERE singleton;
END;
$$;
ALTER FUNCTION private.configure_uba_redvault_public_product_test(boolean,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.configure_uba_redvault_public_product_test(boolean,uuid)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.restore_uba_redvault_private_test_audience()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE policy private.uba_redvault_live_pilot_policy%ROWTYPE;
BEGIN
  PERFORM 1 FROM public.products WHERE id=(
    SELECT product_id FROM private.uba_redvault_live_pilot_policy WHERE singleton
  ) FOR SHARE;
  SELECT * INTO STRICT policy FROM private.uba_redvault_live_pilot_policy WHERE singleton FOR UPDATE;
  IF policy.audience IS DISTINCT FROM 'public_product_test' OR policy.enabled IS NOT FALSE THEN
    RAISE EXCEPTION 'redvault_public_test_must_be_disabled';
  END IF;
  IF policy.reserved_order_id IS NOT NULL OR policy.reserved_attempt_id IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.order_items WHERE product_id=policy.product_id) THEN
    RAISE EXCEPTION 'redvault_public_test_history_requires_preserved_audience';
  END IF;
  UPDATE private.uba_redvault_live_pilot_policy
  SET audience='private_user',expires_at=NULL,updated_at=pg_catalog.now() WHERE singleton;
END;
$$;
ALTER FUNCTION private.restore_uba_redvault_private_test_audience() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.restore_uba_redvault_private_test_audience()
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.assert_uba_redvault_public_product_test_order(p_order_id uuid,p_require_application boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  policy private.uba_redvault_live_pilot_policy%ROWTYPE;
  order_row public.orders%ROWTYPE;
  line_count integer;
BEGIN
  SELECT * INTO STRICT policy FROM private.uba_redvault_live_pilot_policy WHERE singleton FOR SHARE;
  IF policy.audience IS DISTINCT FROM 'public_product_test' OR policy.enabled IS NOT TRUE
    OR policy.product_id IS NULL OR policy.expires_at IS NOT NULL THEN
    RAISE EXCEPTION 'redvault_public_test_disabled';
  END IF;
  SELECT * INTO STRICT order_row FROM public.orders WHERE id=p_order_id FOR SHARE;
  PERFORM 1 FROM public.products WHERE id=policy.product_id FOR SHARE;
  IF order_row.merchant_id IS DISTINCT FROM policy.merchant_id
    OR pg_catalog.upper(order_row.currency) IS DISTINCT FROM 'NGN'
    OR order_row.payment_method IS DISTINCT FROM 'uba_redvault'
    OR pg_catalog.lower(order_row.shipping_status) IN ('cancelled','canceled')
    OR order_row.subtotal IS DISTINCT FROM 100::numeric
    OR order_row.discount_amount IS DISTINCT FROM 5::numeric
    OR order_row.tax_amount IS NULL OR order_row.tax_amount<0
    OR order_row.total IS DISTINCT FROM (95::numeric+order_row.tax_amount)
    OR COALESCE(order_row.shipping_fee,0)<>0 OR COALESCE(order_row.gift_wrapping_fee,0)<>0
    OR COALESCE(order_row.wallet_amount_used,0)<>0
    OR order_row.tracking_number IS NOT NULL OR order_row.shipping_provider IS NOT NULL
    OR order_row.shipment_id IS NOT NULL OR order_row.shipped_at IS NOT NULL
    OR order_row.delivered_at IS NOT NULL OR order_row.fulfillment_details IS NOT NULL
    OR (pg_catalog.to_jsonb(order_row)->>'shipment_booking_lock_token') IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.customer_savings_redemptions redemption
      WHERE redemption.order_id=p_order_id AND redemption.amount>0) THEN
    RAISE EXCEPTION 'redvault_public_test_order_mismatch';
  END IF;
  SELECT count(*) INTO line_count FROM public.order_items WHERE order_id=p_order_id;
  IF line_count<>1 OR NOT EXISTS (
    SELECT 1 FROM public.order_items item JOIN public.products product ON product.id=item.product_id
    WHERE item.order_id=p_order_id AND item.product_id=policy.product_id
      AND item.quantity=1 AND item.price=100 AND item.variant_id IS NULL
      AND COALESCE((pg_catalog.to_jsonb(item)->>'assurance_fee')::numeric,0)=0
      AND product.merchant_id=policy.merchant_id AND product.price=100
      AND product.status='active' AND product.has_variants IS FALSE
      AND product.inventory_tracking_policy='off'
      AND private.is_uba_redvault_negotiable_product(product.brand,product.name)
      AND NOT EXISTS (SELECT 1 FROM public.product_variants variant
        WHERE variant.product_id=product.id AND variant.is_inventory_anchor IS NOT TRUE)
  ) THEN
    RAISE EXCEPTION 'redvault_public_test_product_mismatch';
  END IF;
  IF p_require_application AND NOT EXISTS (
    SELECT 1 FROM private.uba_redvault_applications application
    WHERE application.order_id=p_order_id AND application.merchant_id=policy.merchant_id
      AND application.discount_kobo=500 AND application.eligible_subtotal_kobo=10000
  ) THEN
    RAISE EXCEPTION 'redvault_public_test_application_mismatch';
  END IF;
END;
$$;
ALTER FUNCTION private.assert_uba_redvault_public_product_test_order(uuid,boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.assert_uba_redvault_public_product_test_order(uuid,boolean)
  FROM PUBLIC,anon,authenticated,service_role;
