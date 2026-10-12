-- PR #3555 round-5 review follow-up: split of 20260928120000 (part 5/5): fulfillment and savings guards.
CREATE FUNCTION private.block_uba_redvault_pilot_postapproval_fulfillment()
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
CREATE TRIGGER block_uba_redvault_pilot_postapproval_fulfillment
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION private.block_uba_redvault_pilot_postapproval_fulfillment();

CREATE FUNCTION private.block_uba_redvault_pilot_savings_redemption()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.amount > 0 AND EXISTS (
    SELECT 1 FROM private.uba_redvault_live_pilot_policy AS policy
    JOIN private.uba_redvault_applications AS application
      ON application.order_id = NEW.order_id
    WHERE (policy.enabled IS TRUE OR policy.reserved_attempt_id IS NOT NULL)
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
CREATE TRIGGER block_uba_redvault_pilot_savings_redemption
  BEFORE INSERT OR UPDATE ON public.customer_savings_redemptions
  FOR EACH ROW EXECUTE FUNCTION private.block_uba_redvault_pilot_savings_redemption();
