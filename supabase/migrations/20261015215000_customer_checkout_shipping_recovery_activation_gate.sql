-- Keep recovery writes closed through the initial coordinated release.
-- An operator records the verified compatible production artifact only after
-- worker, migration, Security, serving-alias and health checks have passed.
-- This operational row is private; clients cannot read or activate recovery.
CREATE TABLE private.checkout_shipping_recovery_release_activation (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  rollback_deployment_id text,
  rollback_commit_sha text,
  verified_at timestamptz,
  CONSTRAINT checkout_shipping_recovery_verified_rollback CHECK (
    NOT enabled OR (
      rollback_deployment_id IS NOT NULL AND rollback_deployment_id ~ '^dpl_[A-Za-z0-9]+$'
      AND rollback_commit_sha IS NOT NULL AND rollback_commit_sha ~ '^[0-9a-f]{40}$'
      AND rollback_commit_sha <> '32e893bf99bb8060e55e7440d3288418efa43189'
      AND verified_at IS NOT NULL
    )
  )
);
ALTER TABLE private.checkout_shipping_recovery_release_activation ENABLE ROW LEVEL SECURITY;
CREATE POLICY checkout_shipping_recovery_activation_client_deny
  ON private.checkout_shipping_recovery_release_activation AS RESTRICTIVE
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE private.checkout_shipping_recovery_release_activation
  FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO private.checkout_shipping_recovery_release_activation(singleton) VALUES (true);

-- Older calls may already have passed the pre-gate assertion. Enforce the
-- boundary again at their preview insert/confirmation write, so the complete
-- transaction aborts. Retention redaction does not update confirmed_at.
CREATE FUNCTION private.enforce_checkout_shipping_recovery_activation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_enabled boolean;
BEGIN
  SELECT enabled INTO v_enabled FROM private.checkout_shipping_recovery_release_activation
    WHERE singleton IS TRUE FOR SHARE;
  IF v_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'shipping_recovery_not_activated' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.enforce_checkout_shipping_recovery_activation() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.enforce_checkout_shipping_recovery_activation()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER enforce_checkout_shipping_recovery_activation
  BEFORE INSERT OR UPDATE OF confirmed_at ON private.customer_checkout_shipping_recovery_previews
  FOR EACH ROW EXECUTE FUNCTION private.enforce_checkout_shipping_recovery_activation();

CREATE OR REPLACE FUNCTION private.assert_customer_checkout_shipping_recovery(p_order_id uuid)
RETURNS public.orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_order public.orders%ROWTYPE; v_enabled boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.orders o JOIN public.merchants m ON m.id=o.merchant_id
      WHERE o.id=p_order_id AND m.user_id=auth.uid()) THEN
    RAISE EXCEPTION 'forbidden_shipping_recovery' USING ERRCODE='42501';
  END IF;
  -- Same order-payment serialization boundary as refunds and pre-submit checks.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text,0));
  -- Hold the activation row through the transaction: disabling waits for
  -- in-flight recovery writes, and new writers fail closed after it commits.
  SELECT enabled INTO v_enabled
    FROM private.checkout_shipping_recovery_release_activation
    WHERE singleton IS TRUE FOR SHARE;
  IF v_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'shipping_recovery_not_activated' USING ERRCODE='55000';
  END IF;
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

COMMENT ON TABLE private.checkout_shipping_recovery_release_activation IS
  'Operator-controlled recovery activation after verified compatible rollback artifact; not order data.';
