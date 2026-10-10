BEGIN;
-- Reject customer and goal deletion while a savings operation is
-- unresolved (reserved/dispatched, the same pending set the
-- single-pending index and the cancellation guard use). settle_savings
-- requires the live customer row (intent join), the goal row (capacity
-- credit), and the pending wallet transaction (hold completion): the
-- 092900 SET NULL links would strand an accepted PiggyVest transfer
-- with no confirmable destination, and status/outflow reconciliation
-- would report pending forever. Confirmed and cancelled operations
-- keep detaching normally. BEFORE DELETE triggers (rather than editing
-- the shared deleter) cover every delete path, including the
-- goal-cascade from account deletion; the intent- and goal-indexed
-- EXISTS checks keep unaffected deletions cheap. No account is
-- permanently locked: reserved operations dispatch, and dispatched
-- operations settle or release (release_failed_savings), all of which
-- run while the customer and goal exist.
CREATE OR REPLACE FUNCTION piggyvest_primary.block_unsettled_savings_customer_deletion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM piggyvest_primary.savings_operations operation
    JOIN piggyvest_primary.onboarding_intents intent ON intent.id = operation.intent_id
    WHERE intent.customer_id = OLD.id
      AND operation.state IN ('reserved','dispatched')
  ) THEN
    RAISE EXCEPTION 'cannot delete customer with unsettled savings operations' USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS primary_savings_block_unsettled_customer_deletion ON public.customers;
CREATE TRIGGER primary_savings_block_unsettled_customer_deletion
  BEFORE DELETE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.block_unsettled_savings_customer_deletion();
CREATE OR REPLACE FUNCTION piggyvest_primary.block_unsettled_savings_goal_deletion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM piggyvest_primary.savings_operations operation
    WHERE operation.goal_id = OLD.id
      AND operation.state IN ('reserved','dispatched')
  ) THEN
    RAISE EXCEPTION 'cannot delete goal with unsettled savings operations' USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS primary_savings_block_unsettled_goal_deletion ON public.customer_savings_goals;
CREATE TRIGGER primary_savings_block_unsettled_goal_deletion
  BEFORE DELETE ON public.customer_savings_goals
  FOR EACH ROW EXECUTE FUNCTION piggyvest_primary.block_unsettled_savings_goal_deletion();
COMMIT;
