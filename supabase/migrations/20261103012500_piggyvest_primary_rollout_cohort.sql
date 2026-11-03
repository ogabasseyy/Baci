-- Rollout cohort for PiggyVest primary wallet onboarding.
--
-- A customer who has no verified primary wallet may start onboarding only
-- while listed here, and only when their app build and every readiness
-- reader also pass (apps/web/src/lib/piggyvest/primary-onboarding-capability.ts).
-- The table ships empty, so onboarding stays closed. Only a privileged
-- operator adds rows; no API, client, worker or provisioner role can read
-- or write the table directly. The onboarding provisioner reads one
-- customer's membership through a SECURITY DEFINER reader fenced by the same
-- integration, executor login, merchant, customer and user check as every
-- other onboarding RPC, and it returns a boolean only.
BEGIN;

CREATE TABLE piggyvest_primary.rollout_cohort (
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (merchant_id, customer_id)
);
CREATE INDEX piggyvest_primary_rollout_cohort_customer_idx
  ON piggyvest_primary.rollout_cohort(customer_id);
ALTER TABLE piggyvest_primary.rollout_cohort ENABLE ROW LEVEL SECURITY;
CREATE POLICY primary_rollout_cohort_deny ON piggyvest_primary.rollout_cohort
  AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
REVOKE ALL ON piggyvest_primary.rollout_cohort
  FROM PUBLIC, anon, authenticated, service_role, piggyvest_primary_provisioner;

-- A row naming a customer under another merchant could never match a
-- scoped read; refuse it so an operator mistake is loud, not silent.
CREATE FUNCTION piggyvest_primary.guard_rollout_cohort_customer()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.customers customer
    WHERE customer.id = NEW.customer_id AND customer.merchant_id = NEW.merchant_id
  ) THEN
    RAISE EXCEPTION 'rollout cohort customer must belong to its merchant'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER primary_rollout_cohort_customer_guard
  BEFORE INSERT OR UPDATE ON piggyvest_primary.rollout_cohort
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.guard_rollout_cohort_customer();

CREATE FUNCTION piggyvest_primary.read_rollout_cohort_membership(scope jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM piggyvest_primary.assert_onboarding_scope(scope);
  RETURN EXISTS (
    SELECT 1 FROM piggyvest_primary.rollout_cohort cohort
    WHERE cohort.merchant_id = (scope->>'merchantId')::uuid
      AND cohort.customer_id = (scope->>'customerId')::uuid
  );
END $$;

REVOKE ALL ON FUNCTION piggyvest_primary.guard_rollout_cohort_customer(),
  piggyvest_primary.read_rollout_cohort_membership(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.read_rollout_cohort_membership(jsonb)
  TO piggyvest_primary_provisioner;
COMMIT;
