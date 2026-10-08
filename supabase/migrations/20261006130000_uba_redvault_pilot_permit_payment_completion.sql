-- PR #3555 round-2 review follow-up: permit the verified-payment completion
-- transition on pilot orders.
--
-- private.complete_uba_redvault_verified_payment (reached through
-- approve_and_complete_uba_redvault_payment after provider capture is
-- persisted) marks the order paid and advances shipping_status from
-- 'pending' to 'processing'. The widened pilot fulfillment guard rejects
-- that transition, leaving a valid pilot charge captured-held with an
-- approval failure. 'processing' authorizes no fulfillment by itself --
-- tracking/shipment/timestamp/detail writes and shipment-table rows stay
-- blocked -- so the guard now permits exactly pending -> processing. Every
-- other fulfillment-field change stays blocked, including reversals back to
-- 'pending', which fail closed.

CREATE OR REPLACE FUNCTION private.guard_uba_redvault_pilot_order_fulfillment()
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
