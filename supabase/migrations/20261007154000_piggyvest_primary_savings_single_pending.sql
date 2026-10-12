BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS primary_savings_single_pending_goal_idx
  ON piggyvest_primary.savings_operations(intent_id,goal_id)
  WHERE state IN ('reserved','dispatched');
COMMIT;
