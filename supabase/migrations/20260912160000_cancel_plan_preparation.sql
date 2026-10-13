BEGIN;
-- Cancel-plan prerequisite tables. The savings exit-execution chain declares
-- %ROWTYPE variables over piggyvest_cancel_plan.intents, which fails
-- compilation when the schema is absent, so the exit migrations cannot replay
-- on a clean database. This backfill provides the table at the exact missing
-- manifest version (sorts before every consumer); columns are derived from
-- the in-chain readers.
--
-- Tables only, deliberately (same rationale as the purchase-preparation
-- prerequisite): the cancel command functions (prepare/quote/recovery
-- readers) were never ported from the source worktree. Runtime cancel calls
-- fail the same way before and after this migration (missing function);
-- replay is what this fixes.
CREATE SCHEMA IF NOT EXISTS piggyvest_cancel_plan;
REVOKE ALL ON SCHEMA piggyvest_cancel_plan FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE piggyvest_cancel_plan.intents (
  operation_id uuid PRIMARY KEY,
  integration_id uuid,
  merchant_id uuid REFERENCES public.merchants(id),
  customer_id uuid REFERENCES public.customers(id),
  goal_id uuid NOT NULL REFERENCES public.customer_savings_goals(id),
  actor_id uuid,
  command jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX piggyvest_cancel_plan_intents_goal_idx
  ON piggyvest_cancel_plan.intents (goal_id);
ALTER TABLE piggyvest_cancel_plan.intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE piggyvest_cancel_plan.intents FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON SCHEMA piggyvest_cancel_plan IS
  'Cancel-plan prerequisite tables (replay support). Command functions remain unported; see migration header.';
COMMIT;
