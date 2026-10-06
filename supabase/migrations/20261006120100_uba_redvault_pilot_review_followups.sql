-- PR #3555 review follow-ups for the REDVAULT private live pilot.
--
-- 1. Expiry must only gate ENTERING the initializing state. The provider
--    outcome (initialized/indeterminate) is recorded after the hosted
--    checkout starts, which may be after the pilot expires or is disabled;
--    rejecting that update strands the attempt in initializing with no path
--    forward. Fresh initialization after expiry stays blocked by both the v3
--    claim wrapper and this trigger.
-- 2. The order-field fulfillment guard previously activated only after an
--    attempt reached approved, leaving the pilot order fulfillable while
--    unpaid or initializing (notably via
--    self_fulfill_order_with_wallet_release, which requires no payment and
--    marks the order shipped; nothing then stops a later charge). The guard
--    now covers every enabled or reserved pilot order, mirroring the
--    shipment-table guard predicate. Cancellation (shipping_status to
--    'cancelled' or 'canceled', the two spellings order checks accept)
--    stays allowed so the controlled test order can always be wound down;
--    every other fulfillment-field change is blocked.

CREATE OR REPLACE FUNCTION private.enforce_uba_redvault_private_pilot_expiry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.state = 'initializing'
    AND OLD.state IS DISTINCT FROM 'initializing'
    AND EXISTS (
      SELECT 1 FROM private.uba_redvault_live_pilot_policy AS policy
      JOIN private.uba_redvault_applications AS application
        ON application.order_id = NEW.order_id AND application.user_id = policy.user_id
      WHERE policy.reserved_attempt_id = NEW.id
        AND (policy.enabled IS NOT TRUE OR policy.expires_at <= pg_catalog.now())
    ) THEN
    RAISE EXCEPTION 'redvault_pilot_disabled_or_expired';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.enforce_uba_redvault_private_pilot_expiry() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.enforce_uba_redvault_private_pilot_expiry()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS block_uba_redvault_pilot_postapproval_fulfillment ON public.orders;
DROP FUNCTION IF EXISTS private.block_uba_redvault_pilot_postapproval_fulfillment();

CREATE FUNCTION private.guard_uba_redvault_pilot_order_fulfillment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF COALESCE(NEW.wallet_amount_used, 0) <> 0 AND EXISTS (
    SELECT 1 FROM private.uba_redvault_live_pilot_policy AS policy
    JOIN private.uba_redvault_applications AS application ON application.order_id = OLD.id
    WHERE (policy.enabled IS TRUE OR policy.reserved_order_id = OLD.id)
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
    WHERE (policy.enabled IS TRUE AND (
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
      AND NEW.shipping_status IS DISTINCT FROM 'canceled')
  ) THEN
    RAISE EXCEPTION 'redvault_pilot_physical_fulfillment_blocked';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.guard_uba_redvault_pilot_order_fulfillment() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.guard_uba_redvault_pilot_order_fulfillment()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER guard_uba_redvault_pilot_order_fulfillment
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION private.guard_uba_redvault_pilot_order_fulfillment();
