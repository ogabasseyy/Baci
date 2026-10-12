-- PR #3555 review follow-up: recheck the bound product's status
-- inside the order transaction.
--
-- Availability is advisory: a merchant can archive the bound product
-- after a positive availability response but before order creation,
-- while the client keeps showing a cached positive for an unchanged
-- cart. Neither the quote (which never reads status) nor the order
-- RPC (which never requires an active product) rechecks, so the
-- order would succeed and charge for an archived test product. The
-- guard now also requires status = 'active' on the same locked
-- product read that carries the variant recheck, failing closed with
-- the existing binding mismatch error. No new lock is taken, so the
-- deadlock analysis is unchanged.

CREATE OR REPLACE FUNCTION private.enforce_uba_redvault_private_pilot_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  policy private.uba_redvault_live_pilot_policy%ROWTYPE;
  order_row public.orders%ROWTYPE;
  line_count integer;
  product_count integer;
  bound_product uuid;
  unit_count integer;
  unit_price numeric;
  product_has_variants boolean;
  product_status text;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('uba_redvault_private_live_pilot_global_cap', 0));
  SELECT * INTO STRICT policy FROM private.uba_redvault_live_pilot_policy
    WHERE singleton FOR SHARE;
  SELECT * INTO order_row FROM public.orders WHERE id = NEW.order_id;
  SELECT count(DISTINCT item.id)::integer, count(DISTINCT item.product_id)::integer,
    min(item.product_id::text)::uuid, COALESCE(sum(item.quantity), 0)::integer,
    min(item.price)::numeric
  INTO line_count, product_count, bound_product, unit_count, unit_price
  FROM public.order_items AS item WHERE item.order_id = NEW.order_id;

  IF policy.enabled IS NOT TRUE
    AND ((policy.product_id IS NULL AND policy.staging_test_mode IS TRUE)
      OR (NEW.user_id IS DISTINCT FROM policy.user_id
        AND bound_product IS DISTINCT FROM policy.product_id)) THEN
    RETURN NEW;
  END IF;
  IF policy.reserved_attempt_id IS NOT NULL AND NEW.order_id IS DISTINCT FROM policy.reserved_order_id THEN
    RAISE EXCEPTION 'redvault_pilot_attempt_cap_reached';
  END IF;
  SELECT product.has_variants, product.status INTO product_has_variants, product_status
  FROM public.products AS product
  WHERE product.id = bound_product FOR SHARE;
  IF product_has_variants IS NOT FALSE OR product_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'redvault_pilot_order_binding_mismatch';
  END IF;
  IF policy.enabled IS NOT TRUE OR policy.expires_at <= pg_catalog.now()
    OR NEW.user_id IS DISTINCT FROM policy.user_id
    OR NEW.merchant_id IS DISTINCT FROM policy.merchant_id
    OR order_row.merchant_id IS DISTINCT FROM policy.merchant_id
    OR order_row.payment_method IS DISTINCT FROM 'uba_redvault'
    OR pg_catalog.upper(order_row.currency) IS DISTINCT FROM 'NGN'
    OR pg_catalog.round(order_row.subtotal * 100)::bigint IS DISTINCT FROM 10000
    OR pg_catalog.round(order_row.discount_amount * 100)::bigint IS DISTINCT FROM 500
    OR COALESCE(pg_catalog.round(order_row.shipping_fee * 100)::bigint, 0) <> 0
    OR COALESCE(pg_catalog.round(order_row.gift_wrapping_fee * 100)::bigint, 0) <> 0
    OR COALESCE(order_row.wallet_amount_used, 0) <> 0
    OR EXISTS (SELECT 1 FROM public.customer_savings_redemptions AS redemption
      WHERE redemption.order_id = order_row.id AND redemption.amount > 0)
    OR line_count <> 1 OR product_count <> 1 OR bound_product IS DISTINCT FROM policy.product_id
    OR unit_count <> 1 OR unit_price IS DISTINCT FROM 100::numeric
    OR EXISTS (SELECT 1 FROM public.order_items AS item
      WHERE item.order_id = NEW.order_id AND item.variant_id IS NOT NULL)
    OR order_row.tracking_number IS NOT NULL
    OR order_row.shipping_provider IS NOT NULL
    OR order_row.shipment_id IS NOT NULL
    OR order_row.shipped_at IS NOT NULL
    OR order_row.delivered_at IS NOT NULL
    OR order_row.fulfillment_details IS NOT NULL
    OR (pg_catalog.to_jsonb(order_row) ->> 'shipment_booking_lock_token') IS NOT NULL
  THEN
    RAISE EXCEPTION 'redvault_pilot_order_binding_mismatch';
  END IF;
  RETURN NEW;
END;
$$;
