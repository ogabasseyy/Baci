-- PR #3555 round-8 review follow-ups: keep pilot protection after an
-- unreserved disable, and let the pilot account order in disabled-policy
-- staging mode.
--
-- 1. configure_uba_redvault_live_pilot(false, NULL, NULL) cleared the
--    product binding whenever no attempt had been reserved. If the pilot
--    was disabled after order creation but before payment reservation, the
--    application row survived while every fulfillment predicate (which
--    gates on enabled-or-reserved) went quiet, so shipping, tracking, and
--    shipment metadata became writable on the dedicated no-fulfillment
--    pilot order. Disable now preserves product_id/expires_at, and every
--    fulfillment-adjacent predicate treats a preserved binding as bound:
--    the gate becomes (enabled OR product bound OR reserved). Staging and
--    never-enabled databases keep product_id NULL, so their behavior is
--    unchanged. Side effect, deliberate and fail-closed: the dedicated
--    test-only product stays quarantined by the product-boundary trigger
--    after disable instead of becoming normally purchasable.
--
-- 2. The order-binding guard's disabled-policy early return excluded the
--    seeded pilot user by identity alone, so in staging_test_mode (policy
--    disabled, no bound product) the pilot account could not create any
--    REDVAULT order even though availability advertises the method. When
--    the policy is disabled and has no bound product, the guard now passes
--    the order through without classifying it as a live-pilot order. The
--    reservation assert gets the same carve-out: its cancelled-order and
--    disabled-or-expired arms require a bound product, so a disabled,
--    never-bound policy lets the pilot account's ordinary orders reserve
--    through the normal path instead of raising pilot errors by identity
--    alone. The attempt trigger's disabled-policy early return had the
--    identical identity-only shape and gets the identical passthrough.
--    Enabled, expired, and disabled-after-binding policies all keep a
--    bound product, so their behavior is unchanged.

