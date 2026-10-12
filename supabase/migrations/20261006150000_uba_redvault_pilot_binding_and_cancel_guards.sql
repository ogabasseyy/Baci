-- PR #3555 round-4 review follow-ups: pilot reservation and binding guards.
--
-- 1. Cancelled pilot orders must never reserve a new payment attempt. The
--    fulfillment guard carves out both cancellation spellings, but the
--    reservation path only required an unpaid order: a retry on an order
--    wound down as `canceled` could open Paystack checkout, capture funds,
--    then fail approval (which rejects both spellings), stranding money in
--    captured-held. assert_uba_redvault_private_pilot_active now rejects
--    reservation for pilot-bound orders cancelled under either spelling
--    (case-insensitive, a superset of the approval check so the failure
--    surfaces before provider capture, never after).
--
-- 2. Pilot orders must bind with empty fulfillment metadata. The order
--    route forwards client-supplied tracking numbers and shipping
--    providers into the draft, and the fulfillment guard only fires on
--    UPDATE, so a pilot order could be created already carrying
--    fulfillment data that the guard then prevents clearing. The binding
--    check now requires every fulfillment field to be empty at bind time.

CREATE OR REPLACE FUNCTION private.assert_uba_redvault_private_pilot_active(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  policy private.uba_redvault_live_pilot_policy%ROWTYPE;
  application_id uuid;
  application_user_id uuid;
  application_product_bound boolean;
  order_shipping_status text;
BEGIN
  SELECT * INTO STRICT policy FROM private.uba_redvault_live_pilot_policy WHERE singleton;
  SELECT application.id, application.user_id,
    EXISTS (SELECT 1 FROM private.uba_redvault_line_allocations AS allocation
      WHERE allocation.application_id = application.id
        AND allocation.product_id = policy.product_id)
  INTO application_id, application_user_id, application_product_bound
  FROM private.uba_redvault_applications AS application
  WHERE application.order_id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'redvault_customer_context_required'; END IF;
  IF policy.enabled IS TRUE AND (application_user_id IS DISTINCT FROM policy.user_id
    OR application_product_bound IS NOT TRUE) THEN
    RAISE EXCEPTION 'redvault_pilot_order_binding_mismatch';
  END IF;
  IF application_user_id = policy.user_id OR application_product_bound IS TRUE THEN
    SELECT o.shipping_status INTO order_shipping_status
    FROM public.orders AS o WHERE o.id = p_order_id;
    IF pg_catalog.lower(order_shipping_status) IN ('canceled', 'cancelled') THEN
      RAISE EXCEPTION 'redvault_pilot_order_cancelled';
    END IF;
  END IF;
  IF application_user_id = policy.user_id OR application_product_bound IS TRUE THEN
    IF policy.reserved_attempt_id IS NOT NULL
      AND p_order_id IS DISTINCT FROM policy.reserved_order_id THEN
      RAISE EXCEPTION 'redvault_pilot_attempt_cap_reached';
    END IF;
  END IF;
  IF (application_user_id = policy.user_id OR application_product_bound IS TRUE)
    AND (policy.enabled IS NOT TRUE OR policy.expires_at <= pg_catalog.now()) THEN
    RAISE EXCEPTION 'redvault_pilot_disabled_or_expired';
  END IF;
END;
$$;

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
    AND NEW.user_id IS DISTINCT FROM policy.user_id
    AND (policy.product_id IS NULL OR bound_product IS DISTINCT FROM policy.product_id) THEN
    RETURN NEW;
  END IF;
  IF policy.reserved_attempt_id IS NOT NULL AND NEW.order_id IS DISTINCT FROM policy.reserved_order_id THEN
    RAISE EXCEPTION 'redvault_pilot_attempt_cap_reached';
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
