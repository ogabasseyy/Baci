-- PR #3555 round-9 review follow-up: block fulfillment-data writes on
-- pilot order items after durable approval.
--
-- reject_redvault_item_mutation permits fulfillment_data-only updates
-- once redvault_approved_completion_durable(order) is true, and the pilot
-- product-boundary trigger likewise skips updates whose product_id is
-- unchanged. A pilot order that reaches durable approval could therefore
-- receive serialized inventory, IMEI data, or fulfillment quantities on
-- its items through a merchant fulfillment path, defeating the
-- no-fulfillment guarantee the order- and shipment-level guards enforce.
-- The approved-completion carve-out now excludes pilot-bound orders
-- (enabled, preserved, or reserved binding with pilot user or
-- product-bound allocation); those updates fall through to the snapshot
-- immutability rejection. Non-pilot REDVAULT orders keep the carve-out.

CREATE OR REPLACE FUNCTION private.reject_redvault_item_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_order_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;
BEGIN
  IF EXISTS (SELECT 1 FROM private.uba_redvault_applications WHERE order_id = v_order_id) THEN
    IF TG_OP = 'UPDATE'
      AND (to_jsonb(NEW) - 'fulfillment_data') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'fulfillment_data')
      AND private.redvault_approved_completion_durable(v_order_id)
      AND NOT EXISTS (
        SELECT 1 FROM private.uba_redvault_live_pilot_policy AS policy
        JOIN private.uba_redvault_applications AS application
          ON application.order_id = v_order_id
        WHERE (policy.enabled IS TRUE OR policy.product_id IS NOT NULL OR policy.reserved_order_id = v_order_id)
          AND (application.user_id = policy.user_id OR EXISTS (
            SELECT 1 FROM private.uba_redvault_line_allocations AS allocation
            WHERE allocation.application_id = application.id
              AND allocation.product_id = policy.product_id
          ))
      ) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'redvault_order_snapshot_immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
ALTER FUNCTION private.reject_redvault_item_mutation() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.reject_redvault_item_mutation() FROM PUBLIC, anon, authenticated, service_role;
