-- PR #3555 round-7 review follow-ups for the REDVAULT private live pilot.
--
-- 1. Savings funding lives in public.customer_savings_redemptions, a
--    separate table whose inserts never touch orders.wallet_amount_used, so
--    a redemption row inserted after a successful reserve (and before
--    approval) bypassed the orders fulfillment guard. Block all writes for
--    pilot-bound orders at the redemptions table itself, mirroring the
--    wallet-branch predicate (enabled or reserved, pilot user or
--    product-bound allocation). Amounts are always positive (table CHECK),
--    so any row is a credit and every write fails closed with the same
--    wallet-or-savings error.
-- 2. Align the expiry predicate with the sibling pilot guards (pilot user
--    OR product-bound allocation). Reserved attempts are user-bound by
--    construction (reserve wrapper + attempt trigger both require the user
--    match), so this changes no reachable outcome; it keeps the
--    defense-in-depth predicate uniform.

CREATE FUNCTION private.guard_uba_redvault_pilot_savings_redemption()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM private.uba_redvault_live_pilot_policy AS policy
    JOIN private.uba_redvault_applications AS application
      ON application.order_id = NEW.order_id
    WHERE (policy.enabled IS TRUE OR policy.reserved_order_id = NEW.order_id)
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
CREATE TRIGGER guard_uba_redvault_pilot_savings_redemption
  BEFORE INSERT OR UPDATE ON public.customer_savings_redemptions
  FOR EACH ROW EXECUTE FUNCTION private.guard_uba_redvault_pilot_savings_redemption();

CREATE OR REPLACE FUNCTION private.enforce_uba_redvault_private_pilot_expiry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.state = 'initializing'
    AND OLD.state IS DISTINCT FROM 'initializing'
    AND EXISTS (
      SELECT 1 FROM private.uba_redvault_live_pilot_policy AS policy
      JOIN private.uba_redvault_applications AS application
        ON application.order_id = NEW.order_id
      WHERE policy.reserved_attempt_id = NEW.id
        AND (application.user_id = policy.user_id OR EXISTS (
          SELECT 1 FROM private.uba_redvault_line_allocations AS allocation
          WHERE allocation.application_id = application.id
            AND allocation.product_id = policy.product_id
        ))
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