CREATE OR REPLACE FUNCTION private.configure_uba_redvault_live_pilot(
  p_enabled boolean, p_product_id uuid, p_expires_at timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM private.uba_redvault_live_pilot_policy WHERE singleton FOR UPDATE;
  IF EXISTS (SELECT 1 FROM private.uba_redvault_live_pilot_policy
      WHERE singleton AND reserved_attempt_id IS NOT NULL)
    AND (p_enabled IS TRUE OR p_product_id IS NOT NULL OR p_expires_at IS NOT NULL) THEN
    RAISE EXCEPTION 'redvault_pilot_consumed_binding_immutable';
  END IF;
  IF p_enabled IS TRUE AND (p_product_id IS NULL OR p_expires_at IS NULL
    OR p_expires_at <= pg_catalog.now() OR p_expires_at > pg_catalog.now() + interval '14 days') THEN
    RAISE EXCEPTION 'redvault_pilot_configuration_invalid';
  END IF;
  IF p_enabled IS TRUE AND NOT EXISTS (
    SELECT 1 FROM public.products AS product
    WHERE product.id = p_product_id
      AND product.merchant_id = '6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid
      AND product.price = 100 AND product.has_variants IS FALSE
      AND NOT EXISTS (SELECT 1 FROM public.order_items AS prior_item
        WHERE prior_item.product_id = product.id)
  ) THEN
    RAISE EXCEPTION 'redvault_pilot_product_not_dedicated';
  END IF;
  UPDATE private.uba_redvault_live_pilot_policy
  SET enabled = COALESCE(p_enabled, false),
      product_id = CASE WHEN p_enabled THEN p_product_id ELSE product_id END,
      expires_at = CASE WHEN p_enabled THEN p_expires_at ELSE expires_at END,
      updated_at = pg_catalog.now()
  WHERE singleton;
END;
$$;
ALTER FUNCTION private.configure_uba_redvault_live_pilot(boolean, uuid, timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.configure_uba_redvault_live_pilot(boolean, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.guard_uba_redvault_pilot_order_fulfillment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF COALESCE(NEW.wallet_amount_used, 0) <> 0 AND EXISTS (
    SELECT 1 FROM private.uba_redvault_live_pilot_policy AS policy
    JOIN private.uba_redvault_applications AS application ON application.order_id = OLD.id
    WHERE (policy.enabled IS TRUE OR policy.product_id IS NOT NULL OR policy.reserved_order_id = OLD.id)
      AND (application.user_id = policy.user_id OR EXISTS (
        SELECT 1 FROM private.uba_redvault_line_allocations AS allocation
        WHERE allocation.application_id = application.id
          AND allocation.product_id = policy.product_id
      ))
  ) THEN
    RAISE EXCEPTION 'redvault_pilot_wallet_or_savings_credit_blocked';
  END IF;
  IF EXISTS (
    SELECT 1 FROM private.uba_redvault_live_pilot_policy AS policy
    JOIN private.uba_redvault_applications AS application
      ON application.order_id = OLD.id
    WHERE ((policy.enabled IS TRUE OR policy.product_id IS NOT NULL) AND (
        application.user_id = policy.user_id
        OR EXISTS (
          SELECT 1 FROM private.uba_redvault_line_allocations AS allocation
          WHERE allocation.application_id = application.id
            AND allocation.product_id = policy.product_id
        )
      ))
      OR policy.reserved_order_id = OLD.id
  ) AND (
    NEW.tracking_number IS DISTINCT FROM OLD.tracking_number
    OR NEW.shipping_provider IS DISTINCT FROM OLD.shipping_provider
    OR NEW.shipment_id IS DISTINCT FROM OLD.shipment_id
    OR NEW.shipped_at IS DISTINCT FROM OLD.shipped_at
    OR NEW.delivered_at IS DISTINCT FROM OLD.delivered_at
    OR NEW.fulfillment_details IS DISTINCT FROM OLD.fulfillment_details
    OR pg_catalog.to_jsonb(NEW)->'shipment_booking_lock_token'
      IS DISTINCT FROM pg_catalog.to_jsonb(OLD)->'shipment_booking_lock_token'
    OR (NEW.shipping_status IS DISTINCT FROM OLD.shipping_status
      AND NEW.shipping_status IS DISTINCT FROM 'cancelled'
      AND NEW.shipping_status IS DISTINCT FROM 'canceled'
      AND NOT (
        OLD.shipping_status IS NOT DISTINCT FROM 'pending'
        AND NEW.shipping_status IS NOT DISTINCT FROM 'processing'
      ))
  ) THEN
    RAISE EXCEPTION 'redvault_pilot_physical_fulfillment_blocked';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.guard_uba_redvault_pilot_order_fulfillment() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.guard_uba_redvault_pilot_order_fulfillment()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.block_uba_redvault_pilot_postapproval_fulfillment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF COALESCE(NEW.wallet_amount_used, 0) <> 0 AND EXISTS (
    SELECT 1 FROM private.uba_redvault_live_pilot_policy AS policy
    JOIN private.uba_redvault_applications AS application ON application.order_id = OLD.id
    WHERE (policy.enabled IS TRUE OR policy.product_id IS NOT NULL OR policy.reserved_order_id = OLD.id)
      AND (application.user_id = policy.user_id OR EXISTS (
        SELECT 1 FROM private.uba_redvault_line_allocations AS allocation
        WHERE allocation.application_id = application.id
          AND allocation.product_id = policy.product_id
      ))
  ) THEN
    RAISE EXCEPTION 'redvault_pilot_wallet_or_savings_credit_blocked';
  END IF;
  IF EXISTS (
    SELECT 1 FROM private.uba_redvault_live_pilot_policy AS policy
    JOIN private.uba_redvault_applications AS application
      ON application.order_id = OLD.id AND application.user_id = policy.user_id
    JOIN private.uba_redvault_payment_attempts AS attempt
      ON attempt.order_id = OLD.id AND attempt.state = 'approved'
    WHERE policy.reserved_order_id = OLD.id
  ) AND (
    NEW.shipping_status IS DISTINCT FROM OLD.shipping_status
    OR NEW.tracking_number IS DISTINCT FROM OLD.tracking_number
    OR NEW.shipping_provider IS DISTINCT FROM OLD.shipping_provider
    OR NEW.shipment_id IS DISTINCT FROM OLD.shipment_id
    OR NEW.shipped_at IS DISTINCT FROM OLD.shipped_at
    OR NEW.delivered_at IS DISTINCT FROM OLD.delivered_at
    OR NEW.fulfillment_details IS DISTINCT FROM OLD.fulfillment_details
    OR pg_catalog.to_jsonb(NEW)->'shipment_booking_lock_token'
      IS DISTINCT FROM pg_catalog.to_jsonb(OLD)->'shipment_booking_lock_token'
  ) THEN
    RAISE EXCEPTION 'redvault_pilot_physical_fulfillment_blocked';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.block_uba_redvault_pilot_postapproval_fulfillment() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.block_uba_redvault_pilot_postapproval_fulfillment()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.guard_uba_redvault_pilot_shipment_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  pilot_order_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    pilot_order_id := NEW.order_id;
  ELSE
    pilot_order_id := OLD.order_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM private.uba_redvault_live_pilot_policy AS policy
    JOIN private.uba_redvault_applications AS application
      ON application.order_id = pilot_order_id
    WHERE ((policy.enabled IS TRUE OR policy.product_id IS NOT NULL) AND (
        application.user_id = policy.user_id
        OR EXISTS (
          SELECT 1 FROM private.uba_redvault_line_allocations AS allocation
          WHERE allocation.application_id = application.id
            AND allocation.product_id = policy.product_id
        )
      ))
      OR policy.reserved_order_id = pilot_order_id
  ) THEN
    RAISE EXCEPTION 'redvault_pilot_physical_fulfillment_blocked';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.order_id IS DISTINCT FROM OLD.order_id AND EXISTS (
    SELECT 1
    FROM private.uba_redvault_live_pilot_policy AS policy
    JOIN private.uba_redvault_applications AS application
      ON application.order_id = NEW.order_id
    WHERE ((policy.enabled IS TRUE OR policy.product_id IS NOT NULL) AND (
        application.user_id = policy.user_id
        OR EXISTS (
          SELECT 1 FROM private.uba_redvault_line_allocations AS allocation
          WHERE allocation.application_id = application.id
            AND allocation.product_id = policy.product_id
        )
      ))
      OR policy.reserved_order_id = NEW.order_id
  ) THEN
    RAISE EXCEPTION 'redvault_pilot_physical_fulfillment_blocked';
  END IF;

  RETURN NEW;
END;
$$;
ALTER FUNCTION private.guard_uba_redvault_pilot_shipment_write() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.guard_uba_redvault_pilot_shipment_write()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.guard_uba_redvault_pilot_savings_redemption()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM private.uba_redvault_live_pilot_policy AS policy
    JOIN private.uba_redvault_applications AS application
      ON application.order_id = NEW.order_id
    WHERE (policy.enabled IS TRUE OR policy.product_id IS NOT NULL OR policy.reserved_order_id = NEW.order_id)
      AND (application.user_id = policy.user_id OR EXISTS (
        SELECT 1 FROM private.uba_redvault_line_allocations AS allocation
        WHERE allocation.application_id = application.id
          AND allocation.product_id = policy.product_id
      ))
  ) THEN
    RAISE EXCEPTION 'redvault_pilot_wallet_or_savings_credit_blocked';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.guard_uba_redvault_pilot_savings_redemption() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.guard_uba_redvault_pilot_savings_redemption()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.block_uba_redvault_pilot_savings_redemption()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.amount > 0 AND EXISTS (
    SELECT 1 FROM private.uba_redvault_live_pilot_policy AS policy
    JOIN private.uba_redvault_applications AS application
      ON application.order_id = NEW.order_id
    WHERE (policy.enabled IS TRUE OR policy.product_id IS NOT NULL OR policy.reserved_attempt_id IS NOT NULL)
      AND (application.user_id = policy.user_id OR EXISTS (
        SELECT 1 FROM private.uba_redvault_line_allocations AS allocation
        WHERE allocation.application_id = application.id
          AND allocation.product_id = policy.product_id
      ))
  ) THEN
    RAISE EXCEPTION 'redvault_pilot_wallet_or_savings_credit_blocked';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.block_uba_redvault_pilot_savings_redemption() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.block_uba_redvault_pilot_savings_redemption()
  FROM PUBLIC, anon, authenticated, service_role;

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
  IF policy.product_id IS NOT NULL
    AND (application_user_id = policy.user_id OR application_product_bound IS TRUE) THEN
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
  IF policy.product_id IS NOT NULL
    AND (application_user_id = policy.user_id OR application_product_bound IS TRUE)
    AND (policy.enabled IS NOT TRUE OR policy.expires_at <= pg_catalog.now()) THEN
    RAISE EXCEPTION 'redvault_pilot_disabled_or_expired';
  END IF;
END;
$$;

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
    AND (policy.product_id IS NULL OR (
      application.user_id IS DISTINCT FROM policy.user_id
      AND NOT EXISTS (
        SELECT 1 FROM private.uba_redvault_line_allocations AS allocation
        WHERE allocation.application_id = application.id AND allocation.product_id = policy.product_id
      )
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
    AND (policy.product_id IS NULL
      OR (NEW.user_id IS DISTINCT FROM policy.user_id
        AND bound_product IS DISTINCT FROM policy.product_id)) THEN
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
