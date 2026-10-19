-- PR #3555 round-8 review follow-ups (part 1/3): preserve the pilot
-- binding across an unreserved disable and keep order-level fulfillment
-- protection on created pilot applications.
--
-- configure_uba_redvault_live_pilot(false, NULL, NULL) cleared the product
-- binding whenever no attempt had been reserved. If the pilot was disabled
-- after order creation but before payment reservation, the application row
-- survived while every fulfillment predicate (which gates on
-- enabled-or-reserved) went quiet, so shipping, tracking, and shipment
-- metadata became writable on the dedicated no-fulfillment pilot order.
-- Disable now preserves product_id/expires_at, and the order-fulfillment
-- predicates treat a preserved binding as bound: the gate becomes
-- (enabled OR product bound OR reserved). Staging and never-enabled
-- databases keep product_id NULL, so their behavior is unchanged. Side
-- effect, deliberate and fail-closed: the dedicated test-only product
-- stays quarantined by the product-boundary trigger after disable instead
-- of becoming normally purchasable.

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

