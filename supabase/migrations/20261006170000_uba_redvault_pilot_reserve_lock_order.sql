-- PR #3555 round-6 review follow-up: acquire the pilot policy row lock
-- before the global advisory lock on the reservation path.
--
-- Order creation takes policy FOR SHARE (product-boundary trigger) and then
-- the global cap advisory lock (order-binding guard), while reservation took
-- the advisory lock first and policy FOR UPDATE later (attempt trigger). A
-- reservation holding the advisory lock while waiting on FOR UPDATE, racing
-- an order creation holding FOR SHARE while waiting on the advisory lock,
-- deadlocks with 40P01 -- for any concurrent REDVAULT order-create +
-- reserve pair, pilot or not. Both paths now take the row lock first: the
-- row lock serializes before either side holds the advisory lock, so no
-- cycle can form. Reservations already held policy FOR UPDATE within the
-- same transaction (attempt trigger), so this adds no new contention.
-- FOR UPDATE (not FOR SHARE) is required: the order path's SHARE must
-- conflict here, otherwise the cycle only moves into the attempt trigger.

CREATE OR REPLACE FUNCTION public.reserve_storefront_redvault_payment_attempt_v3(p_order_id uuid)
RETURNS TABLE (
  attempt_id uuid, reference text, amount_kobo bigint, currency text,
  quote_payload_hash text, state text, bank_code text, authorization_url text,
  paystack_subaccount_code text, platform_fee_kobo bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE receipt record;
BEGIN
  IF auth.jwt()->>'storefront_order_context' IS DISTINCT FROM 'route' THEN
    RAISE EXCEPTION 'redvault_route_context_required';
  END IF;
  PERFORM 1 FROM private.uba_redvault_live_pilot_policy WHERE singleton FOR UPDATE;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('uba_redvault_private_live_pilot_global_cap', 0));
  PERFORM private.assert_uba_redvault_private_pilot_active(p_order_id);
  SELECT * INTO STRICT receipt FROM
    public.reserve_storefront_redvault_payment_attempt_v3_pre_pilot(p_order_id);
  RETURN QUERY SELECT receipt.attempt_id, receipt.reference, receipt.amount_kobo,
    receipt.currency, receipt.quote_payload_hash, receipt.state, receipt.bank_code,
    receipt.authorization_url, receipt.paystack_subaccount_code, receipt.platform_fee_kobo;
END;
$$;
ALTER FUNCTION public.reserve_storefront_redvault_payment_attempt_v3(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reserve_storefront_redvault_payment_attempt_v3(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_storefront_redvault_payment_attempt_v3(uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION private.enforce_uba_redvault_private_pilot_attempt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  policy private.uba_redvault_live_pilot_policy%ROWTYPE;
  application private.uba_redvault_applications%ROWTYPE;
  order_row public.orders%ROWTYPE;
  line_count integer;
  distinct_product_count integer;
  line_product uuid;
  line_quantity integer;
  line_price bigint;
BEGIN
  SELECT * INTO STRICT policy FROM private.uba_redvault_live_pilot_policy
  WHERE singleton FOR UPDATE;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('uba_redvault_private_live_pilot_global_cap', 0));
  SELECT * INTO application FROM private.uba_redvault_applications
  WHERE id = NEW.application_id;

  IF policy.enabled IS NOT TRUE
    AND application.user_id IS DISTINCT FROM policy.user_id
    AND (policy.product_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM private.uba_redvault_line_allocations AS allocation
      WHERE allocation.application_id = application.id AND allocation.product_id = policy.product_id
    )) THEN
    RETURN NEW;
  END IF;
  IF policy.enabled IS NOT TRUE OR policy.expires_at <= pg_catalog.now() THEN
    RAISE EXCEPTION 'redvault_pilot_disabled_or_expired';
  END IF;
  IF policy.reserved_attempt_id IS NOT NULL THEN
    RAISE EXCEPTION 'redvault_pilot_attempt_cap_reached';
  END IF;

  SELECT * INTO order_row FROM public.orders WHERE id = NEW.order_id;
  SELECT count(DISTINCT allocation.order_item_id)::integer,
    count(DISTINCT allocation.product_id)::integer,
    min(allocation.product_id::text)::uuid,
    COALESCE(sum(DISTINCT item.quantity), 0)::integer,
    min(allocation.unit_price_kobo)::bigint
  INTO line_count, distinct_product_count, line_product, line_quantity, line_price
  FROM private.uba_redvault_line_allocations AS allocation
  JOIN public.order_items AS item ON item.id = allocation.order_item_id
  WHERE allocation.application_id = application.id;
  IF application.order_id IS DISTINCT FROM NEW.order_id
    OR application.user_id IS DISTINCT FROM policy.user_id
    OR application.merchant_id IS DISTINCT FROM policy.merchant_id
    OR NEW.merchant_id IS DISTINCT FROM policy.merchant_id
    OR order_row.merchant_id IS DISTINCT FROM policy.merchant_id
    OR pg_catalog.upper(order_row.currency) IS DISTINCT FROM 'NGN'
    OR order_row.payment_method IS DISTINCT FROM 'uba_redvault'
    OR order_row.payment_status IS DISTINCT FROM 'unpaid'
    OR pg_catalog.round(order_row.subtotal * 100)::bigint IS DISTINCT FROM 10000
    OR pg_catalog.round(order_row.discount_amount * 100)::bigint IS DISTINCT FROM 500
    OR COALESCE(pg_catalog.round(order_row.shipping_fee * 100)::bigint, 0) <> 0
    OR COALESCE(pg_catalog.round(order_row.gift_wrapping_fee * 100)::bigint, 0) <> 0
    OR COALESCE(order_row.wallet_amount_used, 0) <> 0
    OR EXISTS (SELECT 1 FROM public.customer_savings_redemptions AS redemption
      WHERE redemption.order_id = order_row.id AND redemption.amount > 0)
    OR NEW.currency IS DISTINCT FROM 'NGN'
    OR NEW.amount_kobo IS DISTINCT FROM pg_catalog.round(order_row.total * 100)::bigint
    OR application.discount_kobo <> 500
    OR application.eligible_subtotal_kobo <> 10000
    OR line_count <> 1 OR line_quantity <> 1 OR distinct_product_count <> 1
    OR line_product IS DISTINCT FROM policy.product_id OR line_price IS DISTINCT FROM 10000
    OR EXISTS (SELECT 1 FROM public.order_items AS item
      WHERE item.order_id = order_row.id AND item.variant_id IS NOT NULL)
  THEN
    RAISE EXCEPTION 'redvault_pilot_order_binding_mismatch';
  END IF;
  UPDATE private.uba_redvault_live_pilot_policy
  SET reserved_order_id = NEW.order_id, reserved_attempt_id = NEW.id, updated_at = pg_catalog.now()
  WHERE singleton AND reserved_attempt_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'redvault_pilot_attempt_cap_reached'; END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.enforce_uba_redvault_private_pilot_attempt() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.enforce_uba_redvault_private_pilot_attempt()
  FROM PUBLIC, anon, authenticated, service_role;
