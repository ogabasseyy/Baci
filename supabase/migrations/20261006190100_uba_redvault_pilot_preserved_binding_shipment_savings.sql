-- PR #3555 round-8 review follow-ups (part 2/3): extend preserved-binding
-- protection to the shipment-table and savings-redemption guards.
--
-- Same root cause as part 1: these predicates gated on enabled-or-reserved
-- only, so an unreserved disable released them for already-created pilot
-- applications. They now treat a preserved product binding as bound.
-- Staging and never-enabled databases keep product_id NULL, so their
-- behavior is unchanged.

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

