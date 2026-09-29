REVOKE ALL ON FUNCTION public.reserve_storefront_redvault_payment_attempt(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reserve_storefront_redvault_payment_attempt_v2(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_storefront_redvault_payment_attempt_initialization(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v2(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.guard_uba_redvault_pilot_shipment_write()
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
    WHERE (policy.enabled IS TRUE AND (
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
    WHERE (policy.enabled IS TRUE AND (
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
CREATE TRIGGER guard_uba_redvault_pilot_shipment_write
  BEFORE INSERT OR UPDATE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION private.guard_uba_redvault_pilot_shipment_write();
