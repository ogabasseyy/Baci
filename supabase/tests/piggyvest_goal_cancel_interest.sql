-- REGRESSION TEST (behaviour): a cancel of a goal that earned interest never breaks the daily reconciliation
-- (migration 20261103085004_piggyvest_goal_cancel_refund). Fixture and
-- helpers live in the included part; registered in the replay registry folder
-- 20261103085004_piggyvest_goal_cancel_refund.
\set ON_ERROR_STOP on
\ir piggyvest_goal_cancel_behaviour.fixture.inc.sql

DO $behaviour$
DECLARE
  c_goal constant text := 'f3860000-0000-4000-8000-000000000005';
  c_invented constant text := 'f3860000-0000-4000-8000-0000000000ee';
  c_other constant text := 'f3860000-0000-4000-8000-0000000000ef';
  v_scope jsonb := pg_temp.gc_scope();
  v_issue jsonb;
  v_issue2 jsonb;
  v_op text;
  v_op2 text;
  v_result jsonb;
  v_text text;
BEGIN
  -- 250000 kobo funded; the goal wallet holds 262000 (12000 interest PiggyVest
  -- paid that the books never recorded as funding). Since 20261112190514 an
  -- early cancel refunds the 250000 principal only and forfeits the 12000 to
  -- the interest wallet; the cancelled goal expects exactly 0 and never goes
  -- negative, so the reconciliation snapshot stays valid.
  INSERT INTO piggyvest_primary.goal_interest_forfeit_wallets (integration_id, provider_wallet_id, enabled)
  VALUES ('f3860000-0000-4000-8000-000000000006', 'synthetic-goalcancel-interest-wallet', true);
  PERFORM pg_temp.gc_fund('f4', 250000);
  v_result := piggyvest_primary.read_daily_reconciliation(
    'f3860000-0000-4000-8000-000000000006'::uuid, 'staging', '{"staleAfterSeconds":60}'::jsonb);
  PERFORM pg_temp.gc_assert(v_result -> 'wallets' =
    '[{"walletId":"synthetic-goalcancel-goal-wallet","expectedKobo":250000}]'::jsonb,
    'funded goal expected balance wrong before the cancel: ' || (v_result -> 'wallets')::text);
  v_op := pg_temp.gc_reserved('interest');
  PERFORM pg_temp.gc_assert(
    piggyvest_primary.dispatch_goal_cancel_split(v_scope, v_op::uuid, 262000)
      = '{"status":"dispatched","principalKobo":250000,"forfeitedInterestKobo":12000}'::jsonb,
    'the split dispatch was refused');
  PERFORM pg_temp.gc_assert(
    pg_temp.gc_settle(pg_temp.gc_proof(v_op) || '{"residualKobo":12000}'::jsonb) = 'confirmed',
    'the principal refund was not settled');
  PERFORM pg_temp.gc_assert(pg_temp.gc_goal('status') = 'cancelled' AND pg_temp.gc_wallet() = 1000,
    'the principal refund did not cancel the goal, or changed the legacy wallet');
  v_result := piggyvest_primary.read_daily_reconciliation(
    'f3860000-0000-4000-8000-000000000006'::uuid, 'staging', '{"staleAfterSeconds":60}'::jsonb);
  PERFORM pg_temp.gc_assert(v_result -> 'wallets' =
    '[{"walletId":"synthetic-goalcancel-goal-wallet","expectedKobo":0}]'::jsonb,
    '250000 funded and 250000 refunded did not expect 0: ' || (v_result -> 'wallets')::text);
END
$behaviour$;

ROLLBACK;
